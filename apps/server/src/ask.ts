/**
 * Ask — the one AI pipeline of the PDF journey (docs/PDF-JOURNEY.md). A prompt
 * (typed, or from a predefined seed pill) runs against one or more source cards.
 * The server gathers the real source content (PDF text from the blob store),
 * picks the answer's shape from the prompt, and streams a single response card.
 *
 * Shape routing: a comparison/matrix prompt → a table; an enumeration prompt →
 * a list; otherwise prose. Phrasing steers it ("…as a table").
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AskEvent, AskRequest, AskShape, AskSource, RichBlock } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { assetPath, extractAssetPages, extractAssetText, getAsset } from './assets.js';
import { cacheImagesInRows } from './imageCache.js';
import { FIND_IMAGE_TOOL, runFindImage, searchImages } from './imageSearch.js';
import { locateStops, type ProposedStop } from './geo.js';
import { buildLinkPreview } from './linkPreview.js';
import { extractSheetText } from './sheets.js';
import { getMachine, type MachineSkill } from './machines.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { anthropic, hasModelKey } from './model.js';
import {
  RESEARCH_MAX_CONTINUATIONS,
  WEB_DIRECTIVE,
  WEB_MAX_CONTINUATIONS,
  WEB_TABLE_DIRECTIVE,
  researchToolset,
  webToolset,
} from './webTools.js';

const MAX_TOKENS = 1400;
/** A research dossier is a longer artifact — several cited sections. */
const RESEARCH_MAX_TOKENS = 2800;
/** A prototype is a whole self-contained HTML document (markup + inline CSS/JS),
 *  and a multi-screen one (a small website/app flow) is several screens in that
 *  one document — it needs real headroom or the UI truncates mid-tag. */
const PROTOTYPE_MAX_TOKENS = 12000;
/** Deep runs chain many searches; the CLI sidecar needs matching headroom. */
const RESEARCH_SIDECAR_TIMEOUT_MS = 300_000;
/** The keyless CLI can't token-stream, so it generates the whole document in one
 *  shot before chunking it back — a long doc needs a generous ceiling. */
const PROTOTYPE_SIDECAR_TIMEOUT_MS = 240_000;
const PER_SOURCE_CHARS = 8_000;

const DOC_SYSTEM = `You answer a question about the provided source document(s) on a canvas, as a clear written card. Use clean markdown: an optional short "# " title line, then tight paragraphs (and sub-headings only if it genuinely helps).

BUILD THE ANSWER FROM THE RIGHT CONSTRUCTS — automatically, from the SHAPE of the content, without the user having to ask. And MIX them freely in one card: a line of context, then a table, then a checklist of next steps.
- Comparison, matrix, feature breakdown, pricing grid, ranking, or any set of items across shared dimensions → a PROPER markdown table (a header row then | a | b | rows) — full and legible, not a token two-row sketch.
- Steps, tasks, action items, next steps, or a to-do → a markdown task list, each item on its own line as "- [ ] " (an unchecked checkbox; "- [x] " only for items the sources say are already done).
- A set of short points, options, tips, or an enumeration → a "- " bulleted (or "1." numbered, when order matters) list.
- Real visitable places — a trip, a day plan, "places/cafés near X" → a \`\`\`map block (see MAP BLOCK below).
- Something genuinely VISUAL — a place, product, building, device, artwork → one real image (![alt](url) — only a real URL from the sources, a fetched page, or the find_image tool).
Never flatten a naturally tabular, task-shaped, or place-based answer into a wall of prose; "---" on its own line draws a divider where it helps.

Never include code blocks, fenced code, or Mermaid/diagram source — the ONLY fenced blocks allowed are the \`\`\`map and \`\`\`widget blocks defined below; if a flowchart would help, say so in words (the canvas has a separate Flow shape). Ground every claim in the provided content; if the sources don't contain the answer, say so plainly rather than inventing.

CALIBRATE DEPTH TO THE ASK. An open-ended, decision, or planning question ("best…", "should we…", "compare…", "plan…") earns a FULL card: several tight sections covering the real options, trade-offs, and concrete specifics (names, numbers, prices) — a reader should be able to DECIDE from it. A narrow or factual ask stays short — answer it and stop. The user's own size words always win: "short"/"brief"/"one-liner" means exactly that, "detailed"/"thorough" means go long. Either way: specific, no preamble, no sign-off, no padding.`;

const TABLE_SYSTEM = `You answer a question as a TABLE — a comparison/matrix, a plan, an itinerary, a vendor list: whatever grid fits the ask. Return ONLY a JSON object {"columns": string[], "rows": string[][]} — the first column names the items/dimensions, one row per item, short cells.
Two modes, chosen by what the ask IS:
- EXTRACTIVE (summarise/compare/pull facts FROM the provided sources): ground FACTUAL cells (names, dates, prices, quoted specs) in the source content — leave such a cell empty rather than inventing a fact. BUT any column the user explicitly asked for that calls for JUDGEMENT rather than a quoted fact — "risk", "pros/cons", "trade-offs", "fit", "recommendation", "assessment", "watch-outs", "so what" — you MUST fill by REASONING from the source, not leave blank and never write "Not covered in this source" for it. The user named that column because they want your analysis of the material, not a lookup. Reserve "Not covered in this source" (first cell of the column, rest empty) ONLY for a purely factual column that the sources are genuinely silent on.
- GENERATIVE (plan/suggest/draft/brainstorm — the user wants NEW content): propose specific, sensible values in every cell; NEVER write "Not covered in this source" — sources are constraints and context (budget, dates, preferences), not the ceiling of what you may say.
Cells may use minimal inline markdown where it genuinely helps: [label](url) for a link that appears in the sources (or a well-known official page), ![alt](url) for an image URL present in the sources, **bold** for a key value. No prose outside the JSON, no code fences.`;

const CLAUSE_DIFF_SYSTEM = `You are comparing multiple source documents clause-by-clause to surface overlaps and CONFLICTS. Return ONLY a JSON object {"columns": string[], "rows": string[][]}. Columns MUST be: "Topic / Clause", then one column per source document (use a short version of each document's title), then a final "Conflict?" column. Each row is a topic the documents both address; fill each document's cell with its stance/wording (short, grounded), and set "Conflict?" to "Yes", "No", or "Partial" with a few words on why. Prioritise rows where the documents differ or contradict. Ground every cell in the provided text; leave a cell blank if a document is silent. No prose, no code fences.`;

const DIAGRAM_SYSTEM = `You turn the user's request and the source document(s) into ONE diagram, expressed as Mermaid source. First choose the Mermaid diagram type that best fits the intent:
- "flowchart TD" — a process, decision, or how something flows step to step
- "sequenceDiagram" — messages/interactions between actors over time
- "classDiagram" — data/object structures and their relationships
- "stateDiagram-v2" — states and the transitions between them (a lifecycle)
- "erDiagram" — entities and their relationships (a data model)
- "mindmap" — a hierarchical breakdown of one topic into sub-ideas
- "timeline" — chronological events or milestones
- "gantt" — scheduled tasks with dates
- "journey" — a user's steps and how they feel at each

Output ONLY valid Mermaid source: no prose, no explanation, NO \`\`\` code fences. Put the diagram-type keyword on the very first line. Keep node labels short and ground every node in the provided content. Aim for 6–18 nodes — clear beats exhaustive. Wrap any label containing punctuation or spaces in double quotes. Never invent facts that aren't in the sources.`;

const PROTOTYPE_SYSTEM = `You turn the user's request (and any source content) into ONE self-contained HTML prototype of a user interface — a screen, component, landing page, dashboard, form, card, or email — that renders live. Think "describe a UI, see it rendered": design something clean, modern, and believable, grounded in the request's actual subject and copy (real-sounding labels and content, not lorem ipsum).

HARD REQUIREMENTS — the document is rendered in a sandboxed iframe with NO network access, so it must be COMPLETELY self-contained:
- Output a full HTML document beginning with <!doctype html>.
- Put ALL CSS in a single inline <style> block. Any JS goes in an inline <script>. NO external resources of any kind: no <link>, no CDN URLs, no external stylesheets, no web-font imports, no remote images. Anything fetched over the network will silently fail.
- For type, use a system font stack (e.g. -apple-system, "Segoe UI", Roboto, sans-serif). For imagery/icons, use inline SVG, CSS shapes/gradients, or emoji — never an external <img src="http…">.
- FILL THE FRAME. The document is the screen: set html,body{margin:0} and let the UI span the full width and height — the app's own background reaches every edge, with NO outer page margin or a small card floating in empty space. Put breathing room INSIDE the layout (padding, spacing), not as a dead border around it.
- MULTI-SCREEN when the request calls for it (a website, an app with several views, a signup or checkout flow): build ALL the screens into this ONE document and wire real client-side navigation between them — nav links, tabs, or buttons that show one screen at a time (e.g. toggle an ".active" class on ".screen" sections, or a tiny hashchange router). The navigation MUST actually work when clicked, each screen fills the frame, and only one shows at a time. Include just the handful of screens that matter — don't pad.
- Make it real, not a static picture: wire up the obvious interactions with a little inline JS (navigation between screens, a timer counting down, a button toggling, a tab switching, an input updating a value). Clean, modern, clear visual hierarchy.

Output ONLY the raw HTML document — no prose, no explanation, NO \`\`\` code fences before or after.`;

/** The OpenUI Lang grammar + component vocabulary, shared verbatim by every
 *  generative-UI answer (dashboards AND rich research cards) so the renderer
 *  needs exactly one parser and one component library (dashboard/library.tsx —
 *  keep the component list in sync with DASHBOARD_VOCAB there). */
const OPENUI_GRAMMAR = `GRAMMAR
- One statement per line: \`id = Component(arg1, arg2, …)\`. Each \`id\` is a lowercase name you invent (e.g. \`kpis\`, \`bar1\`).
- Arguments are POSITIONAL, in the exact order listed for each component below. Strings use double quotes. Numbers are bare (e.g. 1204, 23.5). Lists use square brackets: ["NA","EU"] or [120, 80, 50].
- Children are given as a list of ids that appear as their own statements: \`row = Grid([k1, k2, k3], 3)\` with \`k1 = …\` etc. on their own lines. Forward references are fine (define \`row\` before \`k1\`).
- The entry point MUST be a single statement whose id is exactly \`root\`. Everything shown descends from \`root\`.
- Output ONLY the OpenUI Lang statements — no prose, no explanation, NO \`\`\` code fences.

COMPONENTS (name — positional args)
- Stack(children: list, direction: "row" | "column") — a flex container. Default direction "column".
- Grid(children: list, columns: number) — an even grid of its children across N columns.
- Card(title: string, children: list) — a titled panel wrapping other components.
- Text(value: string, size: "sm" | "md" | "lg") — a line of text.
- Kpi(label: string, value: string, delta: string) — a headline metric tile. \`value\` is the formatted figure ("$284k", "1,204"); \`delta\` is an optional signed change ("+12% vs last month") — pass "" if none.
- BarChart(title: string, labels: list of strings, values: list of numbers) — a bar per label.
- LineChart(title: string, labels: list of strings, values: list of numbers) — a trend line over labels.
- Table(columns: list of strings, rows: list of rows, where each row is a list of cell strings).
- Markdown(text: string) — a rich text block: markdown with "## " headings, **bold**, [label](url) links, "- " bullets, and ![alt](url) images. Escape newlines as \\n and inner double quotes as \\" inside the quoted string.
- Image(src: string, caption: string) — one image. \`src\` MUST be a real image URL taken from the sources or a page you actually fetched — NEVER invented. Pass "" for no caption.
- Tabs(labels: list of strings, panels: list of components) — tabbed sections, one panel per label; for parallel angles that each need room (e.g. ["Reviews","Specs","Alternatives"]).`;

/** An interactive dashboard is expressed in OpenUI Lang — a tiny declarative
 *  grammar our client renders through a fixed monochrome component library
 *  (no HTML/JS, no external service). The model computes the numbers from the
 *  data and lays out KPIs, charts and a table over these components. */
const DASHBOARD_SYSTEM = `You produce ONE interactive data DASHBOARD, expressed in "OpenUI Lang" — a tiny declarative layout grammar. A separate renderer draws your output through a fixed component library; you never write HTML, CSS, JS, or SVG.

WHERE THE DATA COMES FROM
- If the request includes data (a CSV, a table, spreadsheet cells, or source cards), derive EVERY KPI and chart value from it — never invent numbers when real ones are given.
- If the request names a subject with no data attached (e.g. "a dashboard of the 2024 F1 season", "our Q3 sales"), populate it with accurate figures you know, or a clearly representative dataset that fits the subject — enough to make a useful, believable dashboard.
- If a "Current dashboard (OpenUI Lang spec)" is included, you are REFINING it: re-emit the whole spec with the requested change applied (add/remove a chart, recompute a metric, refocus it), keeping the parts the request doesn't touch.

${OPENUI_GRAMMAR}

DASHBOARD BRIEF
- Layout top to bottom: a KPI ROW (Grid of 3–5 Kpi tiles) then a Grid of charts, then a Table — all inside one root Stack.
- Compute every KPI and chart value from the ACTUAL data (totals, averages, min/max, counts, trends). NEVER invent numbers. Treat non-numeric columns as categories/axes (chart labels, table columns) and numeric columns as measures.
- Choose 2–3 charts that reveal the real story in THIS data — a BarChart to compare categories, a LineChart for anything ordered/time-based. Keep labels short.
- End with a compact Table of the most useful rows (cap at ~12 rows, ~6 columns) so the underlying figures stay visible.
- If the data is thin, show fewer, honest visuals rather than padding. Prefer clarity over density.

EXAMPLE (shape only — always derive real values from the given data):
root = Stack([kpis, charts, tbl], "column")
kpis = Grid([k1, k2, k3], 3)
k1 = Kpi("Total Revenue", "$284k", "+12% vs last month")
k2 = Kpi("Orders", "1,204", "+3%")
k3 = Kpi("Avg Order Value", "$236", "")
charts = Grid([bar, line], 2)
bar = BarChart("Revenue by region", ["NA","EU","APAC","LATAM"], [120, 80, 50, 34])
line = LineChart("Monthly revenue", ["Jan","Feb","Mar","Apr","May"], [42, 38, 51, 47, 53])
tbl = Card("By region", [t1])
t1 = Table(["Region","Revenue","Orders"], [["NA","$120k","540"],["EU","$80k","410"]])`;

/** A map answer is structured stops the server geocodes before each pin is
 *  emitted (docs/MAPS.md) — the table pattern (generate → enrich → fan out
 *  events), not the dashboard's opaque streamed spec. */
const MAP_SYSTEM = `You answer a places request as a MAP — real, specific places the user can actually visit: a trip itinerary, a day plan with stops, a shortlist of options, or a single recommended place. Return ONLY a JSON object:

{"title": string, "intro": string, "ordered": boolean, "stops": [{"name": string, "query": string, "day"?: string, "time"?: string, "note"?: string, "lat"?: number, "lng"?: number}]}

- "title": short and concrete ("Savandurga + Manchanabele day trip").
- "intro": ONE line of the reasoning behind the geometry ("both on the Magadi Road side, so drives stay short").
- "ordered": true when the stops form a visiting order (an itinerary/route); false when they are options to pick from (a shortlist, "temples near X") or a single place.
- "stops": 1–10 REAL places. Never invent a place; if you are not confident it exists, leave it out.
  - "name": what a person calls it ("Savandurga Trek").
  - "query": a REGION-QUALIFIED geocodable string — place, locality, state/region, country ("Savandurga Betta, Magadi, Karnataka, India"). This is looked up on a real geocoder; qualify it enough that the FIRST result is the right place, never a same-named place elsewhere.
  - "day"/"time": only for itineraries — "Day 1"/"Morning" and "6:30 AM" style. Omit for options.
  - "note": one tight line of judgement a friend would give ("steep but short (~2 km) — book the forest-dept slot early"). Omit if you have nothing real to say.
  - "lat"/"lng": your best-guess coordinates as a FALLBACK for when the geocoder misses — give them when you know the area, omit when unsure. The geocoder's answer wins when it resolves.
Ground stops in the provided sources when they name places; otherwise draw on what you reliably know (use web search if available to verify current names). No prose outside the JSON, no code fences.`;

/** How the widget itself is authored — the prototype card's rules shrunk to a
 *  single-concept teaching block (~460×320, rendered in a sandboxed iframe
 *  with no network). */
const WIDGET_SYSTEM = `You build ONE small interactive teaching widget as a self-contained HTML document. It illustrates exactly one concept, honestly, in whatever interaction form BEST TEACHES it: parameter sliders, a step-through of stages (Next/Play), drag-to-explore, a compare toggle, or a small run/pause simulation. The brief's "interaction" field is your starting point — improve on it if a better form teaches better.

HARD REQUIREMENTS — rendered in a sandboxed iframe with NO network access:
- Full document starting <!doctype html>; ALL CSS in one inline <style>, ALL JS in one inline <script>. No external resources of any kind.
- System font stack.
- FILL THE FRAME, RESPONSIVELY. The host already provides the ONE frame (a bordered, rounded panel) — do NOT draw your own outer card, border, or drop-shadow around everything; that makes an ugly card-within-a-card. Set html,body{margin:0;height:100%} and make your root fill 100% width AND 100% height with flexbox (display:flex;flex-direction:column). The frame size is VARIABLE (roughly 3:2, but it ranges from ~300px to ~900px wide) — never assume a fixed pixel size and never center a small fixed-size box in a large frame. Any canvas/SVG must stretch to its container (width:100%;height:100%, flex:1) and REDRAW on resize (a ResizeObserver on the canvas, or a window 'resize' listener) so it always fills, crisp, at any size. Breathing room comes from INTERNAL padding, not a dead outer margin.
- THEME: the host injects CSS custom properties — use them WITH fallbacks and invent no other colors:
  background: var(--jzw-surface, #fafafa); primary text/lines: var(--jzw-ink, #1a1a1a); secondary text: var(--jzw-muted, #6a6a6a); hairlines: var(--jzw-line, #d4d4d4); the ONE accent: var(--jzw-accent, #0f0f0f) with var(--jzw-accent-ink, #ffffff) on top.
- The interaction must actually drive the visual — canvas or SVG redrawn live. Use the REAL relationship (the brief's note pins formulas/values/sequences); label axes/stages and show a live readout. Never fake the shape of a curve.
- THE WIDGET INTRODUCES ITSELF: on load, run ONE brief (~1.2s) demonstration — animate the primary control/state through its range so the reader sees it is alive, then settle at the default. If matchMedia('(prefers-reduced-motion: reduce)') matches, skip the animation and show a small quiet "try it" hint instead.
- Keep it small and instant: no libraries, no images, under ~160 lines.

Output ONLY the raw HTML document — no prose, NO \`\`\` fences.`;

/** One widget per distinct brief per process — hydrations are cached so a doc
 *  re-render (or several viewers of the same card) never regenerates. */
const widgetCache = new Map<string, Promise<string | null>>();

/** The keyless demo widget: an honest drag-vs-speed interactive for
 *  aero-flavoured briefs, a designed "set a key" block for anything else. */
function demoWidgetHtml(concept: string): string {
  if (!/drag|aero|speed|force/i.test(concept)) {
    return '<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;background:#fafafa;color:#8a8a8a;font-size:13px">Set ANTHROPIC_API_KEY to generate this widget.</body></html>';
  }
  return `<!doctype html><html><head><style>
html,body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:var(--jzw-surface,#fafafa);color:var(--jzw-ink,#1a1a1a)}
.wrap{padding:14px 16px;display:flex;flex-direction:column;gap:10px;height:100vh;box-sizing:border-box}
.row{display:flex;gap:14px;align-items:center;font-size:12px}
.row label{color:var(--jzw-muted,#5a5a5a);font-weight:600}
.seg{display:flex;border:1px solid var(--jzw-line,#d4d4d4);border-radius:999px;overflow:hidden}
.seg button{border:none;background:transparent;padding:4px 12px;font:600 11px system-ui;cursor:pointer;color:var(--jzw-muted,#5a5a5a)}
.seg button.on{background:var(--jzw-accent,#0f0f0f);color:var(--jzw-accent-ink,#fff)}
canvas{flex:1;min-height:0;width:100%}
.read{font-size:12px;color:var(--jzw-muted,#5a5a5a)}.read b{color:var(--jzw-ink,#0f0f0f);font-variant-numeric:tabular-nums}
input[type=range]{accent-color:var(--jzw-accent,#0f0f0f);flex:1}
</style></head><body><div class="wrap">
<div class="row"><label>Speed</label><input id="v" type="range" min="10" max="140" value="80"><span class="read"><b id="vr">80</b> km/h</span></div>
<div class="row"><label>Body</label><div class="seg"><button id="sedan" class="on">Sedan (Cd 0.28)</button><button id="van">Van (Cd 0.38)</button></div><span class="read">Drag: <b id="fr">—</b> N</span></div>
<canvas id="c"></canvas></div><script>
const rho=1.225,A={sedan:2.2,van:3.4},Cd={sedan:0.28,van:0.38};let body='sedan';
const c=document.getElementById('c'),x=c.getContext('2d');
const v=document.getElementById('v'),vr=document.getElementById('vr'),fr=document.getElementById('fr');
function F(kmh,b){const ms=kmh/3.6;return .5*rho*Cd[b]*A[b]*ms*ms}
function draw(){const W=c.width=c.clientWidth*2,H=c.height=c.clientHeight*2;x.scale(1,1);
x.clearRect(0,0,W,H);const pad=56,maxV=140,maxF=F(maxV,'van')*1.05;
const cs=getComputedStyle(document.documentElement),C={ink:cs.getPropertyValue('--jzw-ink').trim()||'#1a1a1a',muted:cs.getPropertyValue('--jzw-muted').trim()||'#8a8a8a',line:cs.getPropertyValue('--jzw-line').trim()||'#d4d4d4',accent:cs.getPropertyValue('--jzw-accent').trim()||'#0f0f0f'};x.strokeStyle=C.line;x.lineWidth=2;x.beginPath();x.moveTo(pad,10);x.lineTo(pad,H-pad);x.lineTo(W-10,H-pad);x.stroke();
x.fillStyle=C.muted;x.font='20px system-ui';x.fillText('drag force (N)',pad+8,28);x.fillText('speed (km/h)',W-150,H-pad+34);
const px=k=>pad+(W-pad-20)*k/maxV, py=f=>H-pad-(H-pad-20)*f/maxF;
for(const b of['sedan','van']){x.strokeStyle=b===body?C.accent:C.line;x.lineWidth=b===body?4:2;x.beginPath();
for(let k=0;k<=maxV;k+=2){const X=px(k),Y=py(F(k,b));k?x.lineTo(X,Y):x.moveTo(X,Y)}x.stroke();}
const kv=+v.value,Y=py(F(kv,body)),X=px(kv);x.fillStyle=C.accent;x.beginPath();x.arc(X,Y,7,0,7);x.fill();
vr.textContent=kv;fr.textContent=F(kv,body).toFixed(0);}
v.oninput=draw;for(const id of['sedan','van'])document.getElementById(id).onclick=e=>{body=id;
document.querySelectorAll('.seg button').forEach(b=>b.classList.toggle('on',b.id===id));draw()};
new ResizeObserver(draw).observe(c);draw();
// The widget introduces itself: one ~1.2s sweep of the speed slider, then
// settle at the default. Reduced motion skips it.
if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
const t0=performance.now(),from=15,peak=140,home=80;
(function sweep(now){const k=Math.min(1,(now-t0)/1200);
v.value=Math.round(k<.7?from+(peak-from)*(k/.7):peak+(home-peak)*((k-.7)/.3));draw();
if(k<1)requestAnimationFrame(sweep)})(t0);}
</script></body></html>`;
}

/** Build (or replay) the widget for a doc's \`\`\`widget brief. Cached per
 *  brief; strips stray fences; null on failure (the block degrades). */
export async function generateWidgetHtml(briefRaw: string, signal: AbortSignal): Promise<string | null> {
  const key = briefRaw.trim();
  let inflight = widgetCache.get(key);
  if (!inflight) {
    inflight = (async () => {
      let concept = '';
      let controls: string[] = [];
      let note = '';
      try {
        const json = JSON.parse(key) as { concept?: unknown; controls?: unknown; note?: unknown };
        concept = typeof json.concept === 'string' ? json.concept.slice(0, 200) : '';
        controls = Array.isArray(json.controls) ? json.controls.map((c) => String(c).slice(0, 80)).slice(0, 3) : [];
        note = typeof json.note === 'string' ? json.note.slice(0, 300) : '';
      } catch {
        return null;
      }
      if (!concept.trim()) return null;
      if (!process.env.ANTHROPIC_API_KEY?.trim() && !sidecarAvailable()) return demoWidgetHtml(concept);
      const user = `Concept: ${concept}\nControls: ${controls.join('; ') || 'your call — the fewest that teach it'}${note ? `\nGround truth: ${note}` : ''}`;
      const raw = await generate(WIDGET_SYSTEM, user, signal, [], { prototype: true });
      const html = raw.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
      return html.toLowerCase().includes('<html') || html.toLowerCase().startsWith('<!doctype') ? html.slice(0, 60_000) : null;
    })().catch(() => null);
    widgetCache.set(key, inflight);
    void inflight.then((v) => {
      if (!v) widgetCache.delete(key); // a transient failure may succeed later
    });
  }
  return inflight;
}


/** Steers a doc/list answer to render as an interactive markdown checklist. */
/** A cross-document conflict/clause-diff request (→ the clause-diff table). */
function looksLikeDiff(prompt: string): boolean {
  return /\b(conflict|contradict|differ|discrepan|clause|reconcile|inconsisten|at odds)\b/i.test(prompt);
}


/** A research-intent ask (→ the deep pass, implicitly). The user shouldn't
 *  need a mode: "find reviews", "what do people say", "research this",
 *  "is this legit" ARE the research button. Deliberately does not match
 *  refine-bar phrasings ("Go deeper") or the PDF profile prompt ("red flags"
 *  as a section label) — those stay on the normal budget. */
function looksLikeResearch(prompt: string): boolean {
  return /\b(research|deep dive|dig (into|deeper|around)|investigate|due diligence|(find|get|check|pull|look up) (the )?(reviews?|ratings?|prices?|rates?)|reviews? (from|across|on|elsewhere)|what (do|are) (people|guests|users|reviewers|others) say(ing)?|reputation|is (it|this|that)( \w+)? (legit|safe|reliable|any good|worth it)|(any )?complaints? about|tell me everything|everything (about|you can find)|(compare|find) alternatives?|(scout|vet) (this|it|the))\b/i.test(
    prompt,
  );
}

/* ─── Disambiguation ────────────────────────────────────────────────────────
 * A cheap gate decides whether a request is even worth questioning; only then
 * do we spend a triage call. We bias hard toward acting — over-asking is worse
 * than a reversible wrong guess (Keep/Discard + undo already cover that). */

const TRIAGE_SYSTEM = `You triage a user's request about some canvas sources and decide if it is clear enough to act on. Respond with ONLY a JSON object — no prose, no code fences.
- If you can tell what single artifact to produce, return {"clear": true}.
- If it is genuinely ambiguous (no clear verb or output, or it could reasonably mean very different things with these sources), return {"clear": false, "question": "<one short question, max ~12 words>", "options": ["<2-4 short, concrete artifact choices>"]}.
Strongly prefer {"clear": true}; only ask when truly unsure. Options must be tappable artifact choices like "Comparison table", "Summary doc", "Diagram", "Sticky notes" — not open-ended.`;

/** Cheap gate: is this request vague enough that a triage call is worth it?
 *  A recognizable verb/output word means it's clear — never ask. */
function looksAmbiguous(prompt: string, sources: AskSource[]): boolean {
  const p = prompt.trim().toLowerCase();
  const hasVerb =
    /\b(summari|compare|comparison|versus|\bvs\b|list|bullet|table|matrix|diagram|flow|chart|mind ?map|timeline|gantt|sequence|brainstorm|cluster|affinity|extract|action|checklist|to-?do|write|draft|explain|describe|outline|rewrite|shorten|expand|translate|plan|map out|turn (this|these) into|as an?)\b/.test(
      p,
    );
  if (hasVerb) return false;
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return true; // "do this", "these two", "help" …
  if (/^(do something|something|anything|help|fix|make (it|this) better|use these|work with these|what (can|should)|any ideas|ideas|combine|merge)\b/.test(p))
    return true;
  // Several sources of different kinds, with no clear verb → likely unclear.
  const kinds = new Set(sources.map((s) => s.kind));
  return sources.length >= 2 && kinds.size >= 2;
}

/** Run a triage pass when (and only when) the request looks ambiguous. Returns a
 *  question + options to ask, or null to proceed. Failures degrade to proceed. */
async function maybeClarify(
  req: AskRequest,
  signal: AbortSignal,
): Promise<{ question: string; options: string[] } | null> {
  if (!looksAmbiguous(req.prompt, req.sources)) return null;
  const srcDesc =
    req.sources.map((s, i) => `${i + 1}. ${s.kind}${s.title ? ` "${s.title}"` : ''}`).join('\n') || '(none)';
  // With no source attached, the canvas card titles often resolve what a bare
  // reference means — don't ask "who is he?" when a "Nolan's films" card is
  // sitting right there.
  const boardDesc =
    req.sources.length === 0 && req.boardIndex && req.boardIndex.length > 0
      ? `\n\nCards on the user's canvas (titles):\n${req.boardIndex.slice(0, 40).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '';
  let raw: string;
  try {
    raw = await generate(TRIAGE_SYSTEM, `Request: "${req.prompt}"\n\nSelected sources:\n${srcDesc}${boardDesc}`, signal);
  } catch {
    return null; // never block the ask on triage
  }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
      clear?: unknown;
      question?: unknown;
      options?: unknown;
    };
    if (j.clear === false && typeof j.question === 'string' && Array.isArray(j.options)) {
      const options = j.options.map((o) => String(o).slice(0, 40).trim()).filter(Boolean).slice(0, 4);
      const question = j.question.trim().slice(0, 160);
      if (question && options.length >= 2) return { question, options };
    }
  } catch {
    /* not clean JSON — proceed */
  }
  return null;
}

const SEED_SYSTEM = `You are given the text of a card on a user's canvas (a dropped document, or an answer they are working through). Propose the 3 or 4 most useful NEXT MOVES for this reader — anticipate where they would drill in from here: go deeper on the pivotal claim, challenge the weakest assumption, connect it to a decision, extract what is actionable. Each must be SPECIFIC to this text (name the clause, the metric, the section) — never generic like "Summarize this".

Match each move's phrasing to the answer's best FORMAT — the canvas picks the response card from the prompt's wording:
- If the text holds two or more comparable things (concepts, options, approaches, parties, methods, versions), include ONE move that compares them. Its "prompt" MUST use comparison wording ("Compare X and Y side by side", "X versus Y") so the answer lands as a comparison table; make the "label" name both sides (e.g. "Compare X vs Y").
- If the text implies obligations or actions, phrase that move as a checklist ("Turn the … requirements into a checklist").
- If the text is ITSELF a review naming gaps, unanswered questions, or contradictions (a "what's missing" / "tensions" scan of other work), the moves must CREATE or RESOLVE — one per named gap, most consequential first, phrased as generation ("Draft the success metrics for the beta", "Write the rollback plan", "Propose a decision rule for date vs quality"). The scan found the problem; each pill offers its solution.
- Why/how/deep-dive moves stay plain questions (prose answers).

Return ONLY a JSON array of objects {"label": string, "prompt": string}: "label" is a 2–4 word button caption; "prompt" is the full question to ask. No prose, no code fences.`;

export interface SeedPrompt {
  label: string;
  prompt: string;
}

/** Predefined, content-aware Ask prompts for a freshly dropped PDF. */
export async function proposeSeedPrompts(
  source: { assetId?: string; text?: string; title?: string },
  signal: AbortSignal,
): Promise<SeedPrompt[]> {
  // Two sources: a stored PDF (by asset id) or inline card text — so every
  // contentful card gets pills about ITS content, not canned per-type strings.
  let content = '';
  if (source.assetId) {
    const extracted = await extractAssetText(source.assetId, 8_000);
    content = extracted?.text ?? '';
  } else if (source.text) {
    content = source.title ? `${source.title}\n\n${source.text}` : source.text;
  }
  if (!content.trim()) return [];
  let raw: string;
  try {
    raw = await generate(SEED_SYSTEM, `Document text:\n"""\n${content.slice(0, 8_000)}\n"""`, signal);
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    if (!Array.isArray(parsed)) return [];
    const out: SeedPrompt[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const label = String((item as Record<string, unknown>).label ?? '').trim();
      const prompt = String((item as Record<string, unknown>).prompt ?? '').trim();
      // Cap long labels at a word boundary with an ellipsis — a hard slice
      // produced pills like "Challenge type-stability assumpt".
      const capped =
        label.length <= 36 ? label : `${label.slice(0, 35).replace(/\s+\S*$/, '')}…`;
      if (label && prompt) out.push({ label: capped, prompt: prompt.slice(0, 400) });
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

function pickShape(_prompt: string, current?: AskShape): AskShape {
  // NO implicit shape detection from the prompt text — the response shape is
  // driven ONLY by the explicit "/" mode (sent as req.shape) (owner call
  // 2026-07-07). Here we handle just the two non-explicit cases:
  //  - an in-place refine keeps the card's OWN current shape, so a tweak
  //    ("add a node", "make it shorter") regenerates that same card rather than
  //    morphing into a different artefact;
  //  - everything else defaults to a doc (the first-class default).
  if (current) return current;
  return 'doc';
}

/** A vision input destined for an Anthropic image block. */
interface ImageInput {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
  title: string;
}

/** At most this many images per Ask (keeps the request and token cost bounded).
 *  Watched-video frames raised this from 4 — a video IS many small images. */
const MAX_IMAGES = 14;
/** Skip an image whose base64 is larger than the model accepts (~5MB raw). */
const MAX_IMAGE_CHARS = 7_000_000;

/** Parse a `data:image/...;base64,...` URL into an Anthropic image input. */
function parseImageDataUrl(dataUrl: string, title: string): ImageInput | null {
  const m = /^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  let mediaType = m[1]!.toLowerCase();
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
  const data = m[2]!;
  if (data.length > MAX_IMAGE_CHARS) return null;
  return { mediaType: mediaType as ImageInput['mediaType'], data, title };
}

async function gatherContext(
  req: AskRequest,
): Promise<{
  context: string;
  images: ImageInput[];
  framePaths: string[];
  imageData: ImageInput[];
}> {
  const parts: string[] = [];
  const images: ImageInput[] = [];
  /** Server-local frame files — the CLI sidecar Reads these (it can't take base64). */
  const framePaths: string[] = [];
  /** Image-card base64 (no file on disk) — the sidecar writes+Reads these so
   *  a dropped image is visible in dev too, not just on the API path. */
  const imageData: ImageInput[] = [];
  let i = 0;
  for (const s of req.sources) {
    i += 1;
    const head = `Source ${i} (${s.kind}${s.title ? `: ${s.title}` : ''}${s.url ? ` — ${s.url}` : ''}):`;
    // Watched-video frames become vision inputs, evenly thinned to the budget.
    if (s.frameAssetIds?.length) {
      const room = Math.max(0, MAX_IMAGES - images.length);
      const pick =
        s.frameAssetIds.length <= room
          ? s.frameAssetIds
          : Array.from({ length: room }, (_, k) =>
              s.frameAssetIds![Math.floor((k * (s.frameAssetIds!.length - 1)) / Math.max(1, room - 1))]!,
            );
      let loaded = 0;
      for (const fid of pick) {
        const buf = await getAsset(fid);
        if (!buf) continue;
        images.push({ mediaType: 'image/jpeg', data: buf.toString('base64'), title: `${s.title ?? 'video'} frame ${loaded + 1}` });
        const p = assetPath(fid);
        if (p) framePaths.push(p);
        loaded += 1;
      }
      if (loaded > 0) {
        parts.push(`${head}\n(${loaded} sampled frames from this video are attached as images, in time order.)${s.text?.trim() ? `\n"""\n${s.text.trim().slice(0, PER_SOURCE_CHARS)}\n"""` : ''}`);
        continue;
      }
    }
    if (s.kind === 'image' && s.dataUrl) {
      const img = images.length < MAX_IMAGES ? parseImageDataUrl(s.dataUrl, s.title || `Image ${i}`) : null;
      if (img) {
        images.push(img); // API path: a vision block
        imageData.push(img); // sidecar path: written to a temp file and Read
        parts.push(`${head}\n(Image attached — provided as a vision input.)`);
      } else {
        parts.push(`${head}\n(Image could not be read.)`);
      }
      continue;
    }
    if (s.assetId && s.kind === 'sheet') {
      // A spreadsheet grounds on its cells (CSV-ish per sheet), not PDF pages.
      const csv = await extractSheetText(s.assetId, PER_SOURCE_CHARS * 2);
      if (csv.trim()) parts.push(`${head}\n"""\n${csv}\n"""`);
      else parts.push(`${head}\n(Spreadsheet could not be read.)`);
      continue;
    }
    if (s.assetId) {
      // Page-tagged text lets the model cite pages as [p.N].
      const pages = await extractAssetPages(s.assetId, 3_500);
      if (pages.length > 0 && pages.some((p) => p)) {
        const tagged = pages
          .map((p, idx) => (p ? `[p.${idx + 1}] ${p}` : ''))
          .filter(Boolean)
          .join('\n')
          .slice(0, PER_SOURCE_CHARS * 2);
        parts.push(`${head}\n"""\n${tagged}\n"""`);
        continue;
      }
      const extracted = await extractAssetText(s.assetId, PER_SOURCE_CHARS);
      if (extracted?.text) {
        parts.push(`${head}\n"""\n${extracted.text}\n"""`);
        continue;
      }
      parts.push(`${head}\n(No readable text — likely a scanned/image PDF.)`);
      continue;
    }
    if (s.text?.trim()) parts.push(`${head}\n"""\n${s.text.trim().slice(0, PER_SOURCE_CHARS)}\n"""`);
    else parts.push(head);
  }
  return { context: parts.join('\n\n'), images, framePaths, imageData };
}

/** Build the user message content — a plain string, or text + image blocks when
 *  vision inputs are present (API path only). */
function buildContent(user: string, images: ImageInput[]): Anthropic.MessageParam['content'] {
  if (images.length === 0) return user;
  return [
    { type: 'text', text: user },
    ...images.map(
      (im): Anthropic.ImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: im.mediaType, data: im.data },
      }),
    ),
  ];
}

/** The dev sidecar is text-only — fold a note about any images into the prompt. */
function withImageNote(user: string, images: ImageInput[]): string {
  if (images.length === 0) return user;
  const names = images.map((im) => im.title).join(', ');
  return `${user}\n\n[${images.length} image(s) attached: ${names}. They are NOT visible in this text-only mode — answer from the text, and say plainly if the image is essential and you cannot see it.]`;
}

/** `web: true` hands the model live search/fetch tools; `deep: true` upgrades
 *  to the research budget (more searches/fetches, longer output, more time);
 *  `framePaths` lets the text-only sidecar SEE video frames by Reading files;
 *  `imageData` does the same for dropped image cards (base64 → temp file). */
interface GenOpts {
  web?: boolean;
  deep?: boolean;
  /** A prototype card — a long HTML document: bigger token + sidecar budget. */
  prototype?: boolean;
  framePaths?: string[];
  imageData?: ImageInput[];
  /** Client-executed tools (e.g. find_image): offered alongside the server
   *  web tools; when the model calls one, `run` executes it here and the
   *  turn continues with its result. API path only — the CLI sidecar can't
   *  call back into this process (its prompt carries a fallback instead). */
  clientTools?: {
    tools: Anthropic.Tool[];
    run: (name: string, input: unknown) => Promise<string>;
    /** Presence line shown on the avatar while a call runs. */
    status: string;
  };
}

/** The find_image bundle offered to every web-enabled answer (research,
 *  table, doc/list). One shared instance — it's stateless; the prompts gate
 *  when an image is actually warranted. */
const FIND_IMAGE_CLIENT: NonNullable<GenOpts['clientTools']> = {
  tools: [FIND_IMAGE_TOOL],
  run: (name, input) =>
    name === 'find_image' ? runFindImage(input) : Promise.resolve('{"error":"unknown tool"}'),
  status: 'finding a real image…',
};

/** The per-mode generation budget the two generators share. */
function genBudget(opts: GenOpts) {
  return {
    tools: opts.deep ? researchToolset() : opts.web ? webToolset() : undefined,
    // `prototype` outranks `deep` on tokens: a deep+prototype run (the rich
    // research card) writes a spec with quoted prose blocks and needs the
    // document-sized ceiling, not the compact dossier one.
    maxTokens: opts.prototype ? PROTOTYPE_MAX_TOKENS : opts.deep ? RESEARCH_MAX_TOKENS : MAX_TOKENS,
    maxTurns: opts.deep ? RESEARCH_MAX_CONTINUATIONS : WEB_MAX_CONTINUATIONS,
    sidecarTimeoutMs: opts.deep
      ? RESEARCH_SIDECAR_TIMEOUT_MS
      : opts.prototype
        ? PROTOTYPE_SIDECAR_TIMEOUT_MS
        : undefined,
  };
}

async function generate(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): Promise<string> {
  const { tools, maxTokens, maxTurns, sidecarTimeoutMs } = genBudget(opts);
  if (hasModelKey()) {
    const client = anthropic();
    const allTools = [...(tools ?? []), ...(opts.clientTools?.tools ?? [])];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildContent(user, images) },
    ];
    let text = '';
    // Server tools may pause a long turn (stop_reason "pause_turn") and client
    // tools stop it outright (stop_reason "tool_use"); both resume by replaying
    // the assistant content (plus tool results) until the model finishes.
    for (let turn = 0; turn <= maxTurns; turn++) {
      const msg = await client.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          system,
          messages,
          ...(allTools.length ? { tools: allTools } : {}),
        },
        { signal },
      );
      text += msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (msg.stop_reason === 'tool_use' && opts.clientTools) {
        const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (calls.length > 0) {
          const results = await Promise.all(
            calls.map(async (c) => ({
              type: 'tool_result' as const,
              tool_use_id: c.id,
              content: await opts.clientTools!.run(c.name, c.input),
            })),
          );
          messages.push({ role: 'assistant', content: msg.content });
          messages.push({ role: 'user', content: results });
          continue;
        }
      }
      if (!allTools.length || msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content });
    }
    return text;
  }
  if (sidecarAvailable()) {
    const canSee = Boolean(opts.framePaths?.length || opts.imageData?.length);
    return sidecarGenerate({
      system,
      user: canSee ? user : withImageNote(user, images),
      signal,
      web: opts.web || opts.deep,
      imagePaths: opts.framePaths,
      imageData: opts.imageData,
      timeoutMs: sidecarTimeoutMs,
    });
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

/**
 * Stream the answer as text deltas. With an API key (the production path) this
 * is genuine token-by-token streaming via the Anthropic SDK, so the canvas fills
 * as the model writes and a long answer never waits on one big call. The CLI
 * sidecar (dev only) can't token-stream, so it generates once and chunks the
 * result to approximate the same feel.
 */
/** What generateStream yields: body text, or a live status ("searching…"). */
type GenEvent = { type: 'text'; text: string } | { type: 'status'; message: string };

async function* generateStream(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): AsyncGenerator<GenEvent> {
  const { tools, maxTokens, maxTurns, sidecarTimeoutMs } = genBudget(opts);
  if (hasModelKey()) {
    const client = anthropic();
    const allTools = [...(tools ?? []), ...(opts.clientTools?.tools ?? [])];
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildContent(user, images) },
    ];
    // Server tools may pause a long turn (stop_reason "pause_turn") and client
    // tools stop it outright (stop_reason "tool_use"); both resume by replaying
    // the assistant content (plus tool results) until the model finishes.
    for (let turn = 0; turn <= maxTurns; turn++) {
      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          system,
          messages,
          ...(allTools.length ? { tools: allTools } : {}),
        },
        { signal },
      );
      for await (const event of stream) {
        if (signal.aborted) return;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        } else if (
          event.type === 'content_block_start' &&
          event.content_block.type === 'server_tool_use'
        ) {
          yield {
            type: 'status',
            message:
              event.content_block.name === 'web_fetch' ? 'reading a page…' : 'searching the web…',
          };
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'tool_use' && opts.clientTools) {
        const calls = final.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (calls.length > 0) {
          yield { type: 'status', message: opts.clientTools.status };
          const results = await Promise.all(
            calls.map(async (c) => ({
              type: 'tool_result' as const,
              tool_use_id: c.id,
              content: await opts.clientTools!.run(c.name, c.input),
            })),
          );
          messages.push({ role: 'assistant', content: final.content });
          messages.push({ role: 'user', content: results });
          continue;
        }
      }
      if (!allTools.length || final.stop_reason !== 'pause_turn') return;
      messages.push({ role: 'assistant', content: final.content });
    }
    return;
  }
  if (sidecarAvailable()) {
    const canSee = Boolean(opts.framePaths?.length || opts.imageData?.length);
    const text = await sidecarGenerate({
      system,
      user: canSee ? user : withImageNote(user, images),
      signal,
      web: opts.web || opts.deep,
      imagePaths: opts.framePaths,
      imageData: opts.imageData,
      timeoutMs: sidecarTimeoutMs,
    });
    for (const piece of chunk(text)) {
      if (signal.aborted) return;
      yield { type: 'text', text: piece };
      await sleep(18, signal);
    }
    return;
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}

function chunk(text: string, size = 6): string[] {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Scripted demo answer — every other AI route degrades to a mock without a
 *  key; Ask was the lone exception (it used to throw). A canned doc keeps the
 *  full loop demoable and makes the missing-key state self-explanatory. */
async function* streamDemoAsk(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  yield { type: 'status', message: 'Demo mode…' };

  // A dashboard ask has a concrete shape to show even without a model — stream a
  // small canned OpenUI Lang spec so the generative-UI card is demoable keyless.
  if (req.shape === 'dashboard') {
    yield { type: 'card.create', shape: 'dashboard' };
    const spec = [
      'root = Stack([kpis, charts, tbl], "column")',
      'kpis = Grid([k1, k2, k3], 3)',
      'k1 = Kpi("Total", "—", "demo mode")',
      'k2 = Kpi("Rows", "—", "")',
      'k3 = Kpi("Average", "—", "")',
      'charts = Grid([bar, line], 2)',
      'bar = BarChart("By category", ["A", "B", "C", "D"], [8, 6, 4, 3])',
      'line = LineChart("Over time", ["Q1", "Q2", "Q3", "Q4"], [4, 6, 5, 7])',
      'tbl = Card("Set a key for a real dashboard", [t1])',
      't1 = Table(["Column", "Value"], [["Model", "not configured"], ["Fix", "get full access — see the boards panel"]])',
    ].join('\n');
    for (const piece of chunk(spec, 4)) {
      if (signal.aborted) return;
      yield { type: 'card.delta', textDelta: piece };
      await sleep(20, signal);
    }
    yield { type: 'card.done' };
    yield { type: 'done' };
    return;
  }

  // A map ask has a concrete shape to show even without a model — drop a
  // canned Bengaluru day trip pin by pin (real places, hard-coded coordinates,
  // no geocoder) so the map card is demoable keyless.
  if (req.shape === 'map') {
    yield {
      type: 'card.create',
      shape: 'map',
      title: 'Savandurga + Manchanabele day trip (demo)',
      intro: 'Both sit on the Magadi Road side of Bengaluru, so drives between stops stay short.',
      ordered: true,
    };
    const stops = [
      { name: 'Savandurga Trek', query: 'Savandurga Betta, Magadi, Karnataka, India', lat: 12.9194, lng: 77.2926, day: 'Morning', time: '6:30 AM', note: 'Steep but short (~2 km) — set a key for a real, planned trip.' },
      { name: 'Dodda Alada Mara', query: 'Dodda Alada Mara, Ramohalli, Karnataka, India', lat: 12.9226, lng: 77.3934, day: 'Morning', time: '12:30 PM', note: 'The 400-year-old banyan — an easy lunch-side stop.' },
      { name: 'Manchanabele Dam', query: 'Manchanabele Dam, Karnataka, India', lat: 12.9401, lng: 77.3427, day: 'Afternoon', time: '4:30 PM', note: 'Timed late on purpose — it’s a sunset spot.' },
    ];
    for (let i = 0; i < stops.length; i++) {
      if (signal.aborted) return;
      yield { type: 'map.pin', index: i, stop: stops[i]! };
      await sleep(340, signal);
    }
    yield { type: 'card.done' };
    yield { type: 'done' };
    return;
  }

  // A places-flavoured prompt shows the inline map block even keyless — the
  // demo doc carries a map fence with real, hard-coded coordinates so the doc
  // path (DocMarkdown → DocMapBlock) is demoable with zero keys and no
  // geocoder. Any other prompt gets the plain explainer doc.
  const placey = /\b(trip|itinerar|travel|visit|places?|near|temple|restaurant|caf[eé]|beach|trek|route|weekend)\b/i.test(req.prompt);
  // A concept-flavoured prompt demos the inline WIDGET block the same way a
  // places prompt demos the map block — the fence carries the brief and the
  // /api/widget hydrator returns the canned keyless interactive.
  const concepty = !placey && /\b(drag|aerodynamic|physics|force|explain|why|how does|dynamics)\b/i.test(req.prompt);
  yield {
    type: 'card.create',
    shape: 'doc',
    title: placey ? 'Day trip — Savandurga + Manchanabele (demo)' : concepty ? 'Drag: why the van loses (demo)' : 'Demo mode',
  };
  if (concepty) {
    const widgetFence = [
      '```widget',
      JSON.stringify({
        concept: 'drag force vs speed for different body shapes',
        interaction: 'speed slider + sedan/van toggle drive the force curve',
        note: 'F = 1/2 * rho * Cd * A * v^2; van Cd ~0.38 A ~3.4, sedan Cd ~0.28 A ~2.2',
      }),
      '```',
    ].join('\n');
    const conceptBody = `Drag force grows with the **square** of speed — double your speed and the air pushes back four times as hard. *(Demo mode — set a key for a real, grounded answer.)*\n\n${widgetFence}\n\nA van suffers twice: its drag coefficient is higher (boxy nose, hard edges — Cd ≈ 0.38 vs a sedan's ≈ 0.28) **and** its frontal area is bigger (≈ 3.4 m² vs ≈ 2.2 m²). Multiply those through F = ½ρC_dAv² and at highway speed the van is fighting roughly **twice the drag force** — which is why its fuel economy falls off a cliff above 90 km/h while the sedan's merely sags.`;
    for (const piece of chunk(conceptBody)) {
      if (signal.aborted) return;
      yield { type: 'card.delta', textDelta: piece };
      await sleep(24, signal);
    }
    yield { type: 'card.done' };
    yield { type: 'done' };
    return;
  }
  const mapFence = [
    '```map',
    JSON.stringify({
      ordered: true,
      stops: [
        { name: 'Savandurga Trek', query: 'Savandurga Betta, Magadi, Karnataka, India', day: 'Morning', time: '6:30 AM', note: 'Steep but short (~2 km) — book the slot early.', lat: 12.9194, lng: 77.2926 },
        { name: 'Dodda Alada Mara', query: 'Dodda Alada Mara, Ramohalli, Karnataka, India', day: 'Morning', time: '12:30 PM', note: 'The 400-year-old banyan — an easy lunch-side stop.', lat: 12.9226, lng: 77.3934 },
        { name: 'Manchanabele Dam', query: 'Manchanabele Dam, Karnataka, India', day: 'Afternoon', time: '4:30 PM', note: 'Timed late on purpose — it’s a sunset spot.', lat: 12.9401, lng: 77.3427 },
      ],
    }),
    '```',
  ].join('\n');
  const body = placey
    ? `Here's a solid nature-and-outdoors day out — Savandurga + Manchanabele, both on the Magadi Road side, so the drive between them is quick. *(Demo mode — set a key for a real, planned answer.)*\n\n${mapFence}\n\n**The plan**\n- **5:30 AM** — Leave Bengaluru; Magadi Road before the traffic wakes up.\n- **6:30 AM** — **Savandurga trek** — steep but short (~2 km). Book the forest-dept slot the night before.\n- **12:30 PM** — **Dodda Alada Mara** — lunch near the 400-year-old banyan.\n- **4:30 PM** — **Manchanabele Dam** — timed late on purpose: it's a sunset spot.\n- **7:30 PM** — Back in the city, dinner earned.`
    : `You asked: *${req.prompt.slice(0, 140)}*\n\n` +
      'Jarwiz is running without a model — add your Anthropic API key (key ' +
      'button, top right) and real answers will stream onto the board ' +
      'exactly like this one, grounded on the cards you selected.';
  for (const piece of chunk(body)) {
    if (signal.aborted) return;
    yield { type: 'card.delta', textDelta: piece };
    await sleep(24, signal);
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/** Edit-vs-new intent for a typed composer instruction on a selected card.
 *  Static system prompt (cache-friendly); the card type + instruction ride the
 *  user turn. Biased to NEW when unsure — a new card never overwrites work. */
const INTENT_SYSTEM = `A user has ONE card selected on a canvas and typed an instruction. Decide if they want to MODIFY that selected card in place (EDIT) or produce a NEW separate card derived from it (NEW).

EDIT = change the selected card's OWN content/structure/appearance — the instruction is a command to alter THIS card (shorten, expand, rephrase, translate, fix, proofread, restyle; add/remove/reorder/sort/filter/rename/highlight its parts; add a column/row/section/node/chart/KPI/screen; recompute; "focus it on X", "make it <adjective>", "change the <part>"). Reshaping a table's own rows/columns is EDIT — keeping only some rows, dropping/adding a column, ordering/sorting by a field, transposing, appending a total.

NEW = produce a separate piece of writing, analysis, or an answer ABOUT the card, leaving it untouched (summarize, explain, describe, critique, review; "what are/what could/which is…"; write an email/tweet/copy/summary/recommendation/action plan; brainstorm; compare). Asking for prose or answers is NEW even when it says "this" or "based on this". Asking to POINT OUT / FLAG / CALL OUT / SPOT / PULL OUT the notable things (anomalies, highlights, weak spots, key movements) is analysis → NEW — it reports about the card, it does not change it.

Examples:
"make it shorter" → EDIT
"expand this with more detail" → EDIT
"translate to Spanish" → EDIT
"fix the grammar" → EDIT
"remove the last paragraph" → EDIT
"change the title to Q3 Review" → EDIT
"add a column for margin" → EDIT
"sort by date" → EDIT
"focus on APAC only" → EDIT
"add a KPI for churn" → EDIT
"make it dark mode" → EDIT
"add a footer with links" → EDIT
"summarize this" → NEW
"what are the risks here" → NEW
"list the pros and cons" → NEW
"explain this to a beginner" → NEW
"critique this" → NEW
"write an email about this" → NEW
"write marketing copy for this" → NEW
"what could go wrong in this flow" → NEW
"which option is best and why" → NEW
"turn this into an action plan" → NEW

Answer EDIT when the instruction is a clear command to change THIS card (as in the EDIT examples — a direct change to its own content, structure, or appearance). If you genuinely cannot tell, or it could just as reasonably be a separate piece of work, answer NEW — a new card is safe and never overwrites their work. Reply with EXACTLY one word: EDIT or NEW.`;

export async function classifyRefineIntent(
  prompt: string,
  cardType: string,
  signal: AbortSignal,
): Promise<'edit' | 'new'> {
  let raw: string;
  try {
    raw = await generate(INTENT_SYSTEM, `Selected card: ${cardType || 'card'}\nInstruction: "${prompt.slice(0, 400)}"`, signal);
  } catch {
    return 'new'; // never block on the classifier — default to the safe path
  }
  // Edit ONLY on a clear, unambiguous EDIT verdict. Anything else — a NEW, an
  // undecided/mixed answer ("EDIT or NEW"), or empty — falls back to a new card
  // (the safe default: it never overwrites the user's work).
  const ans = raw.trim().toUpperCase();
  return ans.startsWith('EDIT') && !ans.includes('NEW') ? 'edit' : 'new';
}

/** Which referenced card (if any) the prompt asks to modify in place — the
 *  multi-@mention case: "rewrite @Board Update using @Q2 Revenue" targets the
 *  Board Update card, with Q2 Revenue as source material. The TARGET is read
 *  from the prompt itself, not from which card is selected. Static system
 *  prompt (cache-friendly); the card list + instruction ride the user turn.
 *  Biased to NEW when unsure — a new card never overwrites work. */
const MENTION_TARGET_SYSTEM = `A user typed an instruction into a canvas composer, referencing one or more cards by @mention. The referenced cards are listed with a number, title, and type. Decide whether the instruction asks to MODIFY one of those cards IN PLACE — and if so, WHICH one — or to produce a NEW separate card.

Reply with EXACTLY one of:
- NEW — the instruction produces a new, separate card: it summarizes, compares, critiques, or synthesizes a fresh artifact FROM the referenced cards, leaving them untouched. This is the default whenever you cannot clearly tell which single card is being changed.
- EDIT <n> — the instruction is a command to change card number <n>'s OWN content in place (rewrite it, fill it in, update/expand/restructure/rename THAT card), using any other referenced cards as source material.

Read the verb and its object: the TARGET is the card the instruction says to change. Only a card whose type can be edited in place — doc, table, diagram, prototype, dashboard, map — can be a target. A pdf, image, link, video, sheet, or note can never be the target → NEW.

Examples:
Cards: 1. "Board Update" (doc)  2. "Q2 Revenue" (doc)
Instruction: "rewrite this using the figures from Q2 Revenue" → EDIT 1
Cards: 1. "Q2 Revenue" (doc)  2. "Competitor Analysis" (doc)
Instruction: "compare these in a table" → NEW
Cards: 1. "Roadmap" (table)  2. "Customer Feedback" (doc)
Instruction: "add a priority column to the roadmap based on the feedback" → EDIT 1
Cards: 1. "Launch Plan" (doc)  2. "Risks" (doc)
Instruction: "fold the risks into the launch plan" → EDIT 1
Cards: 1. "Pricing" (table)  2. "Notes" (doc)
Instruction: "draft an email summarizing both" → NEW
Cards: 1. "Report" (pdf)  2. "Sales Data" (sheet)
Instruction: "update the report with the sales data" → NEW
Cards: 1. "Onboarding Flow" (diagram)  2. "New Steps" (doc)
Instruction: "add the new steps to the flow" → EDIT 1

Reply with EXACTLY \`NEW\` or \`EDIT <n>\` where <n> is a card number.`;

export async function classifyMentionTarget(
  prompt: string,
  cards: Array<{ title: string; type: string }>,
  signal: AbortSignal,
): Promise<number | null> {
  if (cards.length === 0 || !prompt.trim()) return null;
  const list = cards
    .map((c, i) => `${i + 1}. "${c.title || 'Untitled'}" (${(c.type || 'card').replace(/-card$/, '')})`)
    .join('\n');
  let raw: string;
  try {
    raw = await generate(
      MENTION_TARGET_SYSTEM,
      `Referenced cards:\n${list}\n\nInstruction: "${prompt.slice(0, 400)}"`,
      signal,
    );
  } catch {
    return null; // never block on the classifier — default to a new card
  }
  // A clear "EDIT <n>" (n in range) picks the target; anything else → new card.
  const m = raw.trim().toUpperCase().match(/^EDIT\s+(\d+)/);
  if (!m) return null;
  const idx = Number.parseInt(m[1]!, 10) - 1;
  return idx >= 0 && idx < cards.length ? idx : null;
}

/** Suggest which response SHAPE a from-scratch prompt wants, so the composer can
 *  pre-pin the "/" mode chip as the user types (they can always change it — the
 *  shape stays explicit). Model-inferred, not keyword-matched. Biased to DOC
 *  (→ no chip, the default) unless a non-doc shape clearly fits — a wrong chip
 *  is more annoying than none. */
const SHAPE_SUGGEST_SYSTEM = `A user is typing a request into a canvas app that answers as ONE of these four card shapes. Pick the single best fit for their (possibly partial) prompt:

- DOC — the rich DEFAULT. Written prose AND anything that lives inside a document: an essay, summary, explanation, email, memo, brief, a bullet LIST or checklist, a TABLE / comparison / grid, a set of PLACES or a trip itinerary (a doc can embed a live map), a "top N", pros and cons. Choose DOC whenever the answer is text, or text with a table / list / map / image in it — which is most requests.
- PROTOTYPE — a live, rendered, interactive UI: an app, screen, form, widget, game, landing page, signup, timer, calculator.
- DASHBOARD — turning DATA into an interactive view of KPIs, charts and a table: "dashboard of…", "visualise the… data/metrics/sales/revenue", analytics/KPIs/scorecard.
- FLOW — a flowchart or graph of boxes and arrows: a process flow, architecture, sequence, org chart, mind map, "how X works" as a diagram.

Examples:
"write a blog post about remote work" → DOC
"summarize the meeting notes" → DOC
"compare the top 3 CRMs" → DOC
"pros and cons of remote work" → DOC
"checklist for launch day" → DOC
"plan a day trip from Bengaluru with a trek and a waterfall" → DOC
"good temples near Mysore" → DOC
"build a pomodoro timer" → PROTOTYPE
"a signup form with validation" → PROTOTYPE
"landing page for a coffee app" → PROTOTYPE
"dashboard of Q2 sales" → DASHBOARD
"visualise revenue by region" → DASHBOARD
"kpis for our SaaS metrics" → DASHBOARD
"flowchart of the onboarding process" → FLOW
"architecture of our payments system" → FLOW

Reply with EXACTLY one word: DOC, PROTOTYPE, DASHBOARD, or FLOW.`;

// FLOW maps to the diagram shape under the hood. table/list/map are no longer
// suggestable — those answers are rich docs now (owner call 2026-07-20).
const SUGGESTABLE = new Set(['doc', 'prototype', 'dashboard', 'flow', 'diagram']);

export async function suggestShape(prompt: string, signal: AbortSignal): Promise<string | null> {
  const p = prompt.trim();
  if (p.length < 4) return null;
  let raw: string;
  try {
    raw = await generate(SHAPE_SUGGEST_SYSTEM, `Prompt: "${p.slice(0, 400)}"`, signal);
  } catch {
    return null; // no suggestion on error — the "/" menu still works
  }
  // First alpha word of the reply, lowercased. DOC → null (it's the default:
  // no chip). Anything unrecognised → null (don't pin a wrong guess).
  const word = (raw.trim().toLowerCase().match(/[a-z]+/)?.[0]) ?? '';
  if (!SUGGESTABLE.has(word) || word === 'doc') return null;
  // "flow" is the label; the shape under the hood is still 'diagram'.
  return word === 'flow' ? 'diagram' : word;
}

/* ── Structured block answer (rich-card rebuild, 2026-07-20) ─────────────────
 * The doc answer is composed as a STREAM OF TYPED BLOCKS the model emits as
 * newline-delimited JSON — one block object per line. Text blocks (heading /
 * paragraph / list / checklist / table / divider) pass straight through; the
 * data-bearing blocks are HYDRATED server-side (a map's stops geocoded, an
 * image's query searched, a link's URL previewed) so the card never carries a
 * made-up URL or an ungeocoded pin. Each finished block streams to the canvas as
 * a `block.add` event. This is what makes rich constructs reliable — the model
 * declares structure, the server fills the data. */
/** The rich-card block grammar — reusable across every answer that composes a
 *  block card (the ask doc path, the deep-research dossier, the doc/list Thinking
 *  Machines). Append it to a persona to say "answer AS blocks"; the persona owns
 *  the method, this owns the format + construct-choice discipline. Keeping it one
 *  const means all three paths stay in lockstep (rich-card consolidation). */
const BLOCK_FORMAT = `Compose your answer as a rich card — a STREAM OF BLOCKS. Output ONE JSON object per line (newline-delimited JSON) and NOTHING else — no prose outside the objects, no markdown code fences, no commentary. Each line is one block. Emit them top to bottom in reading order; the card renders each as it arrives, so lead with what carries the most.

Block types (pick the RIGHT ones from the shape of the content — automatically, without being asked, and MIX them freely):
{"type":"heading","level":1,"text":"..."}            // level 1–3; an optional short title first
{"type":"paragraph","text":"..."}                    // prose; inline **bold**, *italic*, \`code\`, [label](url) allowed
{"type":"list","ordered":false,"items":["...","..."]} // bullets, or ordered:true for steps in order
{"type":"checklist","items":[{"text":"...","done":false}]} // tasks / action items / next steps
{"type":"table","columns":["A","B"],"rows":[["1","2"]]} // a comparison / matrix / grid — a full table, not a token sketch
{"type":"image","query":"Lake Bled","alt":"Lake Bled"} // a VISUAL subject; the server finds a real image from the query
{"type":"map","ordered":false,"stops":[{"name":"...","query":"place, locality, state, country","note":"one line"}]} // real visitable places; the server geocodes each stop. ordered:true only for an itinerary/route
{"type":"link","url":"https://…"}                    // a page worth surfacing; the server fetches its title/description/preview
{"type":"divider"}                                    // a hairline break

Rules:
- Choose constructs by content: a comparison → a table; steps/tasks → a checklist; places → a map; a visual subject → an image; points → a list; everything else → paragraphs.
- Use IMAGES generously for visual answers. If the user asks for photos/images, or the answer is a set of visual things — places, cafes, products, buildings, dishes, people, cars — emit an image block for EACH item (right after you name it), with a short concrete query (e.g. "Blue Tokai Coffee Indiranagar"). The server finds the real photo; you just supply the query. Only skip images for genuinely non-visual answers (analysis, code, abstract reasoning).
- Use a MAP block when the answer is real places to visit; give each stop a region-qualified query so the geocoder resolves it. 1–8 real stops, never invented.
- Ground every claim in the provided content or the web; if the sources don't contain the answer, say so in a paragraph rather than inventing. Calibrate depth to the ask — a decision/plan earns a full card, a narrow ask a short one.
- Output ONLY the JSON lines. No leading/trailing prose.`;

/** The ask doc/list persona: a bare lead-in that hands off to {@link BLOCK_FORMAT}. */
const BLOCK_DOC_SYSTEM = `You answer a question on a canvas by composing a rich card.\n\n${BLOCK_FORMAT}`;

/** The deep-research persona (the method), answering as a BLOCK card via
 *  {@link BLOCK_FORMAT}. This replaced the OpenUI dossier (RICH_RESEARCH_SYSTEM)
 *  so research shares the one rich-card grammar — the image block's server-side
 *  search now supplies the hero shot, so no find_image tool dance is needed. */
const RESEARCH_BLOCK_SYSTEM = `You are running a DEEP RESEARCH pass on something the user put on their canvas — any link or card: a venue or rental listing, a product, a company, a repo or tool, an article or paper, a person, an open question. Your job: autonomously find everything a decision-maker would want to know, far beyond what the subject says about itself.

First decide WHAT the subject is, then work the live web hard on the angles that matter for that kind of subject — for example:
- venue / listing / product → independent reviews across platforms, current prices and availability, recurring complaints, strong alternatives
- company / service → what it actually does, traction and reputation (news, customer and employee voices), competitors
- repo / tool / tech → maturity and activity, what users report in issues and discussions, how it compares to alternatives
- article / paper / claim → who wrote it and their credibility, corroborating AND contradicting sources, what has happened since
- person → who they are, notable work, recent activity, credibility signals
- open question / topic → the current state of things, the strongest sources, where informed people disagree
Fetch the given URL for ground truth when there is one; cross-check what the subject claims about itself against what outsiders say; hunt for red flags (recurring complaints, contradictions, hidden costs, stale/renamed/discontinued).

Shape the dossier as a scannable rich card, not an essay:
- Open with a level-1 heading (the subject) and a one-paragraph VERDICT — what this is and whether it holds up.
- Put an image block of the subject right after the verdict (a short concrete query — the server finds the real photo), and at most one more deeper down where it genuinely illustrates a section.
- Then the findings that fit THIS subject: paragraphs with **bold lead-ins** for the analysis (the backbone), a table where a grid genuinely clarifies (alternatives side by side, specs, prices), a checklist for concrete next steps or things to verify.
- Cite every externally sourced claim inline as ([label](url)); close with a short list of the pages you used. Never invent a URL, a number, or a fact — if an angle came up empty, say so in one honest line.

${BLOCK_FORMAT}`;

/** Cap runaway structures so one block can't blow up the card. */
function clampStr(s: unknown, n: number): string {
  return String(s ?? '').slice(0, n);
}

/** Validate + hydrate one model-emitted block object into a render-ready
 *  RichBlock (or null to drop it). Map/image/link reach out for real data. */
async function hydrateBlock(obj: unknown, signal: AbortSignal): Promise<RichBlock | null> {
  if (!obj || typeof obj !== 'object') return null;
  const b = obj as Record<string, unknown>;
  switch (b.type) {
    case 'heading': {
      const text = clampStr(b.text, 200).trim();
      const level = b.level === 1 || b.level === 2 || b.level === 3 ? b.level : 2;
      return text ? { type: 'heading', level, text } : null;
    }
    case 'paragraph': {
      const text = clampStr(b.text, 4000).trim();
      return text ? { type: 'paragraph', text } : null;
    }
    case 'list': {
      const items = Array.isArray(b.items) ? b.items.map((x) => clampStr(x, 500).trim()).filter(Boolean).slice(0, 40) : [];
      return items.length ? { type: 'list', ordered: b.ordered === true, items } : null;
    }
    case 'checklist': {
      const items = Array.isArray(b.items)
        ? b.items
            .map((x) => {
              const it = (x ?? {}) as Record<string, unknown>;
              return { text: clampStr(it.text, 500).trim(), done: it.done === true };
            })
            .filter((it) => it.text)
            .slice(0, 40)
        : [];
      return items.length ? { type: 'checklist', items } : null;
    }
    case 'table': {
      const columns = Array.isArray(b.columns) ? b.columns.map((c) => clampStr(c, 60)).slice(0, 6) : [];
      const rows = Array.isArray(b.rows)
        ? b.rows.map((r) => (Array.isArray(r) ? r.map((c) => clampStr(c, 300)).slice(0, 6) : [])).slice(0, 20)
        : [];
      return columns.length || rows.length ? { type: 'table', columns, rows } : null;
    }
    case 'divider':
      return { type: 'divider' };
    case 'image': {
      const query = clampStr(b.query, 120).trim();
      if (!query) return null;
      const found = await searchImages(query, 1).catch(() => []);
      if (signal.aborted || found.length === 0) return null; // no real image → drop it
      return { type: 'image', url: found[0]!.url, alt: clampStr(b.alt, 120).trim() || query };
    }
    case 'map': {
      const proposed: ProposedStop[] = Array.isArray(b.stops)
        ? b.stops
            .map((s) => {
              const st = (s ?? {}) as Record<string, unknown>;
              return {
                name: clampStr(st.name, 120).trim(),
                query: clampStr(st.query, 200).trim() || clampStr(st.name, 120).trim(),
                note: st.note ? clampStr(st.note, 200) : undefined,
                day: st.day ? clampStr(st.day, 40) : undefined,
                time: st.time ? clampStr(st.time, 40) : undefined,
              };
            })
            .filter((s) => s.name)
            .slice(0, 8)
        : [];
      if (proposed.length === 0) return null;
      const located = await locateStops(proposed, signal).catch(() => []);
      if (signal.aborted || located.length === 0) return null;
      return { type: 'map', ordered: b.ordered === true, stops: located };
    }
    case 'link': {
      const url = clampStr(b.url, 2000).trim();
      if (!/^https?:\/\//i.test(url)) return null;
      const preview = await buildLinkPreview(url).catch(() => null);
      if (signal.aborted) return null;
      return preview
        ? { type: 'link', url: preview.url, title: preview.title, description: preview.description, image: preview.image || undefined, siteName: preview.siteName || undefined }
        : { type: 'link', url };
    }
    default:
      return null;
  }
}

/** Stream a rich card as hydrated blocks. Parses the model's NDJSON line by line
 *  so each block streams the moment it closes; the data blocks pause only their
 *  own hydration, not the whole card. */
async function* streamBlocks(
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'doc' };
  yield { type: 'status', message: 'drafting the answer…' };
  let buffer = '';
  let emitted = 0;
  async function* take(rawLine: string): AsyncGenerator<AskEvent> {
    const line = rawLine.trim();
    if (!line || line.startsWith('\`\`\`')) return; // ignore blank lines / stray fences
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // a half-written or non-JSON line — skip it
    }
    const block = await hydrateBlock(obj, signal);
    if (signal.aborted) return;
    if (block) {
      emitted++;
      yield { type: 'block.add', block };
    }
  }
  let searching = false;
  for await (const ev of generateStream(system, user, signal, images, opts)) {
    if (signal.aborted) return;
    if (ev.type === 'status') {
      searching = true;
      yield { type: 'status', message: ev.message };
      continue;
    }
    if (searching) {
      searching = false;
      yield { type: 'status', message: 'drafting the answer…' };
    }
    buffer += ev.text;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      yield* take(line);
    }
  }
  yield* take(buffer); // the final line has no trailing newline
  // Never leave an empty card — if nothing parsed, fall back to a plain answer.
  if (emitted === 0) {
    yield { type: 'block.add', block: { type: 'paragraph', text: 'I couldn’t compose that — try rephrasing the question.' } };
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

export async function* streamAsk(req: AskRequest, signal: AbortSignal): AsyncGenerator<AskEvent> {
  if (!hasModelKey() && !sidecarAvailable()) {
    yield* streamDemoAsk(req, signal);
    return;
  }

  // Name what's being read — "reading 'Product sync — …'" beats a generic
  // verb, and the honest-status principle wants specific over vague (G3.1).
  const firstTitle = req.sources.find((s) => s.title?.trim())?.title?.trim();
  yield {
    type: 'status',
    message:
      req.sources.length === 0
        ? 'thinking it through…'
        : firstTitle
          ? `reading “${firstTitle.slice(0, 40)}${firstTitle.length > 40 ? '…' : ''}”…`
          : req.sources.length > 1
            ? `reading ${req.sources.length} sources…`
            : 'reading the source…',
  };
  const { context, images, framePaths, imageData } = await gatherContext(req);
  if (signal.aborted) return;

  // Ambient board awareness: with NO source attached, hand the model the TITLES
  // of the cards on the canvas so it can resolve what the prompt leans on — "his
  // films", "these", a bare pronoun — from what's visibly on the board, then
  // answer from its own knowledge. Titles only (capped) so it stays cheap; it's
  // not the cards' contents (owner call 2026-07-20).
  const boardHint =
    req.sources.length === 0 && req.boardIndex && req.boardIndex.length > 0
      ? `On the user's canvas right now (card titles only — their full content is NOT attached):\n${req.boardIndex
          .slice(0, 60)
          .map((t, i) => `${i + 1}. ${t}`)
          .join('\n')}\n\nThe request may refer to one of these — a pronoun ("his", "their", "it"), "these", or "all his …". Use the titles to work out what's meant and answer from your own knowledge when the reference is clear. Only ask the user to select a specific card if you genuinely need its contents.`
      : '';
  const askContext = [context, boardHint].filter(Boolean).join('\n\n');

  // Thinking Machine skill: the machine's own system prompt + research budget
  // replace the router entirely. `prompt` is the subject typed into the block.
  const machine = getMachine(req.machineId);
  if (machine) {
    yield* runMachineSkill(machine, req.prompt, signal, images, framePaths, imageData);
    return;
  }

  // Deep research is IMPLICIT: a research-sounding ask on any card upgrades
  // itself to the dossier pass — no mode, no button (owner call, 2026-07-05).
  // Only prose-bound asks upgrade; an explicit "/table" (or a prompt that
  // routes to a table/diagram) keeps its format on the normal web budget.
  const routedShape = req.shape ?? pickShape(req.prompt, req.currentShape);
  const deep =
    !req.noResearch &&
    (req.deep || (looksLikeResearch(req.prompt) && (routedShape === 'doc' || routedShape === 'list')));
  if (deep) {
    yield { type: 'status', message: 'researching across the web…' };
    const user = `Research request:\n${req.prompt}\n\n${askContext || '(No canvas sources — research the request itself.)'}`;
    // The dossier is a rich BLOCK card now (same construct grammar as every
    // other answer — prose + tables + checklists + images), not a bespoke
    // OpenUI dashboard. `deep:true` buys the many-search/read research budget;
    // the keyless demo mode already exited above, so every real pass answers
    // rich (rich-card consolidation, 2026-07-20).
    yield* streamBlocks(RESEARCH_BLOCK_SYSTEM, user, signal, images, {
      web: true,
      deep: true,
      framePaths,
      imageData,
    });
    return;
  }

  // Disambiguation: if the request is genuinely unclear, ask one short question
  // (with tappable options) instead of guessing. Skipped once the user answers.
  if (!req.skipClarify) {
    yield { type: 'status', message: 'making sure I understand…' };
    const clarify = await maybeClarify(req, signal);
    if (signal.aborted) return;
    if (clarify) {
      yield { type: 'clarify', question: clarify.question, options: clarify.options };
      yield { type: 'done' };
      return;
    }
  }

  // An explicit "/" mode pick beats the prompt-based router — the user chose
  // the format; don't second-guess it. (Routed once, above the deep gate.)
  const shape = routedShape;
  const user = `Question:\n${req.prompt}\n\n${askContext}`;

  if (shape === 'diagram') {
    yield* streamDiagram(user, signal, images);
    return;
  }

  if (shape === 'prototype') {
    yield* streamPrototype(user, signal, images);
    return;
  }

  if (shape === 'dashboard') {
    yield* streamDashboard(user, signal, images);
    return;
  }

  if (shape === 'map') {
    yield* streamMap(user, signal, images, { framePaths, imageData });
    return;
  }

  if (shape === 'table') {
    // Cross-document conflict requests get the clause-diff table treatment
    // (purely extractive across the given documents — no web there).
    const isDiff = looksLikeDiff(req.prompt) && req.sources.filter((s) => s.assetId).length >= 2;
    // Tables return JSON, so the used-sources declaration rides as one more
    // key instead of the trailing marker line the doc stream uses.
    const tableUsedDirective =
      req.sources.length > 0
        ? '\nAlso include a "usedSources": number[] key — the numbers of the numbered Sources whose content the table actually drew on (a source you ignored, and web results, do not count; [] if none).'
        : '';
    const tableSystem = (isDiff ? CLAUSE_DIFF_SYSTEM : TABLE_SYSTEM + WEB_TABLE_DIRECTIVE) + tableUsedDirective;
    // The table generates in one long blocking call — without a stage here
    // the whole build reads as silence until cells appear (G3.1).
    yield { type: 'status', message: 'building the table…' };
    const raw = await generate(tableSystem, user, signal, images, {
      web: !isDiff,
      framePaths,
      imageData,
      // Rows of visual things earn a thumbnail column — find_image gives the
      // model real image URLs to fill it with (clause-diff stays text-only).
      clientTools: isDiff ? undefined : FIND_IMAGE_CLIENT,
    });
    if (signal.aborted) return;
    let columns: string[] = [];
    let rows: string[][] = [];
    let usedSources: number[] | null = null;
    // A cell holding an image/link token needs URL headroom — the plain-text
    // cap would slice the URL mid-way and leave broken literal markdown.
    const cellCap = (s: string) => s.slice(0, /!\[|\]\(/.test(s) ? 500 : 200);
    try {
      const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
        columns?: unknown;
        rows?: unknown;
        usedSources?: unknown;
      };
      columns = Array.isArray(json.columns) ? json.columns.map((c) => String(c).slice(0, 60)) : [];
      rows = Array.isArray(json.rows)
        ? json.rows.map((r) => (Array.isArray(r) ? r.map((c) => cellCap(String(c ?? ''))) : []))
        : [];
      if (Array.isArray(json.usedSources)) {
        usedSources = [...new Set(json.usedSources.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= req.sources.length))].sort((a, b) => a - b);
      }
    } catch {
      /* fall through to a doc if the model didn't return clean JSON */
    }
    // A useful comparison is compact — cap runaway tables so a card can't grow
    // to thousands of pixels and wreck the canvas.
    columns = columns.slice(0, 6);
    rows = rows.slice(0, 14).map((r) => r.slice(0, 6));
    // Cache any web image the model cited into our asset store so the browser
    // loads it same-origin (no hotlink/CORS breakage).
    rows = await cacheImagesInRows(rows, signal);
    if (columns.length > 0) {
      // Build live: header first, then fill cells one by one so the user sees
      // the table forming in real time.
      yield { type: 'card.create', shape: 'table', columns, rowCount: rows.length };
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < columns.length; c++) {
          if (signal.aborted) return;
          yield { type: 'table.cell', r, c, text: rows[r]?.[c] ?? '' };
          await sleep(28, signal);
        }
      }
      if (usedSources) yield { type: 'sources.used', indices: usedSources };
      yield { type: 'card.done' };
      yield { type: 'done' };
      return;
    }
    // Not clean JSON — degrade to a written answer.
    yield* streamDoc('doc', DOC_SYSTEM + WEB_DIRECTIVE, user, signal, images, { web: true, framePaths, imageData, clientTools: FIND_IMAGE_CLIENT });
    return;
  }

  // The doc/list answer is a STRUCTURED RICH CARD now: the model emits hydrated
  // blocks (tables/maps/images/checklists), not markdown (rich-card rebuild,
  // 2026-07-20). BLOCK_DOC_SYSTEM carries its own construct guidance, so the
  // markdown map/widget/find_image directives don't apply here; web tools stay
  // on for grounding, and paragraphs may cite inline as [label](url) / [p.N].
  const blockSystem =
    BLOCK_DOC_SYSTEM +
    '\n\nYou can web_search for current or externally verifiable facts (names, dates, prices, credits, places) — do that FIRST, then emit the blocks; cite a web claim inline as ([label](url)). For a page-sourced answer, cite the page as [p.N] where N is its number.';
  yield* streamBlocks(blockSystem, user, signal, images, { web: true, framePaths, imageData });
}

/**
 * Run a Thinking Machine skill: the machine's own system prompt drives a doc /
 * list / table generation on the (optionally deep) web-research budget. The
 * `subject` is what the user typed into the block. This is what makes a machine
 * more than an ask — a curated skill + live research, server-side.
 */
async function* runMachineSkill(
  machine: MachineSkill,
  subject: string,
  signal: AbortSignal,
  images: ImageInput[],
  framePaths?: string[],
  imageData?: ImageInput[],
): AsyncGenerator<AskEvent> {
  yield { type: 'status', message: machine.deep ? 'researching across the web…' : 'thinking…' };
  const user = subject.trim() || '(no subject provided)';
  const opts: GenOpts = { web: true, deep: machine.deep, framePaths, imageData };

  if (machine.output === 'table') {
    const raw = await generate(machine.systemPrompt, user, signal, images, opts);
    if (signal.aborted) return;
    let columns: string[] = [];
    let rows: string[][] = [];
    try {
      const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
        columns?: unknown;
        rows?: unknown;
      };
      columns = Array.isArray(json.columns) ? json.columns.map((c) => String(c).slice(0, 60)) : [];
      rows = Array.isArray(json.rows)
        ? json.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').slice(0, 240)) : []))
        : [];
    } catch {
      /* fall through to a doc if the model didn't return clean JSON */
    }
    columns = columns.slice(0, 7);
    rows = rows.slice(0, 12).map((r) => r.slice(0, 7));
    rows = await cacheImagesInRows(rows, signal);
    if (columns.length > 0) {
      yield { type: 'card.create', shape: 'table', columns, rowCount: rows.length };
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < columns.length; c++) {
          if (signal.aborted) return;
          yield { type: 'table.cell', r, c, text: rows[r]?.[c] ?? '' };
          await sleep(24, signal);
        }
      }
      yield { type: 'card.done' };
      yield { type: 'done' };
      return;
    }
    // Not clean JSON — degrade to a rich block card rather than an empty table.
    yield* streamBlocks(machine.systemPrompt + '\n\n' + BLOCK_FORMAT, user, signal, images, opts);
    return;
  }

  // The doc/list machines (persona, 5-whys) compose a rich BLOCK card now, not a
  // markdown doc — their prompts describe the method + structure, BLOCK_FORMAT
  // owns the output shape (rich-card consolidation, 2026-07-20).
  yield* streamBlocks(machine.systemPrompt + '\n\n' + BLOCK_FORMAT, user, signal, images, opts);
}

const MAP_MAX_STOPS = 10;

/**
 * Stream a map: the model proposes real stops as JSON, the server verifies
 * each location against a real geocoder (cached, throttled — geo.ts), then the
 * pins land one by one. A stop whose location can't be verified either falls
 * back to the model's own coordinates flagged `approx` (the card renders the
 * doubt) or is dropped — never a silently wrong pin. See docs/MAPS.md.
 */
async function* streamMap(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): AsyncGenerator<AskEvent> {
  yield { type: 'status', message: 'planning the stops…' };
  const raw = await generate(MAP_SYSTEM, user, signal, images, { ...opts, web: true });
  if (signal.aborted) return;

  let title = '';
  let intro = '';
  let ordered = true;
  let proposed: ProposedStop[] = [];
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()) as {
      title?: unknown;
      intro?: unknown;
      ordered?: unknown;
      stops?: unknown;
    };
    title = typeof json.title === 'string' ? json.title.slice(0, 90) : '';
    intro = typeof json.intro === 'string' ? json.intro.slice(0, 200) : '';
    ordered = json.ordered !== false;
    proposed = Array.isArray(json.stops)
      ? json.stops
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
          .map((s) => ({
            name: String(s.name ?? '').slice(0, 80),
            query: String(s.query ?? s.name ?? '').slice(0, 160),
            day: typeof s.day === 'string' ? s.day.slice(0, 30) : undefined,
            time: typeof s.time === 'string' ? s.time.slice(0, 20) : undefined,
            note: typeof s.note === 'string' ? s.note.slice(0, 200) : undefined,
            lat: typeof s.lat === 'number' ? s.lat : undefined,
            lng: typeof s.lng === 'number' ? s.lng : undefined,
          }))
          .filter((s) => s.name.trim() && s.query.trim())
          .slice(0, MAP_MAX_STOPS)
      : [];
  } catch {
    /* fall through — no clean JSON means no map; degrade to a written answer */
  }
  if (proposed.length === 0) {
    yield* streamDoc('doc', DOC_SYSTEM + WEB_DIRECTIVE, user, signal, images, { ...opts, web: true });
    return;
  }

  yield { type: 'card.create', shape: 'map', title: title || undefined, intro: intro || undefined, ordered };
  yield { type: 'status', message: 'finding the places…' };

  // Verify every stop first (cache makes repeats instant; the policy throttle
  // spaces real lookups), THEN drop the pins in visiting order — the emission
  // is the animation, so the geocoding wait never shows as a half-built map.
  // locateStops (geo.ts) is the shared verifier the inline doc block uses too.
  const located = await locateStops(proposed, signal);
  if (located.length === 0) {
    yield { type: 'card.done' };
    yield { type: 'error', message: 'Couldn’t verify any of the places — try naming them more specifically.' };
    return;
  }

  for (let i = 0; i < located.length; i++) {
    if (signal.aborted) return;
    const { lat, lng, approx, name, query, day, time, note } = located[i]!;
    yield {
      type: 'map.pin',
      index: i,
      stop: { name, query, lat, lng, approx: approx || undefined, day, time, note },
    };
    await sleep(340, signal);
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Stream a Mermaid diagram. The model writes the Mermaid source token by token
 * (the card shows it forming, then renders it to SVG on `card.done`). The server
 * doesn't parse the Mermaid — the diagram card validates/renders it, falling
 * back to the raw source if it doesn't parse.
 */
async function* streamDiagram(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'diagram' };
  try {
    for await (const ev of generateStream(DIAGRAM_SYSTEM, user, signal, images)) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    // Close the opened card before the error reaches index.ts's catch (which
    // emits `error` but knows nothing about cards) — mirrors runtime.ts's
    // closeOpenCard, so the client never keeps a streaming card open forever.
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Stream a UI prototype. The model writes ONE self-contained HTML document token
 * by token (the card shows the markup forming, then renders it in a sandboxed
 * iframe on `card.done`). The server doesn't parse the HTML — the card renders
 * it as-is in an opaque-origin sandbox.
 */
async function* streamPrototype(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'prototype' };
  try {
    for await (const ev of generateStream(PROTOTYPE_SYSTEM, user, signal, images, { prototype: true })) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    // Close the opened card before the error propagates (mirrors streamDiagram)
    // so the client never keeps a streaming card open forever.
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Stream an interactive dashboard. The model writes an OpenUI Lang spec (a small
 * declarative layout over our fixed component library) token by token; the card
 * accumulates it into `spec` and its offline renderer reveals the KPIs, charts
 * and table as they resolve. Same shape as streamPrototype — the server doesn't
 * parse the spec, the card renders it — but a much smaller budget than an HTML
 * document (a spec is compact), so it reuses the prototype headroom safely.
 */
async function* streamDashboard(
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape: 'dashboard' };
  try {
    for await (const ev of generateStream(DASHBOARD_SYSTEM, user, signal, images, { prototype: true })) {
      if (signal.aborted) return;
      if (ev.type === 'status') yield { type: 'status', message: ev.message };
      else yield { type: 'card.delta', textDelta: ev.text };
    }
  } catch (error) {
    yield { type: 'card.done' };
    throw error;
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}

/**
 * Create the doc card up front (the shape is known from the prompt), then
 * generate and stream the body in — so the card appears immediately and fills
 * live rather than popping in complete after a blank wait.
 */
async function* streamDoc(
  shape: AskShape,
  system: string,
  user: string,
  signal: AbortSignal,
  images: ImageInput[] = [],
  opts: GenOpts = {},
): AsyncGenerator<AskEvent> {
  yield { type: 'card.create', shape };
  // Buffer only until the first line resolves (a "# Title" goes to the card's
  // title); everything after streams straight into the body as it arrives.
  // `bodyStarted` swallows the blank line(s) between a stripped title and the
  // body — otherwise the doc card renders an empty band above its content.
  let buf = '';
  let titleResolved = false;
  let bodyStarted = false;
  function* bodyDelta(raw: string): Generator<AskEvent> {
    const t = bodyStarted ? raw : raw.replace(/^\n+/, '');
    if (!t) return;
    bodyStarted = true;
    yield { type: 'card.delta', textDelta: t };
  }
  let searching = false;
  try {
    for await (const ev of generateStream(system, user, signal, images, opts)) {
      if (signal.aborted) return;
      if (ev.type === 'status') {
        searching = true;
        yield { type: 'status', message: ev.message };
        continue;
      }
      if (searching) {
        // Text resumed after a web hop — flip the avatar back to writing.
        searching = false;
        yield { type: 'status', message: 'writing…' };
      }
      const delta = ev.text;
      if (titleResolved) {
        yield* bodyDelta(delta);
        continue;
      }
      buf += delta;
      const nl = buf.indexOf('\n');
      if (nl === -1) continue;
      titleResolved = true;
      const firstLine = buf.slice(0, nl);
      const rest = buf.slice(nl + 1);
      if (firstLine.startsWith('# ')) {
        yield { type: 'card.title', title: firstLine.replace(/^#\s+/, '').slice(0, 80) };
        yield* bodyDelta(rest);
      } else {
        yield* bodyDelta(buf);
      }
      buf = '';
    }
  } catch (error) {
    // Close the opened card before the error reaches index.ts's catch (which
    // emits `error` but knows nothing about cards) — mirrors runtime.ts's
    // closeOpenCard, so the client never keeps a streaming card open forever.
    yield { type: 'card.done' };
    throw error;
  }
  if (!titleResolved && buf) {
    if (buf.startsWith('# ')) yield { type: 'card.title', title: buf.replace(/^#\s+/, '').slice(0, 80) };
    else yield* bodyDelta(buf);
  }
  yield { type: 'card.done' };
  yield { type: 'done' };
}
