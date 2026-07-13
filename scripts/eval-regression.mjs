/**
 * Regression + performance harness with A/B comparison, over the REAL sidecar.
 *
 * Why this exists: the ask/compose paths assemble their model prompts from many
 * conditional directives, and a change to one (web gating, a provenance line, a
 * recipe) can silently regress another. `eval-server.mjs` checks breadth once;
 * this suite is built to be run TWICE — against a baseline build and a candidate
 * build — and DIFFED, so a change proves it neither broke behaviour nor cost
 * throughput before it merges.
 *
 * Two kinds of signal per case:
 *  - INVARIANTS: structural pass/fail robust to LLM wording (card created, run
 *    finished, no SOURCES_USED marker leaked, ≥N task lines, columns present).
 *    A baseline-pass that turns candidate-fail is a REGRESSION.
 *  - RECORDED VALUES (meta): routing decisions, provenance indices, counts. Not
 *    pass/fail — the compare prints how they moved (e.g. shape router table→doc),
 *    so drift surfaces without false alarms from ordinary variance.
 *  - PERFORMANCE: total wall-clock + time-to-first-event per case; the compare
 *    reports per-case and aggregate p50/p90 deltas.
 *
 * Usage (server up in sidecar mode):
 *   node scripts/eval-regression.mjs --out <file.json> [--label NAME]
 *   node scripts/eval-regression.mjs --compare <baseline.json> <candidate.json>
 * Env: JZ_BASE (default http://localhost:3001), JZ_CONC (default 4),
 *      JZ_ONLY=group,group  to filter.
 */

import fs from 'node:fs';

const BASE = process.env.JZ_BASE || 'http://localhost:3001';
const CONCURRENCY = Number(process.env.JZ_CONC || 4);
const ONLY = (process.env.JZ_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

/* ── transport ─────────────────────────────────────────────────────────────── */

async function post(path, body, { sse = false, timeoutMs = 150_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  let ttfb = null;
  try {
    const res = await fetch(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!sse) {
      const json = await res.json().catch(() => null);
      const ms = Date.now() - started;
      return { status: res.status, json, events: [], ms, ttfbMs: ms };
    }
    const events = [];
    if (res.body) {
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
          if (!line.startsWith('data:')) continue;
          if (ttfb === null) ttfb = Date.now() - started;
          try {
            const e = JSON.parse(line.slice(line.indexOf(':') + 1).trim());
            events.push(e);
            if (e.type === 'done' || e.type === 'error') break outer;
          } catch { /* partial frame */ }
        }
      }
    }
    return { status: res.status, json: null, events, ms: Date.now() - started, ttfbMs: ttfb ?? (Date.now() - started) };
  } catch (e) {
    return { status: 0, json: null, events: [], ms: Date.now() - started, ttfbMs: null, error: String(e).slice(0, 140) };
  } finally {
    clearTimeout(t);
  }
}

async function get(path) {
  const started = Date.now();
  try {
    const r = await fetch(BASE + path);
    const json = await r.json().catch(() => null);
    const ms = Date.now() - started;
    return { status: r.status, json, events: [], ms, ttfbMs: ms };
  } catch (e) {
    return { status: 0, json: null, events: [], ms: Date.now() - started, ttfbMs: null, error: String(e) };
  }
}

/* ── event helpers ─────────────────────────────────────────────────────────── */

const askText = (evs) => evs.filter((e) => e.type === 'card.delta').map((e) => e.textDelta).join('');
const slotText = (evs, slot) => evs.filter((e) => e.type === 'slot' && e.slot === slot && e.event?.type === 'card.delta').map((e) => e.event.textDelta).join('');
const created = (evs) => evs.find((e) => e.type === 'card.create');
const finished = (evs) => evs.some((e) => e.type === 'done');
const errored = (evs) => evs.find((e) => e.type === 'error');
const usedSources = (evs) => (evs.find((e) => e.type === 'sources.used')?.indices) ?? null;
const taskLines = (t) => t.split('\n').filter((l) => /^- \[[ x]\]/i.test(l.trim())).length;
const MARKER = /SOURCES_USED/i;
const SOURCE_CITE = /^\s*Source:\s*\[/im;
const IMG_MD = /!\[[^\]]*\]\([^)]+\)/;

/* ── cases ─────────────────────────────────────────────────────────────────── */

const TRANSCRIPT = `Product sync — Onboarding revamp (Jul 9)
Priya (PM): Activation stuck at 22%; drop-off is the empty workspace screen.
Marco (Eng): Static picker is one week; animated build three.
Priya: Decision — picker ships October, animated build November. Marco specs the data model this week.
Dev (Design): Categories should be use-case based. I need the voice guide updated first.
Priya: I'll chase brand for the voice guide by Friday. Dev drafts templates by July 23.
Marco: Open question — do we localize at launch? 48 pieces of content.
Priya: English-only October, localized November. Next sync next week.`;

const NOTE = { kind: 'note', title: 'Notes', text: TRANSCRIPT };

const CASES = [
  // ── fast / platform ──
  { id: 'health', group: 'platform', llm: false, exec: () => get('/api/health'),
    inv: (r) => [['200 + ok', r.status === 200 && r.json?.ok === true]] },
  { id: 'capabilities', group: 'platform', llm: false, exec: () => get('/api/capabilities'),
    inv: (r) => [['live sidecar/api', r.status === 200 && r.json?.live === true && ['sidecar', 'api'].includes(r.json?.mode)]],
    meta: (r) => ({ mode: r.json?.mode }) },
  { id: 'ask-validation-400', group: 'platform', llm: false, exec: () => post('/api/ask', {}),
    inv: (r) => [['rejects empty prompt', r.status === 400]] },
  { id: 'link-preview-invalid', group: 'platform', llm: false, exec: () => post('/api/link/preview', { url: 'not-a-url' }),
    inv: (r) => [['rejects bad url', r.status >= 400]] },
  { id: 'link-preview-ssrf', group: 'platform', llm: false, exec: () => post('/api/link/preview', { url: 'http://169.254.169.254/latest/meta-data/' }),
    inv: (r) => [['blocks link-local SSRF', r.status >= 400 || Boolean(r.json?.error) || !r.json?.text]] },

  // ── routers (fast JSON; value recorded for drift, invariant only asserts validity) ──
  { id: 'intent-edit', group: 'router', llm: false, exec: () => post('/api/intent', { prompt: 'make it shorter', cardType: 'doc-card' }),
    inv: (r) => [['valid intent', ['edit', 'new'].includes(r.json?.intent)]], meta: (r) => ({ intent: r.json?.intent }) },
  { id: 'intent-new', group: 'router', llm: false, exec: () => post('/api/intent', { prompt: 'now write a press release from this', cardType: 'doc-card' }),
    inv: (r) => [['valid intent', ['edit', 'new'].includes(r.json?.intent)]], meta: (r) => ({ intent: r.json?.intent }) },
  { id: 'shape-table', group: 'router', llm: false, exec: () => post('/api/suggest-shape', { prompt: 'Compare Notion, Linear and Asana for a small team' }),
    inv: (r) => [['returns a value', r.status === 200]], meta: (r) => ({ shape: r.json?.shape }) },
  { id: 'shape-diagram', group: 'router', llm: false, exec: () => post('/api/suggest-shape', { prompt: 'Map the onboarding flow end to end' }),
    inv: (r) => [['returns a value', r.status === 200]], meta: (r) => ({ shape: r.json?.shape }) },

  // ── ask router: every response shape ──
  { id: 'ask-doc', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'In two sentences, what are OKRs?', sources: [], skipClarify: true }, { sse: true }),
    inv: (r) => [['doc created', created(r.events)?.shape === 'doc'], ['streamed + done', askText(r.events).length > 40 && finished(r.events)], ['no marker leak', !MARKER.test(askText(r.events))]] },
  { id: 'ask-doc-source', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'Summarize these notes in three sentences.', sources: [NOTE], skipClarify: true }, { sse: true }),
    inv: (r) => [['done', finished(r.events)], ['provenance fired', Array.isArray(usedSources(r.events))], ['no marker leak', !MARKER.test(askText(r.events))]],
    meta: (r) => ({ usedSources: usedSources(r.events) }) },
  { id: 'ask-list', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'List five benefits of spaced repetition.', sources: [], shape: 'list', skipClarify: true }, { sse: true }),
    inv: (r) => [['≥3 bullets', askText(r.events).split('\n').filter((l) => /^[-*\d]/.test(l.trim())).length >= 3], ['done', finished(r.events)]] },
  // THE CONFLICT CASE — checklist + source: the reworded CHECKLIST/SOURCES_USED must compose.
  { id: 'ask-checklist-source', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'List the action items from these notes as a checklist with owners.', sources: [NOTE], shape: 'list', skipClarify: true }, { sse: true }),
    inv: (r) => {
      const t = askText(r.events);
      return [['≥2 task lines', taskLines(t) >= 2], ['no marker leak', !MARKER.test(t)], ['ends clean (task/blank, not prose)', /(\[[ x]\][^\n]*|)\s*$/.test(t.trimEnd().split('\n').pop() ?? '') && !/^(in summary|overall|note:|to summar)/i.test((t.trimEnd().split('\n').pop() ?? '').trim())], ['provenance fired', Array.isArray(usedSources(r.events))], ['done', finished(r.events)]];
    },
    meta: (r) => ({ tasks: taskLines(askText(r.events)), usedSources: usedSources(r.events) }) },
  { id: 'ask-table', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'Compare three note-taking apps on price, platforms, and best-for.', sources: [], shape: 'table', skipClarify: true }, { sse: true }),
    inv: (r) => { const c = created(r.events); return [['table w/ ≥2 cols', c?.shape === 'table' && (c.columns?.length ?? 0) >= 2], ['cells filled', r.events.filter((e) => e.type === 'table.cell').length > 0], ['done', finished(r.events)]]; },
    meta: (r) => ({ cols: created(r.events)?.columns?.length ?? 0 }) },
  { id: 'ask-diagram', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'Diagram the water cycle.', sources: [], shape: 'diagram', skipClarify: true }, { sse: true }),
    inv: (r) => { const t = askText(r.events); return [['diagram created', created(r.events)?.shape === 'diagram'], ['mermaid source', /\b(flowchart|graph|sequenceDiagram|mindmap|stateDiagram|erDiagram|timeline)\b/i.test(t)], ['done', finished(r.events)]]; } },
  { id: 'ask-prototype', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'A clean login screen.', sources: [], shape: 'prototype', skipClarify: true }, { sse: true, timeoutMs: 180_000 }),
    inv: (r) => { const t = askText(r.events); return [['prototype created', created(r.events)?.shape === 'prototype'], ['html emitted', /<[a-z!]/i.test(t)], ['done', finished(r.events)]]; } },
  { id: 'ask-dashboard', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'A sales KPI dashboard for Q3.', sources: [], shape: 'dashboard', skipClarify: true }, { sse: true, timeoutMs: 180_000 }),
    inv: (r) => [['dashboard created', created(r.events)?.shape === 'dashboard'], ['spec streamed', askText(r.events).length > 20], ['done', finished(r.events)]] },
  { id: 'ask-affinity', group: 'ask', llm: true, exec: () => post('/api/ask', { prompt: 'Brainstorm angles for a habit-tracking app.', sources: [], shape: 'affinity', skipClarify: true }, { sse: true }),
    inv: (r) => [['≥2 clusters', r.events.filter((e) => e.type === 'affinity.cluster').length >= 2], ['notes emitted', r.events.filter((e) => e.type === 'affinity.note').length > 0], ['done', finished(r.events)]] },

  // ── compose + the noWeb debrief (core regression target) ──
  { id: 'compose-board', group: 'compose', llm: true, exec: () => post('/api/compose', { board: [{ kind: 'note', title: 'Trip', text: 'A budget-conscious weekend in Goa.' }], intent: 'Plan my Goa weekend' }, { sse: true, timeoutMs: 180_000 }),
    inv: (r) => { const plan = r.events.find((e) => e.type === 'plan'); const cards = r.events.filter((e) => e.type === 'slot' && e.event?.type === 'card.create').length; return [['planned 3–6 cards', (plan?.cards?.length ?? 0) >= 3], ['built ≥1 card', cards >= 1], ['done', finished(r.events)]]; },
    meta: (r) => ({ planned: r.events.find((e) => e.type === 'plan')?.cards?.length ?? 0 }) },
  { id: 'compose-debrief', group: 'compose', llm: true, exec: () => post('/api/compose', { board: [], recipe: 'debrief', intent: 'Debrief this meeting', transcript: { title: 'Product sync', text: TRANSCRIPT } }, { sse: true, timeoutMs: 200_000 }),
    inv: (r) => {
      const plan = r.events.find((e) => e.type === 'plan');
      const titles = (plan?.cards ?? []).map((c) => c.title);
      const t0 = slotText(r.events, 0), t1 = slotText(r.events, 1), t2 = slotText(r.events, 2);
      const all = [t0, t1, t2];
      return [
        ['3-card plan', (plan?.cards?.length ?? 0) === 3],
        ['titles = decisions/actions/risks', /decision/i.test(titles[0] ?? '') && /action/i.test(titles[1] ?? '') && /risk/i.test(titles[2] ?? '')],
        ['all three cards produced text', all.every((t) => t.length > 20)],
        ['action items ≥2 tasks', taskLines(t1) >= 2],
        ['no web images (extractive)', !all.some((t) => IMG_MD.test(t))],
        ['no Source: citation lines', !all.some((t) => SOURCE_CITE.test(t))],
        ['no marker leak', !all.some((t) => MARKER.test(t))],
        ['done', finished(r.events)],
      ];
    },
    meta: (r) => ({ tasks: taskLines(slotText(r.events, 1)) }) },

  // ── autopilot ──
  { id: 'autopilot-prose', group: 'autopilot', llm: true, exec: () => post('/api/autopilot', { kind: 'doc', title: 'Spaced repetition', text: 'Spaced repetition works because' }, { sse: true }),
    inv: (r) => [['≥1 delta', r.events.filter((e) => e.type === 'delta').length >= 1], ['done', finished(r.events)]] },
  { id: 'autopilot-table', group: 'autopilot', llm: true, exec: () => post('/api/autopilot/table', { columns: ['App', 'Price', 'Platforms'], rows: [['Notion', '', ''], ['Linear', '', '']] }, { sse: true }),
    inv: (r) => [['≥1 cell filled', r.events.filter((e) => e.type === 'cell').length >= 1], ['done', finished(r.events)]] },

  // ── analyze ──
  { id: 'analyze-tensions', group: 'analyze', llm: true, exec: () => post('/api/analyze', { mode: 'tensions', cards: [{ kind: 'doc', title: 'Plan A', text: 'Ship October, no localization to stay lean.' }, { kind: 'doc', title: 'Plan B', text: 'Localize into 8 languages for the October launch.' }] }, { sse: true, timeoutMs: 180_000 }),
    inv: (r) => [['card created', Boolean(created(r.events))], ['streamed + done', askText(r.events).length > 40 && finished(r.events)]] },
  { id: 'analyze-gaps', group: 'analyze', llm: true, exec: () => post('/api/analyze', { mode: 'gaps', cards: [{ kind: 'doc', title: 'Launch', text: 'Ship the onboarding revamp in October.' }] }, { sse: true, timeoutMs: 180_000 }),
    inv: (r) => [['streamed + done', askText(r.events).length > 40 && finished(r.events)]] },

  // ── seed prompts ──
  { id: 'seed-text', group: 'seed', llm: true, exec: () => post('/api/seed-prompts', { text: TRANSCRIPT, title: 'Product sync' }),
    inv: (r) => [['3–4 prompts', Array.isArray(r.json?.prompts) && r.json.prompts.length >= 3 && r.json.prompts.length <= 4], ['each has label+prompt', (r.json?.prompts ?? []).every((p) => p.label && p.prompt)]],
    meta: (r) => ({ n: r.json?.prompts?.length ?? 0 }) },
];

/* ── runner ────────────────────────────────────────────────────────────────── */

async function runPool(items, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function runSuite(label) {
  const cases = CASES.filter((c) => ONLY.length === 0 || ONLY.includes(c.group));
  console.log(`\n▶ ${label}: ${cases.length} cases, concurrency ${CONCURRENCY}\n`);
  const started = Date.now();
  const records = await runPool(cases, async (c) => {
    let r;
    try { r = await c.exec(); } catch (e) { r = { status: 0, events: [], json: null, ms: 0, ttfbMs: null, error: String(e) }; }
    let invariants = [];
    try { invariants = c.inv(r).map(([name, ok]) => ({ name, ok: Boolean(ok) })); }
    catch (e) { invariants = [{ name: 'invariant-threw', ok: false, detail: String(e).slice(0, 80) }]; }
    const meta = c.meta ? (() => { try { return c.meta(r); } catch { return {}; } })() : {};
    const ok = invariants.every((x) => x.ok) && !r.error;
    const line = `${ok ? '✅' : '❌'} ${c.id.padEnd(24)} ${String(Math.round(r.ms)).padStart(6)}ms  ${invariants.filter((x) => x.ok).length}/${invariants.length}${r.error ? '  ERR ' + r.error : ''}`;
    console.log(line);
    if (!ok) for (const x of invariants.filter((x) => !x.ok)) console.log(`      ✗ ${x.name}`);
    return { id: c.id, group: c.group, llm: Boolean(c.llm), status: r.status, ms: r.ms, ttfbMs: r.ttfbMs, ok, invariants, meta };
  });
  const llm = records.filter((r) => r.llm);
  const snapshot = {
    label, startedAt: new Date(started).toISOString(), wallMs: Date.now() - started,
    cases: records,
    summary: {
      pass: records.filter((r) => r.ok).length, total: records.length,
      llmLatency: { p50: pct(llm.map((r) => r.ms), 50), p90: pct(llm.map((r) => r.ms), 90), max: Math.max(0, ...llm.map((r) => r.ms)) },
      ttfb: { p50: pct(llm.map((r) => r.ttfbMs ?? 0), 50), p90: pct(llm.map((r) => r.ttfbMs ?? 0), 90) },
    },
  };
  console.log(`\n  ${snapshot.summary.pass}/${snapshot.summary.total} passed · LLM latency p50 ${snapshot.summary.llmLatency.p50}ms p90 ${snapshot.summary.llmLatency.p90}ms · ttfb p50 ${snapshot.summary.ttfb.p50}ms · wall ${Math.round(snapshot.wallMs / 1000)}s`);
  return snapshot;
}

/* ── compare ───────────────────────────────────────────────────────────────── */

function compare(basePath, candPath) {
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
  const byId = (s) => Object.fromEntries(s.cases.map((c) => [c.id, c]));
  const B = byId(base), C = byId(cand);
  const ids = [...new Set([...Object.keys(B), ...Object.keys(C)])];

  const regressions = [], fixes = [], metaChanges = [], perf = [];
  for (const id of ids) {
    const b = B[id], c = C[id];
    if (!b || !c) { metaChanges.push(`${id}: only in ${b ? 'baseline' : 'candidate'}`); continue; }
    const bi = Object.fromEntries(b.invariants.map((x) => [x.name, x.ok]));
    const ci = Object.fromEntries(c.invariants.map((x) => [x.name, x.ok]));
    for (const name of new Set([...Object.keys(bi), ...Object.keys(ci)])) {
      if (bi[name] === true && ci[name] === false) regressions.push(`${id} › ${name}`);
      if (bi[name] === false && ci[name] === true) fixes.push(`${id} › ${name}`);
    }
    const bm = JSON.stringify(b.meta ?? {}), cm = JSON.stringify(c.meta ?? {});
    if (bm !== cm) metaChanges.push(`${id}: ${bm} → ${cm}`);
    if (b.llm && c.llm && b.ms && c.ms) {
      const dMs = c.ms - b.ms, dPct = Math.round((dMs / b.ms) * 100);
      perf.push({ id, base: b.ms, cand: c.ms, dMs, dPct });
    }
  }

  const line = '─'.repeat(64);
  console.log(`\n${line}\nA/B COMPARISON  baseline=${base.label}  candidate=${cand.label}\n${line}`);
  console.log(`pass: ${base.summary.pass}/${base.summary.total}  →  ${cand.summary.pass}/${cand.summary.total}`);
  console.log(`\nREGRESSIONS (baseline-pass → candidate-fail): ${regressions.length}`);
  for (const r of regressions) console.log(`  🔴 ${r}`);
  console.log(`\nFIXES (baseline-fail → candidate-pass): ${fixes.length}`);
  for (const f of fixes) console.log(`  🟢 ${f}`);
  console.log(`\nRECORDED-VALUE / COVERAGE CHANGES: ${metaChanges.length}`);
  for (const m of metaChanges) console.log(`  • ${m}`);

  const L = (s) => s.llmLatency;
  console.log(`\nPERFORMANCE (LLM cases)`);
  console.log(`  p50 ${L(base.summary).p50}ms → ${L(cand.summary).p50}ms (${signed(L(cand.summary).p50 - L(base.summary).p50)}ms)`);
  console.log(`  p90 ${L(base.summary).p90}ms → ${L(cand.summary).p90}ms (${signed(L(cand.summary).p90 - L(base.summary).p90)}ms)`);
  console.log(`  ttfb p50 ${base.summary.ttfb.p50}ms → ${cand.summary.ttfb.p50}ms (${signed(cand.summary.ttfb.p50 - base.summary.ttfb.p50)}ms)`);
  const notable = perf.filter((p) => Math.abs(p.dMs) >= 2000 && Math.abs(p.dPct) >= 20).sort((a, b) => a.dMs - b.dMs);
  if (notable.length) {
    console.log(`\n  Notable per-case shifts (≥2s and ≥20%; sidecar latency is noisy):`);
    for (const p of notable) console.log(`    ${p.dMs < 0 ? '⚡' : '🐌'} ${p.id.padEnd(24)} ${p.base}ms → ${p.cand}ms (${signed(p.dPct)}%)`);
  }
  console.log(`\n${line}`);
  const verdict = regressions.length === 0 ? '✅ NO REGRESSIONS' : `🔴 ${regressions.length} REGRESSION(S)`;
  console.log(`VERDICT: ${verdict}\n${line}`);
  return regressions.length === 0;
}
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/* ── cli ───────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const ok = compare(args[1], args[2]);
  process.exit(ok ? 0 : 1);
} else {
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  const labelIdx = args.indexOf('--label');
  const label = labelIdx >= 0 ? args[labelIdx + 1] : 'run';
  const snap = await runSuite(label);
  if (out) { fs.writeFileSync(out, JSON.stringify(snap, null, 2)); console.log(`\nwrote ${out}`); }
}
