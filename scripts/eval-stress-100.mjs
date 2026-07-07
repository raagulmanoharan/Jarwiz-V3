/**
 * eval-stress-100 — a 100-use-case launch-readiness stress test.
 *
 * Exercises every backend endpoint (platform, agents, autopilot, the Ask
 * router across all seven response shapes, the Thinking Machines, board
 * intelligence, ingestion, and input-validation) against a RUNNING server in
 * real `sidecar` mode (genuine Claude via the CLI — no scripted mock). It
 * fires the cases through a bounded concurrency pool, records latency and a
 * short output sample for each, and writes a machine-readable results file.
 *
 * Run with the server up (mode must be `sidecar` or `api`, not `demo`):
 *   npm run dev --workspace=apps/server            # :3001, background
 *   node scripts/eval-stress-100.mjs               # ~10 min with sidecar
 *
 * Results → /tmp/jz-stress-results.json  (consumed by the report).
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(process.cwd() + '/apps/server/');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const BASE = process.env.JZ_BASE || 'http://localhost:3001';
const CONCURRENCY = Number(process.env.JZ_CONCURRENCY || 6);
const OUT = process.env.JZ_OUT || '/tmp/jz-stress-results.json';

// ── tiny SSE + fetch helpers ────────────────────────────────────────────────
async function collectSSE(path, body, maxMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), maxMs);
  const events = [];
  let status = 0;
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = res.status;
    if (!res.ok || !res.body) return { events, status };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const e = JSON.parse(line.slice(6));
          events.push(e);
          if (e.type === 'done' || e.type === 'error') break outer;
        } catch {}
      }
    }
    return { events, status };
  } finally {
    clearTimeout(t);
  }
}

async function postJson(path, body, maxMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), maxMs);
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    return { json, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

// ── SSE content validators ──────────────────────────────────────────────────
const CONTENT_TYPES = new Set([
  'card.create', 'card.delta', 'card.done', 'card.title', 'delta', 'text',
  'table.cell', 'cell', 'affinity.note', 'affinity.cluster', 'plan', 'slot',
  'image', 'status', 'clarify',
]);
const contentCount = (events) => events.filter((e) => CONTENT_TYPES.has(e.type)).length;
const hasTerminal = (events) => events.some((e) => e.type === 'done');
const hadError = (events) => events.find((e) => e.type === 'error');
const sseText = (events) =>
  events
    .map((e) => e.textDelta || e.text || e.delta || (e.card && e.card.text) || '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/** Generic "the stream produced real content and finished cleanly." */
function sseOk(min = 1) {
  return ({ events, status }) => {
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    const err = hadError(events);
    if (err) return { ok: false, detail: `error: ${String(err.message).slice(0, 80)}` };
    const n = contentCount(events);
    if (!hasTerminal(events)) return { ok: false, detail: `no done (events=${events.length}, content=${n})` };
    if (n < min) return { ok: false, detail: `content=${n} < ${min}` };
    const sample = sseText(events).slice(0, 90);
    return { ok: true, detail: `${n} content evts · "${sample}${sample.length >= 90 ? '…' : ''}"` };
  };
}

/** A stream that must yield at least one card of a specific kind. */
function sseKind(kind) {
  return ({ events, status }) => {
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    if (hadError(events)) return { ok: false, detail: 'stream error' };
    const created = events.find((e) => e.type === 'card.create');
    const k = created?.kind || created?.card?.kind;
    if (!hasTerminal(events)) return { ok: false, detail: 'no done' };
    return k === kind
      ? { ok: true, detail: `kind=${k} · ${contentCount(events)} evts` }
      : { ok: false, detail: `kind=${k ?? 'none'} (wanted ${kind})` };
  };
}

const jsonOk = (pred) => ({ json, status }) => {
  try {
    const r = pred(json, status);
    return typeof r === 'string' ? { ok: true, detail: r } : r ? { ok: true, detail: '' } : { ok: false, detail: JSON.stringify(json).slice(0, 100) };
  } catch (e) {
    return { ok: false, detail: `validator threw: ${e.message}` };
  }
};
const expectStatus = (code) => ({ status, json }) =>
  status === code ? { ok: true, detail: `HTTP ${code}` } : { ok: false, detail: `HTTP ${status} (wanted ${code}) ${JSON.stringify(json).slice(0, 60)}` };

// ── shared fixtures ─────────────────────────────────────────────────────────
const NOTE = (text, extra = {}) => ({ cardId: 'c1', kind: 'note', x: 0, y: 0, w: 220, h: 220, text, ...extra });
const T = { fast: 45_000, llm: 90_000, web: 160_000, io: 15_000 };

const PDF_BYTES = (() => {
  try { return readFileSync('node_modules/pdf-parse/test/data/01-valid.pdf'); } catch { return null; }
})();
const PDF_DATA_URL = PDF_BYTES ? 'data:application/pdf;base64,' + PDF_BYTES.toString('base64') : null;

// ── the 100 cases ───────────────────────────────────────────────────────────
// Each: { id, group, name, run: async () => rawResult, check: (rawResult) => {ok,detail} }
// `run` returns { events } for SSE or { json, status } for JSON; `check` reads it.
const cases = [];
let seq = 0;
const add = (group, name, run, check) => cases.push({ id: ++seq, group, name, run, check });

// helper builders
const sse = (path, body, ms) => () => collectSSE(path, body, ms);
const jpost = (path, body, ms) => () => postJson(path, body, ms);
const jget = (path, ms = T.io) => async () => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { json, status: res.status };
  } finally { clearTimeout(t); }
};

// ═══ Group A — Platform, ingestion & input-validation (fast/deterministic) ═══
add('A · Platform', 'GET /api/health', jget('/api/health'),
  jsonOk((j) => j?.ok === true && 'ok:true'));
add('A · Platform', 'GET /api/capabilities is live', jget('/api/capabilities'),
  jsonOk((j) => (j?.live === true && ['api', 'sidecar'].includes(j.mode)) ? `mode=${j.mode}` : { ok: false, detail: JSON.stringify(j) }));
add('A · Platform', 'Asset presign → PUT → GET round-trip', async () => {
  const pre = await postJson('/api/assets/presign', { prefix: 'test' }, T.io);
  const id = pre.json?.assetId;
  if (!id) return { json: pre.json, status: pre.status, note: 'no assetId' };
  const put = await fetch(`${BASE}/api/assets/${id}`, { method: 'PUT', body: Buffer.from('hello jarwiz') });
  const get = await fetch(`${BASE}/api/assets/${id}`);
  const text = await get.text();
  return { json: { id, putOk: put.ok, getStatus: get.status, text }, status: 200 };
}, jsonOk((j) => (j.id && j.putOk && j.getStatus === 200 && j.text === 'hello jarwiz') ? `stored+served ${j.id.slice(0, 16)}…` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('A · Platform', 'Sheet grid rejects bad asset id', jget('/api/sheet/not!valid/grid'),
  expectStatus(400));

add('A · Ingestion', 'Link preview: real public URL', jpost('/api/link/preview', { url: 'https://example.com' }, 20_000),
  jsonOk((j, s) => s === 200 ? `title="${(j.title || j.domain || '').slice(0, 40)}"` : { ok: false, detail: `HTTP ${s}` }));
add('A · Ingestion', 'Link preview: Wikipedia article', jpost('/api/link/preview', { url: 'https://en.wikipedia.org/wiki/Infrared' }, 20_000),
  jsonOk((j, s) => s === 200 ? `title="${(j.title || j.domain || '').slice(0, 40)}"` : { ok: false, detail: `HTTP ${s}` }));
add('A · Security', 'SSRF: link-metadata IP blocked', jpost('/api/link/preview', { url: 'http://169.254.169.254/latest/meta-data/' }, 15_000),
  expectStatus(400));
add('A · Security', 'SSRF: localhost blocked', jpost('/api/link/preview', { url: 'http://localhost:3001/api/health' }, 15_000),
  expectStatus(400));
add('A · Security', 'SSRF: private 10.x blocked', jpost('/api/link/preview', { url: 'http://10.0.0.1/' }, 15_000),
  expectStatus(400));
add('A · Ingestion', 'YouTube text ingest (metadata/transcript)', jpost('/api/youtube/text', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, 60_000),
  jsonOk((j, s) => s === 200 ? `got ${(j.text || '').length} chars${j.frames?.length ? ` +${j.frames.length} frames` : ''}` : { ok: false, detail: `HTTP ${s} ${JSON.stringify(j).slice(0, 60)}` }));

add('A · Validation', 'link/preview rejects empty body', jpost('/api/link/preview', {}, T.io), expectStatus(400));
add('A · Validation', 'link/preview rejects blank url', jpost('/api/link/preview', { url: '' }, T.io), expectStatus(400));
add('A · Validation', 'youtube/text rejects non-url', jpost('/api/youtube/text', { url: 'not a url' }, T.io), expectStatus(400));
add('A · Validation', 'agents/run rejects unknown agent', jpost('/api/agents/wizard/run', { source: NOTE('x'), placement: { x: 0, y: 0 } }, T.io), expectStatus(404));
add('A · Validation', 'autopilot rejects missing fields', jpost('/api/autopilot', {}, T.io), expectStatus(400));
add('A · Validation', 'autopilot rejects bad kind', jpost('/api/autopilot', { kind: 'spreadsheet', text: 'x' }, T.io), expectStatus(400));
add('A · Validation', 'autopilot/table rejects bad shape', jpost('/api/autopilot/table', { columns: [1, 2], rows: 'nope' }, T.io), expectStatus(400));
add('A · Validation', 'ask rejects empty prompt', jpost('/api/ask', { sources: [] }, T.io), expectStatus(400));
add('A · Validation', 'analyze rejects bad mode', jpost('/api/analyze', { mode: 'vibes', cards: [] }, T.io), expectStatus(400));
add('A · Validation', 'cluster rejects non-string items', jpost('/api/cluster', { items: [1, 2, 3] }, T.io), expectStatus(400));
add('A · Validation', 'suggest rejects bad kind', jpost('/api/suggest', { kind: 'spreadsheet' }, T.io), expectStatus(400));

// ═══ Group B — Fast intent/shape classifiers ════════════════════════════════
const intent = (prompt, want) => add('B · Intent router', `intent: "${prompt.slice(0, 32)}" → ${want}`,
  jpost('/api/intent', { prompt, cardType: 'doc' }, T.fast),
  jsonOk((j) => ['new', 'edit'].includes(j?.intent) ? `intent=${j.intent}${j.intent === want ? '' : ` (expected ${want})`}` : { ok: false, detail: JSON.stringify(j) }));
intent('Make this shorter and punchier', 'edit');
intent('Add a section on risks', 'edit');
intent('Fix the grammar in this', 'edit');
intent('Write a poem about the ocean', 'new');
intent('Brainstorm 10 startup names', 'new');
intent('Turn this into a formal tone', 'edit');

const shape = (prompt, wants) => add('B · Shape router', `shape: "${prompt.slice(0, 34)}"`,
  jpost('/api/suggest-shape', { prompt }, T.fast),
  jsonOk((j) => {
    const s = j?.shape ?? null;
    const ok = wants ? wants.includes(s) : true; // null (doc) is always acceptable
    return ok ? `shape=${s ?? 'doc'}` : { ok: false, detail: `shape=${s} (wanted ${wants})` };
  }));
shape('Compare Postgres vs MySQL vs SQLite for a SaaS', ['table', 'dashboard', null]);
shape('Step-by-step guide to deploy a Node app', ['list', null]);
shape('Draw a flowchart of our user onboarding', ['diagram', null]);
shape('Group all these research findings into themes', ['affinity', null]);
shape('Design a landing page hero for a coffee brand', ['prototype', null]);
shape('KPI overview for Q3 growth metrics', ['dashboard', 'table', null]);

// ═══ Group C — Agents across domains ════════════════════════════════════════
const agentRun = (agentId, text, name, kindWanted) => add(`C · ${agentId}`, name,
  sse(`/api/agents/${agentId}/run`, { source: NOTE(text), placement: { x: 400, y: 0 } }, T.llm),
  kindWanted ? sseKind(kindWanted) : sseOk(2));
agentRun('summarizer', 'The James Webb Space Telescope observes infrared light, letting it peer through cosmic dust to see the earliest galaxies formed after the Big Bang.', 'Summarize: astronomy note');
agentRun('summarizer', 'Our Q2 churn rose to 6.1% driven mostly by SMB accounts on the legacy plan; enterprise retention held at 94%. Support ticket volume spiked after the March pricing change.', 'Summarize: business metrics');
agentRun('summarizer', 'Sourdough fermentation relies on wild yeast and lactobacillus; longer bulk fermentation develops flavor but over-proofing collapses the gluten network.', 'Summarize: cooking science');
agentRun('summarizer', 'The Treaty of Westphalia in 1648 ended the Thirty Years War and established the principle of state sovereignty that underpins the modern international system.', 'Summarize: history note');
agentRun('writer', 'Compare React vs Vue vs Svelte — developer experience, performance, and ecosystem', 'Writer routes comparison → table', 'table');
agentRun('writer', 'Write a short vision statement for a note-taking app that respects user attention', 'Writer: vision doc', 'doc');
agentRun('writer', 'Synthesize the case for a four-day work week from productivity research', 'Writer: synthesis doc', 'doc');
agentRun('writer', 'Compare gas vs induction vs electric-coil stoves for a home cook', 'Writer: comparison → table', 'table');
agentRun('brainstormer', 'Names for a calm, minimal meditation app aimed at busy professionals', 'Brainstorm: product names');
agentRun('brainstormer', 'Ways to reduce food waste in a small restaurant kitchen', 'Brainstorm: operations ideas');
agentRun('brainstormer', 'Fresh angles for a blog about learning to code as a career-changer', 'Brainstorm: content angles');
agentRun('brainstormer', 'Feature ideas for an infinite-canvas thinking tool', 'Brainstorm: features');
agentRun('researcher', 'What are the main approaches to carbon capture and their trade-offs?', 'Research: climate tech');
agentRun('researcher', 'Key considerations when migrating a monolith to microservices', 'Research: architecture');
agentRun('researcher', 'Evidence on whether standing desks improve health outcomes', 'Research: health');
agentRun('researcher', 'History and impact of the shipping container on global trade', 'Research: economics');

// ═══ Group D — Autopilot (continuation + table fill) ═════════════════════════
const autopilotDoc = (name, kind, title, text) => add('D · Autopilot prose',
  name, sse('/api/autopilot', { kind, title, text }, T.llm), sseOk(2));
autopilotDoc('Doc continue: async work', 'doc', 'Async beats meetings', 'Meetings are where momentum goes to die:');
autopilotDoc('Doc continue: onboarding', 'doc', 'A better onboarding', 'The first five minutes decide whether a user stays. Here is what we get wrong:');
autopilotDoc('Doc continue: essay', 'doc', 'On deep work', 'Attention is the scarcest resource of the modern knowledge worker.');
autopilotDoc('Doc continue: technical', 'doc', 'Caching strategy', 'We invalidate the cache on write, but that leaves a race:');
autopilotDoc('Doc continue: narrative', 'doc', 'The last mile', 'Every logistics problem eventually becomes a last-mile problem, because');
autopilotDoc('Note continue: bullets', 'note', 'Launch checklist', 'Before we ship:\n- finalize pricing page\n-');
autopilotDoc('Note continue: idea', 'note', 'Feature idea', 'What if the canvas could cluster related cards automatically');
autopilotDoc('Note continue: journal', 'note', 'Standup', 'Yesterday I shipped the link previews. Today I plan to');

const tableFill = (name, columns, rows) => add('D · Autopilot table',
  name, sse('/api/autopilot/table', { columns, rows }, T.llm),
  ({ events, status }) => {
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    if (hadError(events)) return { ok: false, detail: 'stream error' };
    const cells = events.filter((e) => e.type === 'cell').length;
    return cells >= 2 && hasTerminal(events) ? { ok: true, detail: `${cells} cells filled` } : { ok: false, detail: `cells=${cells}` };
  });
tableFill('Table fill: design tools', ['Tool', 'Price', 'Best for'], [['Figma', '', ''], ['Sketch', '', ''], ['Framer', '', '']]);
tableFill('Table fill: planets', ['Planet', 'Moons', 'Notable feature'], [['Mars', '', ''], ['Jupiter', '', ''], ['Saturn', '', '']]);
tableFill('Table fill: langs', ['Language', 'Typing', 'Common use'], [['Rust', '', ''], ['Python', '', ''], ['Go', '', '']]);
tableFill('Table fill: partial rows', ['Framework', 'Language', 'Rendering'], [['Next.js', 'TypeScript', ''], ['Rails', '', 'server'], ['Django', '', '']]);

// ═══ Group E — Ask router across all seven response shapes ═══════════════════
const ask = (name, body, check, ms = T.llm) => add('E · Ask router', name, sse('/api/ask', body, ms), check);
ask('Ask → doc (explicit)', { prompt: 'Explain the CAP theorem to a junior engineer', shape: 'doc', sources: [] }, sseOk(2));
ask('Ask → table (explicit)', { prompt: 'Compare AWS, GCP and Azure on compute, storage and pricing', shape: 'table', sources: [] }, sseOk(2));
ask('Ask → list (explicit)', { prompt: 'Checklist for launching an open-source project', shape: 'list', sources: [] }, sseOk(2));
ask('Ask → diagram (explicit)', { prompt: 'The lifecycle of an HTTP request through a CDN and origin', shape: 'diagram', sources: [] }, sseOk(1));
ask('Ask → affinity (explicit)', { prompt: 'Organize these into themes: pricing confusion, slow load, unclear onboarding, missing docs, great support, buggy export', shape: 'affinity', sources: [] }, sseOk(1));
ask('Ask → prototype (explicit)', { prompt: 'A pricing page for a solo-founder SaaS with three tiers', shape: 'prototype', sources: [] }, sseOk(1));
ask('Ask → dashboard (explicit)', { prompt: 'A metrics dashboard for a subscription business', shape: 'dashboard', sources: [] }, sseOk(1));
ask('Ask auto-route: comparison prompt', { prompt: 'Postgres vs MongoDB for an events pipeline — trade-offs', sources: [] }, sseOk(2));
ask('Ask auto-route: how-to prompt', { prompt: 'How do I set up CI/CD for a monorepo?', sources: [] }, sseOk(2));
ask('Ask grounded on a source note', { prompt: 'What are the three biggest risks here?', sources: [NOTE('Launch plan: ship the mobile app in 3 weeks with a team of two, no QA hire yet, and a hard marketing date tied to a conference.')] }, sseOk(2));
ask('Ask across multiple sources', { prompt: 'Synthesize a single recommendation from these', sources: [NOTE('Users love the speed but hate the pricing page.'), NOTE('Support tickets are 60% about billing confusion.'), NOTE('Competitor just launched a free tier.')] }, sseOk(2));
ask('Ask refine in place (currentShape=table)', { prompt: 'Add a column for "learning curve"', currentShape: 'table', sources: [NOTE('A table comparing Vim, VS Code and Emacs on speed and extensibility.')] }, sseOk(1));
ask('Ask ambiguous → may clarify', { prompt: 'Make it better', sources: [NOTE('A rough draft about remote work.')] }, ({ events, status }) => {
  if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
  if (hadError(events)) return { ok: false, detail: 'stream error' };
  const clarified = events.some((e) => e.type === 'clarify');
  return hasTerminal(events) || clarified ? { ok: true, detail: clarified ? 'asked a clarifying question' : `${contentCount(events)} content evts` } : { ok: false, detail: 'no terminal/clarify' };
});
ask('Ask long-context source (8k truncation)', { prompt: 'Give me the five key takeaways', sources: [NOTE(('The report covers market sizing, competition, unit economics, GTM, and risks. ').repeat(120))] }, sseOk(2));
ask('Ask → list of steps for a recipe', { prompt: 'Steps to make a classic margherita pizza from scratch', shape: 'list', sources: [] }, sseOk(2));
ask('Ask → diagram of a state machine', { prompt: 'A state diagram for an order: created, paid, shipped, delivered, refunded', shape: 'diagram', sources: [] }, sseOk(1));

// ═══ Group F — Thinking Machines ════════════════════════════════════════════
// Table/list/doc machines run through /api/ask with machineId. Board machines
// (swot, effortimpact) fan out through /api/compose. Deep machines use web.
const machineAsk = (id, subject, deep) => add('F · Thinking Machine', `machine: ${id}`,
  sse('/api/ask', { prompt: subject, machineId: id, sources: [], deep: !!deep }, deep ? T.web : T.llm), sseOk(1));
machineAsk('competitive', 'Notion vs Obsidian vs Roam in the personal knowledge-management market', true);
machineAsk('risk', 'Launching a hardware startup that ships a smart home device in 9 months', true);
machineAsk('proscons', 'Adopting a four-day work week at a 50-person software company', true);
machineAsk('fivewhys', 'Our checkout conversion dropped 20% after the last release', true);
machineAsk('persona', 'The primary user of a budgeting app for freelancers with irregular income', true);

const machineBoard = (id, intent, opts) => add('F · Thinking Machine', `machine board: ${id}`,
  sse('/api/compose', { intent, machineId: id, board: [], options: opts || [] }, T.web),
  ({ events, status }) => {
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    if (hadError(events)) return { ok: false, detail: 'stream error' };
    const created = events.filter((e) => e.type === 'card.create').length;
    return created >= 2 && hasTerminal(events) ? { ok: true, detail: `${created} cards fanned out` } : { ok: false, detail: `cards=${created}` };
  });
machineBoard('swot', 'A regional coffee-roaster chain considering national expansion', ['tows']);
machineBoard('effortimpact', 'Backlog for a small design team: redesign onboarding, fix a11y, add dark mode, write docs, refactor tokens', ['verdict']);

// ═══ Group G — Board intelligence, clustering, suggestions, diagram ═════════
const boardCards = [
  { id: 'k1', kind: 'note', text: 'We must ship the mobile app before the June conference — the date is fixed.' },
  { id: 'k2', kind: 'note', text: 'Engineering estimates the mobile app needs 4 months of work.' },
  { id: 'k3', kind: 'note', text: 'We have not hired a QA engineer yet and the budget is frozen.' },
  { id: 'k4', kind: 'note', text: 'Marketing already announced the June launch publicly.' },
];
add('G · Analyze', 'analyze: tensions', sse('/api/analyze', { mode: 'tensions', cards: boardCards }, T.llm), sseOk(1));
add('G · Analyze', 'analyze: gaps', sse('/api/analyze', { mode: 'gaps', cards: boardCards }, T.llm), sseOk(1));
add('G · Analyze', 'analyze: critique', sse('/api/analyze', { mode: 'critique', cards: boardCards }, T.llm), sseOk(1));

add('G · Cluster', 'cluster: mixed stickies', jpost('/api/cluster', {
  items: ['slow page load', 'confusing pricing', 'great customer support', 'buggy CSV export', 'unclear onboarding', 'love the speed', 'missing API docs', 'billing errors'],
}, T.llm), jsonOk((j) => Array.isArray(j?.themes) && j.themes.length >= 2 ? `${j.themes.length} themes: ${j.themes.map((t) => t.label || t.name).slice(0, 3).join(', ')}` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Cluster', 'cluster: research findings', jpost('/api/cluster', {
  items: ['users skim not read', 'mobile traffic is 70%', 'checkout abandoned at shipping cost', 'trust badges help', 'reviews drive conversion', 'guest checkout preferred', 'slow images hurt', 'coupon field causes hunting'],
}, T.llm), jsonOk((j) => Array.isArray(j?.themes) && j.themes.length >= 2 ? `${j.themes.length} themes` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));

add('G · Cluster-suggest', 'cluster-suggest: onboarding set', jpost('/api/cluster-suggest', {
  theme: 'onboarding',
  items: [
    { kind: 'link', title: 'The Elements of User Onboarding' },
    { kind: 'youtube', title: 'How Duolingo designs habit-forming onboarding' },
    { kind: 'pdf', title: 'SaaS Activation Benchmarks 2025' },
  ],
}, T.llm), jsonOk((j) => Array.isArray(j?.suggestions) && j.suggestions.length >= 1 ? `${j.suggestions.length}: ${j.suggestions.map((s) => s.label).slice(0, 3).join(' · ')}` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Cluster-suggest', 'cluster-suggest: research set', jpost('/api/cluster-suggest', {
  theme: 'climate',
  items: [
    { kind: 'pdf', title: 'IPCC AR6 Synthesis Report' },
    { kind: 'link', title: 'Our World in Data — CO2 emissions' },
    { kind: 'youtube', title: 'How direct air capture actually works' },
  ],
}, T.llm), jsonOk((j) => Array.isArray(j?.suggestions) && j.suggestions.length >= 1 ? `${j.suggestions.length} suggestions` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));

add('G · Suggest', 'suggest: YouTube card', jpost('/api/suggest', { kind: 'youtube', url: 'https://www.youtube.com/watch?v=aircAruvnKk', title: 'But what is a neural network?' }, T.llm),
  jsonOk((j) => Array.isArray(j?.suggestions) ? `${j.suggestions.length} suggestions` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Suggest', 'suggest: link card', jpost('/api/suggest', { kind: 'link', url: 'https://stripe.com/pricing', title: 'Stripe Pricing' }, T.llm),
  jsonOk((j) => Array.isArray(j?.suggestions) ? `${j.suggestions.length} suggestions` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Suggest', 'suggest: PDF card (real parse)', PDF_DATA_URL
  ? jpost('/api/suggest', { kind: 'pdf', title: 'paper.pdf', pdfDataUrl: PDF_DATA_URL }, T.llm)
  : async () => ({ json: { suggestions: [], skip: true }, status: 200 }),
  jsonOk((j) => j.skip ? 'skipped (no fixture pdf)' : (Array.isArray(j?.suggestions) && j.suggestions.every((s) => s.label && ['researcher', 'summarizer', 'brainstormer', 'writer'].includes(s.agentId)) ? `${j.suggestions.length} agent-attributed: ${j.suggestions.map((s) => s.label).slice(0, 2).join(' · ')}` : { ok: false, detail: JSON.stringify(j).slice(0, 100) })));

add('G · Seed prompts', 'seed-prompts from text', jpost('/api/seed-prompts', {
  title: 'The Economics of Remote Work',
  text: 'This paper analyzes how distributed teams affect productivity, real-estate costs, talent access, and collaboration overhead across 400 firms from 2020 to 2024.',
}, T.llm), jsonOk((j) => Array.isArray(j?.prompts) && j.prompts.length >= 1 ? `${j.prompts.length} prompts: "${(j.prompts[0]?.label || j.prompts[0] || '').toString().slice(0, 40)}"` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));

add('G · Diagram', 'diagram: deployment flow', jpost('/api/diagram', { prompt: 'CI/CD pipeline: commit, build, test, stage, approve, deploy' }, T.llm),
  jsonOk((j) => Array.isArray(j?.nodes) && j.nodes.length >= 3 ? `${j.nodes.length} nodes / ${j.edges?.length ?? 0} edges` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Diagram', 'diagram: from source card', jpost('/api/diagram', { prompt: 'Turn this into a flowchart', sources: [NOTE('User signs up, verifies email, completes profile, then reaches the dashboard; if verification fails they retry.')] }, T.llm),
  jsonOk((j) => Array.isArray(j?.nodes) && j.nodes.length >= 3 ? `${j.nodes.length} nodes` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));

add('G · Notice', 'notice: proactive board review', jpost('/api/notice', { today: '2026-07-07', cards: boardCards }, T.llm),
  jsonOk((j) => Array.isArray(j?.comments) ? `${j.comments.length} comment(s)${j.comments[0] ? `: "${String(j.comments[0].body).slice(0, 40)}…"` : ' (board is fine — valid)'}` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Annotate', 'annotate: stickies pass', jpost('/api/annotate', { prompt: 'Flag anything unrealistic about this plan', cards: boardCards }, T.llm),
  jsonOk((j) => Array.isArray(j?.notes) ? `${j.notes.length} sticky note(s)` : { ok: false, detail: JSON.stringify(j).slice(0, 80) }));
add('G · Compose', 'compose: free-form plan fan-out', sse('/api/compose', { intent: 'Plan a two-week launch sprint for a small SaaS: workstreams, milestones and owners', board: [] }, T.llm),
  ({ events, status }) => {
    if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
    if (hadError(events)) return { ok: false, detail: 'stream error' };
    const created = events.filter((e) => e.type === 'card.create').length;
    return created >= 2 && hasTerminal(events) ? { ok: true, detail: `${created} cards laid out` } : { ok: false, detail: `cards=${created}` };
  });

// ── runner (bounded concurrency) ────────────────────────────────────────────
async function runCase(c) {
  const started = Date.now();
  try {
    const raw = await c.run();
    const verdict = c.check(raw);
    return { ...c, ok: verdict.ok, detail: verdict.detail, ms: Date.now() - started };
  } catch (e) {
    const aborted = /abort/i.test(String(e?.message));
    return { ...c, ok: false, detail: aborted ? `TIMEOUT after ${Date.now() - started}ms` : `threw: ${String(e?.message).slice(0, 100)}`, ms: Date.now() - started };
  }
}

async function main() {
  const cap = await fetch(`${BASE}/api/capabilities`).then((r) => r.json()).catch(() => ({ mode: 'unreachable' }));
  console.log(`\nJarwiz 100-case stress test — server mode: ${cap.mode} (live=${cap.live})`);
  if (cap.mode === 'demo' || cap.mode === 'unreachable') {
    console.error(`\n✖ Server is not in real mode (${cap.mode}). Start it so /api/capabilities reports "sidecar" or "api".`);
    process.exit(2);
  }
  // Optional smoke filters: JZ_ONLY=substr (name/group match), JZ_LIMIT=n.
  let selected = cases.slice();
  if (process.env.JZ_ONLY) {
    const q = process.env.JZ_ONLY.toLowerCase();
    selected = selected.filter((c) => (c.group + ' ' + c.name).toLowerCase().includes(q));
  }
  if (process.env.JZ_LIMIT) selected = selected.slice(0, Number(process.env.JZ_LIMIT));
  console.log(`Total defined: ${cases.length}. Running ${selected.length} cases @ concurrency ${CONCURRENCY}…\n`);

  const work = selected;
  const results = new Array(work.length);
  let idx = 0;
  let doneCount = 0;
  const t0 = Date.now();
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= work.length) return;
      const r = await runCase(work[i]);
      results[i] = r;
      doneCount++;
      const mark = r.ok ? '✅' : '❌';
      console.log(`  ${mark} [${String(r.id).padStart(3)}/${work.length}] ${r.group} — ${r.name}  (${(r.ms / 1000).toFixed(1)}s)  ${r.detail || ''}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wall = ((Date.now() - t0) / 1000).toFixed(0);

  // ── summary ──
  const pass = results.filter((r) => r.ok).length;
  const byGroup = {};
  for (const r of results) {
    const g = r.group;
    byGroup[g] = byGroup[g] || { pass: 0, total: 0, ms: [] };
    byGroup[g].total++;
    byGroup[g].ms.push(r.ms);
    if (r.ok) byGroup[g].pass++;
  }
  console.log(`\n${'═'.repeat(64)}\nRESULTS: ${pass}/${results.length} passed in ${wall}s (concurrency ${CONCURRENCY})\n`);
  for (const [g, s] of Object.entries(byGroup)) {
    const avg = (s.ms.reduce((a, b) => a + b, 0) / s.ms.length / 1000).toFixed(1);
    console.log(`  ${s.pass === s.total ? '✅' : '⚠️ '} ${g.padEnd(24)} ${s.pass}/${s.total}   avg ${avg}s`);
  }
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log(`\nFailures (${fails.length}):`);
    for (const r of fails) console.log(`  ❌ [${r.id}] ${r.name} — ${r.detail}`);
  }

  const llm = results.filter((r) => r.ms > 3000).map((r) => r.ms).sort((a, b) => a - b);
  const pctl = (p) => llm.length ? (llm[Math.floor((llm.length - 1) * p)] / 1000).toFixed(1) + 's' : 'n/a';
  console.log(`\nLatency (LLM-bearing cases): p50 ${pctl(0.5)}  p90 ${pctl(0.9)}  max ${pctl(1)}`);

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: cap.mode, live: cap.live, concurrency: CONCURRENCY, wallSeconds: Number(wall),
    pass, total: results.length,
    latency: { p50: pctl(0.5), p90: pctl(0.9), max: pctl(1) },
    byGroup: Object.fromEntries(Object.entries(byGroup).map(([g, s]) => [g, { pass: s.pass, total: s.total, avgMs: Math.round(s.ms.reduce((a, b) => a + b, 0) / s.ms.length) }])),
    results: results.map((r) => ({ id: r.id, group: r.group, name: r.name, ok: r.ok, ms: r.ms, detail: r.detail })),
  }, null, 2));
  console.log(`\nWrote ${OUT}`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
