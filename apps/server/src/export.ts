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
const GEN_TIMEOUT_MS = 150_000;

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

const BRAND = `Jarwiz brand language — monochrome and editorial:
- Palette (light): page #f5f5f5, ink #0a0a0a, muted ink #5a5a5a, hairline rgba(0,0,0,.10), one restrained near-black accent #0f0f0f. Generous whitespace; nothing loud.
- Type: system UI stack — font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif. Large, confident headings; calm body. Tabular numerals for figures.
- Feel: precise, quiet, expensive. Thin hairlines over heavy borders; soft shadows; rounded corners (12–20px). A single accent used sparingly (a rule, a dot, a key number) — never a rainbow.`;

/** The slideshow system prompt. The LIVE WEB paragraph is included ONLY when
 *  the caller actually granted web tools — otherwise the model, told it can
 *  research, narrates a `web_search(...)` call as text instead of writing the
 *  deck. */
function slideshowSystem(web: boolean): string {
  const webPara = web
    ? `

LIVE WEB (optional, use sparingly): you may web_search / web_fetch to enrich the deck with a current, relevant fact, figure, or example the board gestures at — do it only when it clearly strengthens the story, keep it to a couple of lookups, and stay grounded in the board. Never pad. Do all research first, then write the file once.`
    : '';
  return `You are Jarwiz's presentation designer. You turn a collaborator's infinite-canvas board into a slick, self-contained HTML slide deck that makes them look brilliant in the room.

Read the whole board as your grounding, then SYNTHESISE — don't transcribe. Find the through-line and build a narrative: a strong title, an agenda, the argument told in the right order, and a clear "where next". Add genuine value the board only implies: distill messy notes into crisp points, draw the flow the cards describe, tabulate the comparison, chart the numbers, name the takeaway.

${BRAND}

OUTPUT CONTRACT — return ONLY a complete, valid HTML5 document (start with <!DOCTYPE html>). No prose, no markdown, no code fences around it. It MUST be entirely self-contained:
- ALL CSS in one <style>; ALL behaviour in one <script>. NO external stylesheets, NO web fonts, NO CDN scripts, NO frameworks — the file has to open offline and never make a network request.${web ? ' (An <img> with a real absolute https URL you actually found via research is the ONLY allowed remote resource; never invent image URLs.)' : ' Do not reference any remote image, font, or script.'}
- Slides: 16:9, one visible at a time, centered in the viewport, sized in vw/vh so they scale to any screen. Quiet enter transition; honour prefers-reduced-motion.
- Navigation that just works: ArrowRight/ArrowLeft/Space/PageUp/PageDown and click, plus discreet on-screen ‹ › controls, a slide counter (e.g. "03 / 12"), and a thin top progress bar. 'f' toggles fullscreen. Sync the slide index to location.hash so a deep link reopens the right slide. Everything keyboard-accessible.
- Content: a title slide, an agenda/overview, then the body slides, then a closing "Next steps" or "Takeaways" slide. Speaker-quality concision — a few tight bullets or one strong statement per slide, never a wall of text. VARY the slide forms to fit the material: section dividers, a comparison table, a process/flow diagram (pure HTML+CSS or inline SVG), a bar or line chart (inline SVG — compute the geometry yourself, no chart library), a big-number stat slide, a quote/callout. Every slide earns its place.
- A small persistent footer: the board title on the left, "Made with Jarwiz" on the right.${webPara}

Be honest: never fabricate specific numbers, quotes, or sources. If you show a chart, its values must come from the board${web ? ' or from something you actually looked up' : ''}.`;
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

/* ─── Cleanup ─────────────────────────────────────────────────────────────── */

/** Strip a stray ```html / ``` wrapper the model sometimes adds around the whole
 *  document, and lift to the real start of the artifact. */
function cleanArtifact(raw: string, mode: ExportRequest['mode']): string {
  let s = raw.trim();
  const fence = /^```(?:html|markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(s);
  if (fence) s = fence[1]!.trim();
  if (mode === 'slideshow') {
    const doctype = s.search(/<!doctype html/i);
    if (doctype > 0) s = s.slice(doctype);
    else if (doctype === -1) {
      // No doctype at all — lift to <html> if there's a preamble, then prepend
      // one so the deck renders in standards mode (quirks mode breaks the
      // vh/vw sizing and flexbox the layout relies on).
      const html = s.search(/<html[\s>]/i);
      if (html > 0) s = s.slice(html);
      if (/^<html[\s>]/i.test(s)) s = `<!DOCTYPE html>\n${s}`;
    }
  }
  return s.trim();
}

/* ─── Deterministic fallback (no model) ───────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A faithful, presentable deck built with no model — title slide + one slide
 *  per board item, wrapped in the same brand chrome and nav the live path aims
 *  for. Never the star of the show, but never broken either. */
function fallbackSlideshow(req: ExportRequest): string {
  const title = req.title?.trim() || 'Untitled board';
  const items = req.board.slice(0, MAX_BOARD_CARDS);
  const slidesHtml: string[] = [];
  slidesHtml.push(
    `<section class="slide slide--title"><div><p class="eyebrow">Jarwiz board</p><h1>${escapeHtml(title)}</h1><p class="lede">${items.length} item${items.length === 1 ? '' : 's'} on the board</p></div></section>`,
  );
  for (const c of items) {
    const heading = escapeHtml(c.title?.trim() || c.kind);
    const kind = escapeHtml(c.kind);
    const body = (c.text || '').trim();
    const paras = body
      ? body
          .split(/\n{2,}/)
          .slice(0, 8)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
          .join('')
      : '<p class="muted">(no text)</p>';
    slidesHtml.push(
      `<section class="slide"><div><p class="eyebrow">${kind}</p><h2>${heading}</h2><div class="body">${paras}</div></div></section>`,
    );
  }
  slidesHtml.push(
    `<section class="slide slide--title"><div><p class="eyebrow">Thank you</p><h2>Made with Jarwiz</h2></div></section>`,
  );
  return deckShell(title, slidesHtml.join('\n'));
}

/** The self-contained brand chrome + navigation script the fallback deck lives
 *  in — light, editorial, monochrome, keyboard-driven. */
function deckShell(title: string, slides: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Jarwiz</title>
<style>
  :root { --page:#f5f5f5; --ink:#0a0a0a; --muted:#5a5a5a; --hair:rgba(0,0,0,.10); --accent:#0f0f0f; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { height:100%; }
  body { background:var(--page); color:var(--ink); font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif; -webkit-font-smoothing:antialiased; overflow:hidden; }
  .progress { position:fixed; top:0; left:0; height:3px; background:var(--accent); width:0; transition:width .3s cubic-bezier(.2,0,0,1); z-index:10; }
  .deck { height:100vh; display:grid; place-items:center; }
  .slide { position:absolute; inset:0; display:none; place-items:center; padding:8vh 10vw; opacity:0; transition:opacity .4s cubic-bezier(.2,0,0,1); }
  .slide.active { display:grid; opacity:1; }
  .slide > div { max-width:60vw; }
  .slide--title > div { text-align:left; }
  .eyebrow { text-transform:uppercase; letter-spacing:.18em; font-size:1.6vh; font-weight:600; color:var(--muted); margin-bottom:2.4vh; }
  h1 { font-size:7vh; line-height:1.02; font-weight:700; letter-spacing:-.02em; }
  h2 { font-size:4.4vh; line-height:1.08; font-weight:700; letter-spacing:-.015em; margin-bottom:2.4vh; }
  .lede { margin-top:3vh; font-size:2.4vh; color:var(--muted); }
  .body { font-size:2.2vh; line-height:1.5; color:var(--ink); }
  .body p { margin-bottom:1.4vh; max-width:52vw; }
  .muted { color:var(--muted); }
  .nav { position:fixed; bottom:3.5vh; right:4vw; display:flex; align-items:center; gap:1.4vw; z-index:10; }
  .nav button { appearance:none; border:1px solid var(--hair); background:transparent; color:var(--ink); width:5vh; height:5vh; border-radius:50%; font-size:2.4vh; cursor:pointer; display:grid; place-items:center; transition:background .14s; }
  .nav button:hover { background:rgba(0,0,0,.05); }
  .counter { font-variant-numeric:tabular-nums; font-size:1.7vh; color:var(--muted); letter-spacing:.05em; }
  .foot { position:fixed; bottom:3.5vh; left:4vw; right:auto; display:flex; gap:1vw; font-size:1.5vh; color:var(--muted); z-index:10; }
  @media (prefers-reduced-motion: reduce) { .slide, .progress { transition:none; } }
</style>
</head>
<body>
  <div class="progress" id="progress"></div>
  <div class="deck" id="deck">
${slides}
  </div>
  <div class="foot"><span>${escapeHtml(title)}</span></div>
  <div class="nav">
    <span class="counter" id="counter">01 / 01</span>
    <button id="prev" aria-label="Previous slide">‹</button>
    <button id="next" aria-label="Next slide">›</button>
    <span class="foot-brand" style="color:var(--muted);font-size:1.5vh">Made with Jarwiz</span>
  </div>
<script>
  (function () {
    var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
    var i = 0;
    function clamp(n){ return Math.max(0, Math.min(slides.length - 1, n)); }
    function show(n){
      i = clamp(n);
      slides.forEach(function(s, k){ s.classList.toggle('active', k === i); });
      var pct = slides.length > 1 ? (i / (slides.length - 1)) * 100 : 100;
      document.getElementById('progress').style.width = pct + '%';
      var pad = function(x){ return (x < 10 ? '0' : '') + x; };
      document.getElementById('counter').textContent = pad(i + 1) + ' / ' + pad(slides.length);
      if (location.hash !== '#' + (i + 1)) history.replaceState(null, '', '#' + (i + 1));
    }
    function go(d){ show(i + d); }
    document.getElementById('next').onclick = function(){ go(1); };
    document.getElementById('prev').onclick = function(){ go(-1); };
    document.addEventListener('keydown', function(e){
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { go(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); else document.exitFullscreen && document.exitFullscreen(); }
    });
    var start = parseInt((location.hash || '').slice(1), 10);
    show(isNaN(start) ? 0 : start - 1);
  })();
</script>
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
  const work = (async () => {
    try {
      if (useApi) out.artifact = cleanArtifact(await generateViaApi(req, signal), req.mode);
      else if (useSidecar) out.artifact = cleanArtifact(await generateViaSidecar(req, signal), req.mode);
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
