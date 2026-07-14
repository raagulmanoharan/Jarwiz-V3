/**
 * Export — turn the whole board into a shareable artifact you can carry out of
 * Jarwiz. Two flavours over one SSE endpoint (POST /api/export):
 *
 *  - 'slideshow' — a slick, self-contained HTML slide deck in Jarwiz's brand
 *    language. The board is read as grounding and SYNTHESISED into a narrative
 *    (title → agenda → argument → next steps), enriched with tables, flow
 *    diagrams, and inline-SVG charts, and lightly researched on the live web
 *    when a current fact genuinely adds context. One .html file, no external
 *    dependencies — it opens anywhere and prints to PDF.
 *  - 'markdown'  — a comprehensive, LLM-ready capture of the session: every
 *    card organised into a clean brief another model can pick up and run with.
 *    A faithful capture, so it takes no web pass and never invents facts.
 *
 * Model path first (BYOK/env key, else the CLI sidecar); a deterministic build
 * is the floor when no model is reachable, so the button always produces
 * something real and the feature is demoable with no key — mirroring the
 * mock parity every other agent keeps.
 *
 * Shape on the wire: staged `status` events keep the long generation honest and
 * the connection warm, then the artifact streams as `delta` chunks (so the
 * client's preview builds in), then a `done` naming the format.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AnalyzeCard, ExportEvent, ExportRequest } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { anthropic, hasModelKey } from './model.js';
import { WEB_MAX_CONTINUATIONS, webToolset } from './webTools.js';

const MAX_BOARD_CARDS = 40;
const MAX_TEXT_PER_CARD = 1400;
const SLIDESHOW_MAX_TOKENS = 8000;
const MARKDOWN_MAX_TOKENS = 4000;
// A deck is a heavy, deliberate one-shot — the model reads the whole board,
// (optionally) researches, then writes a full styled document. Give it real
// headroom; the API path streams well inside this, and the slower CLI sidecar
// needs the room. If it's ever exceeded, the run degrades to the (good)
// deterministic deck rather than failing.
const GEN_TIMEOUT_MS = 210_000;

/* ─── Board → prompt material ─────────────────────────────────────────────── */

/** A generous, readable digest of the board — the grounding both modes build
 *  on. Fuller than the compose scan (this IS the whole payload, not one card
 *  among a fan-out), but still capped so a huge board can't blow the budget. */
function boardDigest(cards: AnalyzeCard[]): string {
  return cards
    .slice(0, MAX_BOARD_CARDS)
    .map((c, i) => {
      const label = c.title ? `${c.kind} — ${c.title}` : c.kind;
      const body = (c.text || '').trim().slice(0, MAX_TEXT_PER_CARD);
      return `### Item ${i + 1} · ${label}\n${body || '(no text)'}`;
    })
    .join('\n\n');
}

function userTurn(req: ExportRequest): string {
  const title = req.title?.trim() || 'Untitled board';
  const digest = boardDigest(req.board);
  return [
    `Board title: ${title}`,
    `Items on the board: ${req.board.length}`,
    '',
    'THE BOARD:',
    digest || '(the board is empty)',
  ].join('\n');
}

/* ─── System prompts ──────────────────────────────────────────────────────── */

const DESIGN_PHILOSOPHY = `DESIGN DIRECTION — Jarwiz is warm-monochrome and editorial. Design like a top studio; this is what separates a designed deck from a generic one:
- ONE idea per slide. The best slides say a single thing with conviction and a lot of air. Keep body copy under ~25 words; if a slide wants more, split it or cut it. Whitespace is the design — never fill the page.
- Spend ALL boldness on SCALE and negative space and ONE solid-ink moment per slide — never on colour. The palette is a chosen warm-paper neutral; no gradients, no coloured accent, no emoji, no drop shadows.
- The type signature is a HEAVY grotesque display against MONO uppercase utility labels (kickers, captions, data). That contrast IS the personality — lean on it, not a novelty face. Trust the shell's type scale and hierarchy; your job is choosing the RIGHT blocks and showing restraint, not resizing.
- Composition is LEFT-anchored and asymmetric. Do NOT centre everything (centred-everything is the templated AI look); reserve centring for at most the cover or one closing statement. VARY the layout slide to slide — a deck where every slide is kicker+headline+bullets is a failure.
- Show evidence, don't just tell it: a comparison → a table; numbers over time or across items → a chart or a big stat; a sequence → steps; a claim + support → a two-column split.
- AVOID the generic-AI-deck tells: every slide centred; Inter for everything; decorative 01/02/03 eyebrows where nothing is a sequence; cream-and-terracotta or a lone neon pop; rounded cards with a coloured left rail; emoji bullets; gradient heroes.`;

/**
 * The slideshow prompt. Crucially the model authors ONLY slide CONTENT — the
 * server wraps it in a tested shell (deckShell) that owns the palette, type,
 * navigation, motion, theming, and chrome. Letting the model author the whole
 * interactive document was too fragile (broken nav / blank slides varied run to
 * run); confining it to composing slides from vetted building blocks makes
 * every deck work while keeping the design genuinely bespoke per subject.
 * The LIVE WEB paragraph is included only when web tools were actually granted.
 */
function slideshowSystem(web: boolean): string {
  const webPara = web
    ? `

LIVE WEB (optional, sparingly): you may web_search / web_fetch to enrich a slide with a current, relevant fact or figure the board gestures at — only when it clearly strengthens the story, a couple of lookups at most, always grounded in the board. Research first, then write the slides once. You may embed ONE real https <img> you actually found; never invent an image URL.`
    : '';
  return `You are Jarwiz's presentation designer — a design lead who ships decks that look like a top studio made them. You turn a collaborator's infinite-canvas board into a slick presentation that makes them look brilliant in the room.

Read the WHOLE board as grounding, then SYNTHESISE — don't transcribe. Find the through-line and build a narrative: a strong cover, the argument told in the right order, the evidence SHOWN (tables, charts, big stats), then a clear "where next". Distill messy notes into crisp points; write real copy in the user's voice — specific, active, never filler.

${DESIGN_PHILOSOPHY}

THE DELIVERABLE IS A PDF — each slide is ONE printed 16:9 page, downloaded and shared as a document. There is NO on-screen navigation, no clicking or advancing — so never reference "click", "next", page numbers, or a counter. Design each slide as a self-contained page that reads on its own.

HOW OUTPUT WORKS — you write ONLY the slides; a Jarwiz deck shell wraps them and already provides the palette (CSS variables --ground/--panel/--ink/--muted/--hair/--solid), the type system, the 16:9 page, and a small "Made with Jarwiz" mark on every page. DO NOT write <!DOCTYPE>, <html>, <head>, <style>, or <script>; DO NOT add your own footer, page number, logo, or nav — the shell owns all chrome. Just emit a run of slide sections.

Each slide:
  <section class="slide"><div class="grid"> …building blocks… </div></section>
Modifiers: <section class="slide slide--cover"> (hero — content sinks to the lower-left) · <section class="slide slide--section"> (a divider on the panel ground).

BUILDING BLOCKS (compose these — all pre-themed; never hard-code a colour):
- <p class="kicker">SECTION LABEL</p> — mono uppercase eyebrow.
- <h1 class="display">…</h1> cover headline · <h2 class="display">…</h2> slide headline.
- <div class="rule"></div> — a short solid rule.
- <p class="lede">…</p> — a large muted intro line.
- <div class="body"><p>…</p></div> — body copy (already measure-capped).
- Two columns: <div class="split"><div class="col">thesis…</div><div class="col">evidence…</div></div>.
- Numbered list: <ol class="steps"><li>…</li>…</ol> — auto mono indices + hairline dividers.
- Stat row: <div class="stats"><div class="stat"><b>60%</b><span>never return</span></div>…</div> (2–4).
- Comparison: <table class="cmp"><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td></tr></tbody></table>; add class="hot" to the cell(s) to emphasise a row/column in --solid.
- Chart: <figure class="chart"> INLINE SVG </figure><figcaption class="caption">the TAKEAWAY, not "chart"</figcaption>. Draw with the tokens — stroke/fill var(--ink) for the key mark, var(--muted) for secondary, var(--hair) for gridlines; ONE axis, one hue by magnitude, emphasised endpoint, direct mono labels, NO legend, NO chart library. Compute geometry yourself.
- Quote: <blockquote class="quote">…</blockquote><p class="cite">— source</p>.
You MAY add inline style="…" for bespoke composition, referencing the same var(--…) tokens.

PLAN THE ARC FIRST (think before you compose, don't print your plan): decide the deck's spine — cover → the tension/problem → the evidence → the turn → where next — then for EACH slide fix its single job and pick the ONE layout that serves it (statement, split, stat, steps, table, chart, quote). Deliberately alternate those layouts so no two adjacent slides look alike.

OUTPUT CONTRACT — return ONLY the sequence of <section class="slide">…</section> blocks. No <html>/<head>/<style>/<script>, no wrapper, no prose, no code fences. First slide is the cover; last is a "Next steps"/"Takeaways" closing. 6–10 slides, each earning its place and carrying ONE idea; genuinely VARY the archetypes (a deck of identical slides is the failure). Ruthless concision — a few tight lines or one strong statement per slide, never a wall of text.${webPara}

Be honest: never fabricate specific numbers, quotes, or sources; every chart/stat value comes from the board${web ? ' or from something you actually looked up' : ''}. Design like it's going in your portfolio.`;
}

const MARKDOWN_SYSTEM = `You are Jarwiz's session archivist. Produce ONE comprehensive Markdown document that captures this working session so a DIFFERENT AI assistant can pick it up cold and continue the work with full context. This is a faithful handoff, not a highlight reel.

Read the whole board and organise it — don't just dump cards in order. Group related material, keep every substantive detail, and preserve structure: tables stay Markdown tables, lists stay lists, any diagram/code stays in a fenced block with its language.

Structure the document as:
1. "# <board title>" — a single H1.
2. "## Session overview" — 2–4 sentences: what this board is about and what the person is trying to do (infer it honestly from the content).
3. "## Objective" — the goal in one or two lines, if discernible; otherwise omit this section rather than guess.
4. The body — "## " sections that organise the actual material by theme, capturing everything on the board comprehensively and accurately. Attribute nothing you can't see.
5. "## Current state" — where the thinking stands: what's decided, what's drafted, what's still rough.
6. "## Open threads & next steps" — the unresolved questions and the natural next moves.
7. End with a short "---" then one italic line: "*This document is a Jarwiz session export — hand it to any assistant to continue the work.*"

OUTPUT CONTRACT — return ONLY the Markdown. No preamble like "Here is the document", no code fences wrapping the whole thing. Never invent facts, names, numbers, or sources; if something is unknown, leave it out. No live web — capture only what's on the board.`;

/* ─── Model call (create + web continuation loop) ─────────────────────────── */

/** One full generation via the API. Slideshow gets the live-web toolset and the
 *  pause_turn continuation loop (a research turn can pause); markdown runs a
 *  single, tool-free turn. Returns the concatenated text. */
async function generateViaApi(req: ExportRequest, signal: AbortSignal): Promise<string> {
  const client = anthropic();
  const isSlideshow = req.mode === 'slideshow';
  const system = isSlideshow ? slideshowSystem(true) : MARKDOWN_SYSTEM;
  const maxTokens = isSlideshow ? SLIDESHOW_MAX_TOKENS : MARKDOWN_MAX_TOKENS;
  const tools = isSlideshow ? webToolset() : undefined;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userTurn(req) }];

  let text = '';
  const maxTurns = isSlideshow ? WEB_MAX_CONTINUATIONS : 0;
  for (let turn = 0; turn <= maxTurns; turn++) {
    const message = await client.messages.create(
      {
        model: AGENT_MODEL,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(tools ? { tools } : {}),
      },
      { signal },
    );
    text += message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    // A server-tool round pauses the turn; resume by replaying the assistant
    // content (webTools.ts). Any other stop_reason means the model is finished.
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }
  return text;
}

/** The keyless path: the same generation through the Claude CLI sidecar. Web
 *  research stays OFF here — routing live search through the CLI turns a deck
 *  into a multi-minute wait; the demo/dev path trades enrichment for speed, and
 *  the real (API) path above keeps the research budget. */
async function generateViaSidecar(req: ExportRequest, signal: AbortSignal): Promise<string> {
  const isSlideshow = req.mode === 'slideshow';
  return sidecarGenerate({
    system: isSlideshow ? slideshowSystem(false) : MARKDOWN_SYSTEM,
    user: userTurn(req),
    timeoutMs: GEN_TIMEOUT_MS,
    signal,
  });
}

/* ─── Cleanup & assembly ──────────────────────────────────────────────────── */

/** Strip a stray ```markdown / ``` fence a model sometimes wraps the whole doc
 *  in. (Markdown only — the slideshow is assembled by assembleDeck.) */
function cleanMarkdown(raw: string): string {
  const s = raw.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(s);
  return (fence ? fence[1]!.trim() : s).trim();
}

/**
 * Assemble a deck from the model's output. The model authors only slide
 * sections; we extract every top-level `<section class="slide …">…</section>`
 * and drop it into the tested shell (nav/motion/theme/chrome all ours). Any
 * stray prose, fences, or a wrapper the model added around the sections is
 * discarded — only real slides survive. Returns '' when nothing parseable came
 * back, so the caller falls to the deterministic deck rather than shipping junk.
 */
function assembleDeck(raw: string, title: string): string {
  const sections = raw.match(/<section\b[^>]*\bclass=["'][^"']*\bslide\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi);
  if (!sections || sections.length === 0) return '';
  return deckShell(title, sections.join('\n'));
}

/* ─── Deterministic fallback (no model) ───────────────────────────────────── */

/* ─── Deterministic fallback (no model) ───────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A faithful, presentable deck built with no model — a cover, one content
 *  slide per board item, and a closing, composed on the same warm-monochrome
 *  editorial system the live path targets. Never the star, but genuinely
 *  designed: left-anchored grid, mono utility labels, staggered enter. */
function fallbackSlideshow(req: ExportRequest): string {
  const title = req.title?.trim() || 'Untitled board';
  const items = req.board.slice(0, MAX_BOARD_CARDS);
  const count = `${items.length} item${items.length === 1 ? '' : 's'}`;
  const slidesHtml: string[] = [];

  // Cover — kicker, oversized headline lower-left, rule, lede.
  slidesHtml.push(
    `<section class="slide slide--cover"><div class="grid">
      <p class="kicker">Jarwiz deck</p>
      <h1 class="display">${escapeHtml(title)}</h1>
      <div class="rule"></div>
      <p class="lede">A working board, told as a presentation — ${count} synthesised into a narrative.</p>
    </div></section>`,
  );

  // One content slide per item — eyebrow (kind), heading, body measure-capped.
  items.forEach((c, idx) => {
    const heading = escapeHtml(c.title?.trim() || `${c.kind} ${idx + 1}`);
    const kind = escapeHtml(c.kind);
    const body = (c.text || '').trim();
    const paras = body
      ? body
          .split(/\n{2,}/)
          .slice(0, 6)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
          .join('')
      : '<p class="muted">No text on this card.</p>';
    slidesHtml.push(
      `<section class="slide"><div class="grid">
        <p class="kicker">${kind}</p>
        <h2 class="display">${heading}</h2>
        <div class="body">${paras}</div>
      </div></section>`,
    );
  });

  // Closing — a confident sign-off on the panel ground.
  slidesHtml.push(
    `<section class="slide slide--panel slide--cover"><div class="grid">
      <p class="kicker">Where next</p>
      <h2 class="display">Take it further.</h2>
      <p class="lede">Every card here can be pushed, compared, or built out — back on the Jarwiz canvas.</p>
    </div></section>`,
  );

  return deckShell(title, slidesHtml.join('\n'));
}

/**
 * The deck shell — the ONE self-contained document both the model path and the
 * fallback ship inside. The slideshow is a DOWNLOADABLE PDF, so this is a clean
 * PAGED document, not an interactive player: each slide is a fixed 16:9 page,
 * stacked (scrollable on screen, one-per-page in print), with no navigation
 * chrome. It owns the warm-paper palette, the mono-utility ↔ heavy-display type
 * system, every building-block class the prompt documents, and the single
 * "Made with Jarwiz" mark on each page.
 *
 * WYSIWYG sizing: slides are size containers and all type is in container-query
 * units (cqh/cqw), so a slide reads identically scaled-down in the modal preview
 * and at full 1280×720 in the printed PDF. Print rules force one slide per page,
 * exact background colours, and no on-screen shadows/gaps.
 */
function deckShell(title: string, slides: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Jarwiz</title>
<style>
  :root {
    --ground:#faf9f7; --panel:#f1efea; --ink:#17150f; --muted:#6b675d;
    --hair:rgba(23,21,15,.12); --solid:#17150f;
    --sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    --mono:ui-monospace,'SFMono-Regular',Menlo,monospace;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#e7e5df; font-family:var(--sans); color:var(--ink); -webkit-font-smoothing:antialiased; }
  .deck { display:flex; flex-direction:column; align-items:center; gap:26px; padding:26px; }
  /* A slide is a fixed 16:9 page and a size container, so its type scales as one. */
  .slide {
    container-type:size;
    position:relative;
    width:min(100%,1280px); aspect-ratio:16/9;
    background:var(--ground); color:var(--ink);
    overflow:hidden;
    border:1px solid var(--hair); border-radius:8px;
    box-shadow:0 10px 34px rgba(23,21,15,.10);
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
    display:flex; flex-direction:column; justify-content:center;
    padding:13cqh 9.5cqw 13cqh;
  }
  .slide--cover { justify-content:flex-end; padding-bottom:15cqh; }
  .slide--panel, .slide--section { background:var(--panel); }
  .grid { width:100%; }
  /* Vertical rhythm: layout does the spacing, so any stack of blocks the model
     composes gets consistent, generous separation. The eyebrow hugs its heading. */
  .grid > * + * { margin-top:3cqh; }
  .col > * + * { margin-top:2.6cqh; }
  .kicker + * { margin-top:1.8cqh; }
  /* The one persistent mark — clean, minimal, brand. */
  .slide::after {
    content:"Made with Jarwiz";
    position:absolute; right:9.5cqw; bottom:5.5cqh;
    font-family:var(--mono); text-transform:uppercase; letter-spacing:.2em;
    font-size:1.25cqh; color:var(--muted); opacity:.9;
  }
  /* Type & utility — a confident editorial scale, tight tracking on display. */
  .kicker { font-family:var(--mono); text-transform:uppercase; letter-spacing:.22em; font-size:1.65cqh; color:var(--muted); }
  .display { font-weight:820; letter-spacing:-.03em; line-height:1.0; text-wrap:balance; color:var(--ink); }
  h1.display { font-size:13cqh; }
  h2.display { font-size:6.6cqh; }
  .rule { width:8cqw; height:2px; background:var(--solid); }
  .lede { font-size:3.1cqh; line-height:1.42; color:var(--muted); max-width:40ch; }
  .body { font-size:2.5cqh; line-height:1.55; color:var(--ink); max-width:52ch; }
  .body p { margin-bottom:2cqh; } .body p:last-child { margin-bottom:0; }
  .muted { color:var(--muted); }
  /* Two-column — generous gutter, top-aligned columns. */
  .split { display:grid; grid-template-columns:1fr 1fr; gap:7cqw; align-items:start; }
  /* Numbered steps — auto mono index + hairline dividers */
  .steps { list-style:none; counter-reset:s; max-width:60ch; }
  .steps li { counter-increment:s; position:relative; padding:2.8cqh 0 2.8cqh 6.5ch; border-top:1px solid var(--hair); font-size:2.5cqh; line-height:1.4; }
  .steps li:last-child { border-bottom:1px solid var(--hair); }
  .steps li::before { content:counter(s,decimal-leading-zero); position:absolute; left:0; top:2.8cqh; font-family:var(--mono); font-size:1.65cqh; letter-spacing:.12em; color:var(--muted); }
  /* Stat row — big figures, mono labels, hairline dividers. */
  .stats { display:flex; flex-wrap:wrap; row-gap:5cqh; }
  .stat { padding:0 3.4cqw; } .stat:first-child { padding-left:0; } .stat + .stat { border-left:1px solid var(--hair); }
  .stat b { display:block; font-weight:820; letter-spacing:-.035em; font-size:12cqh; font-variant-numeric:tabular-nums; line-height:.95; }
  .stat span { display:block; margin-top:2cqh; font-family:var(--mono); text-transform:uppercase; letter-spacing:.16em; font-size:1.55cqh; color:var(--muted); max-width:22ch; }
  /* Comparison table — roomy rows, mono head, hairline rules only. */
  .cmp { border-collapse:collapse; width:100%; font-size:2.45cqh; }
  .cmp th { text-align:left; font-family:var(--mono); text-transform:uppercase; letter-spacing:.14em; font-size:1.5cqh; font-weight:500; color:var(--muted); padding:0 2.6ch 2.6cqh 0; border-bottom:1px solid var(--hair); }
  .cmp td { text-align:left; padding:2.6cqh 2.6ch; border-bottom:1px solid var(--hair); font-variant-numeric:tabular-nums; color:var(--ink); }
  .cmp td:first-child, .cmp th:first-child { padding-left:0; }
  .cmp .hot { font-weight:750; }
  /* Chart */
  .chart { width:100%; } .chart svg { width:100%; max-width:100%; height:auto; overflow:visible; }
  .caption { font-family:var(--mono); text-transform:uppercase; letter-spacing:.14em; font-size:1.55cqh; color:var(--muted); }
  /* Quote */
  .quote { font-size:5.4cqh; font-weight:760; letter-spacing:-.025em; line-height:1.14; text-wrap:balance; max-width:19ch; }
  .cite { font-family:var(--mono); text-transform:uppercase; letter-spacing:.16em; font-size:1.65cqh; color:var(--muted); }
  /* Print: one slide per page, exact colours, no screen shadows/gaps. */
  @media print {
    @page { size:1280px 720px; margin:0; }
    body { background:#fff; }
    .deck { gap:0; padding:0; }
    .slide { width:1280px; height:720px; aspect-ratio:auto; border:none; border-radius:0; box-shadow:none; break-after:page; page-break-after:always; }
    .slide:last-child { break-after:auto; page-break-after:auto; }
  }
</style>
</head>
<body>
  <div class="deck">
${slides}
  </div>
</body>
</html>`;
}

/** A faithful Markdown capture built with no model — organised by board item,
 *  everything preserved, framed as an LLM handoff. */
function fallbackMarkdown(req: ExportRequest): string {
  const title = req.title?.trim() || 'Untitled board';
  const items = req.board.slice(0, MAX_BOARD_CARDS);
  const lines: string[] = [];
  lines.push(`# ${title}`, '');
  lines.push('## Session overview', '');
  lines.push(
    `This document is a faithful capture of a Jarwiz board titled "${title}", holding ${items.length} item${items.length === 1 ? '' : 's'}. It is intended as a context handoff for another assistant.`,
    '',
  );
  lines.push('## Board contents', '');
  if (items.length === 0) {
    lines.push('_The board is empty._', '');
  } else {
    items.forEach((c, idx) => {
      const heading = c.title?.trim() ? `${c.title.trim()}` : `${c.kind} ${idx + 1}`;
      lines.push(`### ${idx + 1}. ${heading}`, '');
      lines.push(`_Type: ${c.kind}_`, '');
      lines.push((c.text || '').trim() || '_(no text)_', '');
    });
  }
  lines.push('---', '');
  lines.push('*This document is a Jarwiz session export — hand it to any assistant to continue the work.*');
  return lines.join('\n');
}

/* ─── Small utils (chunking + status heartbeat) ───────────────────────────── */

function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
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

/** Rotating "still working" lines so a 60–90s generation never looks stalled. */
const WORKING_STATUS: Record<ExportRequest['mode'], string[]> = {
  slideshow: [
    'Reading your whole board…',
    'Finding the through-line…',
    'Researching a few enriching details…',
    'Designing the slides…',
    'Drawing diagrams and charts…',
    'Polishing the deck…',
  ],
  markdown: [
    'Reading your whole board…',
    'Organising the material…',
    'Writing the handoff…',
    'Tightening it up…',
  ],
};

/* ─── The stream ──────────────────────────────────────────────────────────── */

export async function* streamExport(
  req: ExportRequest,
  signal: AbortSignal,
): AsyncGenerator<ExportEvent> {
  const format: 'html' | 'markdown' = req.mode === 'slideshow' ? 'html' : 'markdown';
  const useApi = hasModelKey();
  const useSidecar = !useApi && sidecarAvailable();

  yield { type: 'status', message: WORKING_STATUS[req.mode][0]! };

  // Run the generation in the background so we can drip honest heartbeats while
  // the model works (a single long create() emits nothing on its own). A holder
  // object keeps TS from narrowing these to their initial values inside the
  // closure (same trick as autopilot's `waker`).
  const out: { artifact: string | null; error: Error | null } = { artifact: null, error: null };
  const finish = (raw: string): string => {
    // Slideshow → the model authored only slide sections; drop them into the
    // tested shell. Markdown → just de-fence. Either can come back empty/junk,
    // which the length gate below turns into the deterministic fallback.
    const title = req.title?.trim() || 'Untitled board';
    return req.mode === 'slideshow' ? assembleDeck(raw, title) : cleanMarkdown(raw);
  };
  const work = (async () => {
    try {
      if (useApi) out.artifact = finish(await generateViaApi(req, signal));
      else if (useSidecar) out.artifact = finish(await generateViaSidecar(req, signal));
    } catch (err) {
      out.error = err instanceof Error ? err : new Error('Export failed');
    }
  })();

  let done = false;
  const settle = work.then(() => {
    done = true;
  });
  let tick = 1;
  while (!done) {
    const raced = await Promise.race([settle.then(() => 'done' as const), sleep(4000, signal).then(() => 'tick' as const)]);
    if (signal.aborted) return;
    if (raced === 'tick' && !done) {
      const lines = WORKING_STATUS[req.mode];
      yield { type: 'status', message: lines[tick % lines.length]! };
      tick += 1;
    }
  }
  await work;
  if (signal.aborted) return;

  // Model failed outright with no fallback material — surface it honestly.
  // A real key that errored is a genuine failure; the keyless path always has
  // a deterministic floor below, so only report when the model was expected.
  if (useApi && out.error && !out.artifact) {
    const err = out.error;
    const message =
      err instanceof Anthropic.APIError
        ? `Export couldn't finish (${err.status ?? 'API error'}).`
        : err.message;
    yield { type: 'error', message };
    return;
  }

  // Floor: no model reachable, or the model returned nothing usable — build the
  // deterministic artifact so the button always produces something real.
  let artifact = out.artifact;
  if (!artifact || artifact.length < 40) {
    artifact = req.mode === 'slideshow' ? fallbackSlideshow(req) : fallbackMarkdown(req);
  }

  yield { type: 'status', message: 'Assembling your export…' };

  // Drip the artifact so the client's preview builds in rather than snapping.
  for (const piece of chunk(artifact, 800)) {
    if (signal.aborted) return;
    yield { type: 'delta', textDelta: piece };
    await sleep(12, signal);
  }
  yield { type: 'done', format };
}
