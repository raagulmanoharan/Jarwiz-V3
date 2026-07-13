/**
 * Response-quality regression harness with A/B comparison, over the REAL sidecar.
 *
 * Why this exists: the ask/compose paths assemble their model prompts from many
 * conditional directives, and a change to one (web gating, a provenance line, a
 * recipe) can silently degrade another. This suite is built to run TWICE —
 * against a baseline build and a candidate build — and DIFF, so a change proves
 * it didn't lower output quality before it merges.
 *
 * What it measures — QUALITY, not speed. The CLI sidecar's wall-clock is
 * process-spawn overhead: inherently noisy and NOT a signal about a prompt
 * change. So latency is recorded but informational only; it never gates a case
 * and never drives the verdict. Each case is graded on:
 *   - mustPass checks (0/1): format + contamination gates — checklist is
 *     well-formed, no SOURCES_USED marker leaks, no spurious web citation/image
 *     on an extractive card. A must-pass miss fails that repeat outright.
 *   - graded checks (0..1): GROUNDING — the fraction of the source's real
 *     entities/facts (owners, dates, decisions) the answer actually carries —
 *     and provenance correctness.
 *
 * The model is stochastic, so quality is SAMPLED: quality-critical cases run
 * `repeats` times and report a quality score (mean graded) + hard-pass rate
 * (fraction of repeats passing every gate). One unlucky sample can't flip a
 * verdict. The A/B flags a case only when the candidate's hard-pass rate drops
 * or its quality falls by more than TOL.
 *
 * Usage (server up in sidecar mode):
 *   node scripts/eval-regression.mjs --out <file.json> [--label NAME]
 *   node scripts/eval-regression.mjs --compare <baseline.json> <candidate.json>
 * Env: JZ_BASE (default http://localhost:3001), JZ_CONC (default 2),
 *      JZ_REPEATS (default 3, quality cases), JZ_ONLY=group,group to filter.
 */

import fs from 'node:fs';

const BASE = process.env.JZ_BASE || 'http://localhost:3001';
const CONCURRENCY = Number(process.env.JZ_CONC || 2);
const REPEATS = Number(process.env.JZ_REPEATS || 3);
const ONLY = (process.env.JZ_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const QUALITY_TOL = 0.1; // a quality drop beyond this is a regression

/* ── transport ─────────────────────────────────────────────────────────────── */

async function post(path, body, { sse = false, timeoutMs = 150_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!sse) {
      const json = await res.json().catch(() => null);
      return { status: res.status, json, events: [], ms: Date.now() - started };
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
          try {
            const e = JSON.parse(line.slice(line.indexOf(':') + 1).trim());
            events.push(e);
            if (e.type === 'done' || e.type === 'error') break outer;
          } catch { /* partial frame */ }
        }
      }
    }
    return { status: res.status, json: null, events, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, json: null, events: [], ms: Date.now() - started, error: String(e).slice(0, 140) };
  } finally {
    clearTimeout(t);
  }
}

async function get(path) {
  const started = Date.now();
  try {
    const r = await fetch(BASE + path);
    const json = await r.json().catch(() => null);
    return { status: r.status, json, events: [], ms: Date.now() - started };
  } catch (e) {
    return { status: 0, json: null, events: [], ms: Date.now() - started, error: String(e) };
  }
}

/* ── event + quality helpers ───────────────────────────────────────────────── */

const askText = (evs) => evs.filter((e) => e.type === 'card.delta').map((e) => e.textDelta).join('');
const deltaText = (evs) => evs.filter((e) => e.type === 'delta').map((e) => e.textDelta).join('');
const slotText = (evs, slot) => evs.filter((e) => e.type === 'slot' && e.slot === slot && e.event?.type === 'card.delta').map((e) => e.event.textDelta).join('');
const created = (evs) => evs.find((e) => e.type === 'card.create');
const finished = (evs) => evs.some((e) => e.type === 'done');
const usedSources = (evs) => (evs.find((e) => e.type === 'sources.used')?.indices) ?? null;
const taskLines = (t) => t.split('\n').filter((l) => /^- \[[ x]\]/i.test(l.trim())).length;
const bulletLines = (t) => t.split('\n').filter((l) => /^[-*\d]/.test(l.trim())).length;

const MARKER = /SOURCES_USED/i;
const SOURCE_CITE = /(^|\n)\s*Source:\s*\[/i;
const IMG_MD = /!\[[^\]]*\]\([^)]+\)/;

/** Graded grounding: fraction of expected entities the text actually carries. */
const coverage = (text, terms) => {
  const t = text.toLowerCase();
  const hits = terms.filter((k) => t.includes(k.toLowerCase())).length;
  return terms.length ? hits / terms.length : 1;
};
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// check builders
const must = (name, ok) => ({ name, score: ok ? 1 : 0, mustPass: true });
const grade = (name, score) => ({ name, score: Math.max(0, Math.min(1, score)), mustPass: false });

/* ── the material under test ───────────────────────────────────────────────── */

const TRANSCRIPT = `Product sync — Onboarding revamp (Jul 9)
Priya (PM): Activation stuck at 22%; drop-off is the empty workspace screen.
Marco (Eng): Static picker is one week; animated build three.
Priya: Decision — picker ships October, animated build November. Marco specs the data model this week.
Dev (Design): Categories should be use-case based. I need the voice guide updated first.
Priya: I'll chase brand for the voice guide by Friday. Dev drafts templates by July 23.
Marco: Open question — do we localize at launch? 48 pieces of content.
Priya: English-only October, localized November. Next sync next week.`;
const NOTE = { kind: 'note', title: 'Product sync', text: TRANSCRIPT };
const OWNERS = ['Priya', 'Marco', 'Dev'];

/* ── cases ─────────────────────────────────────────────────────────────────── */

const CASES = [
  // ── platform / guards (deterministic; single sample) ──
  { id: 'health', group: 'platform', repeats: 1, exec: () => get('/api/health'),
    q: (r) => [must('200 + ok', r.status === 200 && r.json?.ok === true)] },
  { id: 'capabilities', group: 'platform', repeats: 1, exec: () => get('/api/capabilities'),
    q: (r) => [must('live sidecar/api', r.status === 200 && r.json?.live === true && ['sidecar', 'api'].includes(r.json?.mode))], meta: (r) => ({ mode: r.json?.mode }) },
  { id: 'ask-validation-400', group: 'platform', repeats: 1, exec: () => post('/api/ask', {}),
    q: (r) => [must('rejects empty prompt', r.status === 400)] },
  { id: 'link-preview-invalid', group: 'platform', repeats: 1, exec: () => post('/api/link/preview', { url: 'not-a-url' }),
    q: (r) => [must('rejects bad url', r.status >= 400)] },
  { id: 'link-preview-ssrf', group: 'platform', repeats: 1, exec: () => post('/api/link/preview', { url: 'http://169.254.169.254/latest/meta-data/' }),
    q: (r) => [must('blocks link-local SSRF', r.status >= 400 || Boolean(r.json?.error) || !r.json?.text)] },

  // ── routers (recorded value; correctness sampled lightly) ──
  { id: 'intent-edit', group: 'router', repeats: 2, exec: () => post('/api/intent', { prompt: 'make it shorter', cardType: 'doc-card' }),
    q: (r) => [must('valid intent', ['edit', 'new'].includes(r.json?.intent)), grade('classified EDIT', r.json?.intent === 'edit' ? 1 : 0)], meta: (r) => ({ intent: r.json?.intent }) },
  { id: 'intent-new', group: 'router', repeats: 2, exec: () => post('/api/intent', { prompt: 'now write a press release from this', cardType: 'doc-card' }),
    q: (r) => [must('valid intent', ['edit', 'new'].includes(r.json?.intent)), grade('classified NEW', r.json?.intent === 'new' ? 1 : 0)], meta: (r) => ({ intent: r.json?.intent }) },
  { id: 'shape-table', group: 'router', repeats: 2, exec: () => post('/api/suggest-shape', { prompt: 'Compare Notion, Linear and Asana for a small team' }),
    q: (r) => [must('responds 200', r.status === 200), grade('suggests table', r.json?.shape === 'table' ? 1 : 0)], meta: (r) => ({ shape: r.json?.shape }) },
  { id: 'shape-diagram', group: 'router', repeats: 2, exec: () => post('/api/suggest-shape', { prompt: 'Map the onboarding flow end to end' }),
    q: (r) => [must('responds 200', r.status === 200), grade('suggests diagram', r.json?.shape === 'diagram' ? 1 : 0)], meta: (r) => ({ shape: r.json?.shape }) },

  // ── ask router: shape/format smoke (single sample; format-bound) ──
  { id: 'ask-doc', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'In two sentences, what are OKRs?', sources: [], skipClarify: true }, { sse: true }),
    q: (r) => { const t = askText(r.events); return [must('doc created', created(r.events)?.shape === 'doc'), must('done', finished(r.events)), must('no marker leak', !MARKER.test(t)), grade('substantive', t.length > 80 ? 1 : t.length / 80)]; } },
  { id: 'ask-list', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'List five benefits of spaced repetition.', sources: [], shape: 'list', skipClarify: true }, { sse: true }),
    q: (r) => { const t = askText(r.events); return [must('done', finished(r.events)), grade('≥5 bullets', Math.min(1, bulletLines(t) / 5))]; } },
  { id: 'ask-table', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'Compare three note-taking apps on price, platforms, and best-for.', sources: [], shape: 'table', skipClarify: true }, { sse: true }),
    q: (r) => { const c = created(r.events); const cells = r.events.filter((e) => e.type === 'table.cell').length; return [must('table ≥3 cols', c?.shape === 'table' && (c.columns?.length ?? 0) >= 3), must('done', finished(r.events)), grade('grid filled', Math.min(1, cells / 6))]; }, meta: (r) => ({ cols: created(r.events)?.columns?.length ?? 0 }) },
  { id: 'ask-diagram', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'Diagram the water cycle.', sources: [], shape: 'diagram', skipClarify: true }, { sse: true }),
    q: (r) => { const t = askText(r.events); return [must('diagram created', created(r.events)?.shape === 'diagram'), must('valid mermaid header', /\b(flowchart|graph|sequenceDiagram|mindmap|stateDiagram|erDiagram|timeline)\b/i.test(t)), must('done', finished(r.events))]; } },
  { id: 'ask-prototype', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'A clean login screen.', sources: [], shape: 'prototype', skipClarify: true }, { sse: true, timeoutMs: 180_000 }),
    q: (r) => { const t = askText(r.events); return [must('prototype created', created(r.events)?.shape === 'prototype'), must('emits html doc', /<!doctype html|<html|<div|<form/i.test(t)), must('done', finished(r.events))]; } },
  { id: 'ask-dashboard', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'A sales KPI dashboard for Q3.', sources: [], shape: 'dashboard', skipClarify: true }, { sse: true, timeoutMs: 180_000 }),
    q: (r) => [must('dashboard created', created(r.events)?.shape === 'dashboard'), must('spec streamed', askText(r.events).length > 20), must('done', finished(r.events))] },
  { id: 'ask-affinity', group: 'ask', repeats: 1, exec: () => post('/api/ask', { prompt: 'Brainstorm angles for a habit-tracking app.', sources: [], shape: 'affinity', skipClarify: true }, { sse: true }),
    q: (r) => [must('≥2 clusters', r.events.filter((e) => e.type === 'affinity.cluster').length >= 2), must('notes emitted', r.events.filter((e) => e.type === 'affinity.note').length > 0), must('done', finished(r.events))] },

  // ── QUALITY-CRITICAL: grounding, provenance, the reworked conflict (sampled) ──
  { id: 'ask-doc-source', group: 'quality', repeats: REPEATS, exec: () => post('/api/ask', { prompt: 'Summarize these notes in three sentences.', sources: [NOTE], skipClarify: true }, { sse: true }),
    q: (r) => { const t = askText(r.events); return [
      must('done', finished(r.events)),
      must('no marker leak', !MARKER.test(t)),
      must('provenance fired', Array.isArray(usedSources(r.events))),
      grade('provenance = [1]', eqArr(usedSources(r.events), [1]) ? 1 : 0),
      grade('grounds the timeline', coverage(t, ['October', 'November'])),
    ]; }, meta: (r) => ({ usedSources: usedSources(r.events) }) },

  // The reworked CHECKLIST ↔ SOURCES_USED conflict must compose AND stay faithful.
  { id: 'ask-checklist-source', group: 'quality', repeats: REPEATS, exec: () => post('/api/ask', { prompt: 'List the action items from these notes as a checklist with owners.', sources: [NOTE], shape: 'list', skipClarify: true }, { sse: true }),
    q: (r) => { const t = askText(r.events); const last = (t.trimEnd().split('\n').pop() ?? '').trim(); return [
      must('done', finished(r.events)),
      must('≥3 task lines', taskLines(t) >= 3),
      must('no marker leak', !MARKER.test(t)),
      must('ends clean (no prose sign-off)', !/^(in summary|overall|note:|to summar|these |the above)/i.test(last)),
      must('provenance fired', Array.isArray(usedSources(r.events))),
      grade('grounds owners', coverage(t, OWNERS)),
      grade('grounds dates', coverage(t, ['Friday', 'July 23'])),
    ]; }, meta: (r) => ({ tasks: taskLines(askText(r.events)), usedSources: usedSources(r.events) }) },

  // NEGATIVE provenance: attach a source, ask something unrelated → no lineage.
  { id: 'provenance-negative', group: 'quality', repeats: REPEATS, exec: () => post('/api/ask', { prompt: 'In two sentences, what is the difference between OKRs and KPIs?', sources: [NOTE], skipClarify: true }, { sse: true }),
    q: (r) => { const u = usedSources(r.events); return [
      must('done', finished(r.events)),
      must('no marker leak', !MARKER.test(askText(r.events))),
      grade('claims NO source (attached ≠ used)', u === null || (Array.isArray(u) && u.length === 0) ? 1 : 0),
    ]; }, meta: (r) => ({ usedSources: usedSources(r.events) }) },

  // The debrief recipe — the noWeb extractive path — graded on faithfulness.
  { id: 'compose-debrief', group: 'quality', repeats: REPEATS, exec: () => post('/api/compose', { board: [], recipe: 'debrief', intent: 'Debrief this meeting', transcript: { title: 'Product sync', text: TRANSCRIPT } }, { sse: true, timeoutMs: 200_000 }),
    q: (r) => {
      const plan = r.events.find((e) => e.type === 'plan');
      const titles = (plan?.cards ?? []).map((c) => c.title);
      const t0 = slotText(r.events, 0), t1 = slotText(r.events, 1), t2 = slotText(r.events, 2);
      const all = [t0, t1, t2];
      return [
        must('done', finished(r.events)),
        must('3-card plan', (plan?.cards?.length ?? 0) === 3),
        must('titled decisions/actions/risks', /decision/i.test(titles[0] ?? '') && /action/i.test(titles[1] ?? '') && /risk/i.test(titles[2] ?? '')),
        must('all three cards produced text', all.every((t) => t.length > 20)),
        must('action items ≥3 tasks', taskLines(t1) >= 3),
        must('no marker leak', !all.some((t) => MARKER.test(t))),
        must('no web image (extractive)', !all.some((t) => IMG_MD.test(t))),
        must('no Source: citation (extractive)', !all.some((t) => SOURCE_CITE.test(t))),
        grade('decisions grounded', coverage(t0, ['October', 'November'])),
        grade('actions carry owners', coverage(t1, OWNERS)),
        grade('risks catch localization', coverage(t2, ['localiz'])),
      ];
    }, meta: (r) => ({ tasks: taskLines(slotText(r.events, 1)) }) },

  // ── compose board fan-out (format smoke) ──
  { id: 'compose-board', group: 'compose', repeats: 1, exec: () => post('/api/compose', { board: [{ kind: 'note', title: 'Trip', text: 'A budget-conscious weekend in Goa.' }], intent: 'Plan my Goa weekend' }, { sse: true, timeoutMs: 180_000 }),
    q: (r) => { const plan = r.events.find((e) => e.type === 'plan'); const cards = r.events.filter((e) => e.type === 'slot' && e.event?.type === 'card.create').length; return [must('planned 3–6 cards', (plan?.cards?.length ?? 0) >= 3), must('built ≥1 card', cards >= 1), must('done', finished(r.events))]; }, meta: (r) => ({ planned: r.events.find((e) => e.type === 'plan')?.cards?.length ?? 0 }) },

  // ── autopilot ──
  { id: 'autopilot-prose', group: 'autopilot', repeats: 1, exec: () => post('/api/autopilot', { kind: 'doc', title: 'Spaced repetition', text: 'Spaced repetition works because' }, { sse: true }),
    q: (r) => [must('≥1 delta', r.events.filter((e) => e.type === 'delta').length >= 1), must('done', finished(r.events)), grade('substantive continuation', Math.min(1, deltaText(r.events).length / 60))] },
  { id: 'autopilot-table', group: 'autopilot', repeats: 1, exec: () => post('/api/autopilot/table', { columns: ['App', 'Price', 'Platforms'], rows: [['Notion', '', ''], ['Linear', '', '']] }, { sse: true }),
    q: (r) => [must('≥1 cell filled', r.events.filter((e) => e.type === 'cell').length >= 1), must('done', finished(r.events))] },

  // ── analyze ──
  { id: 'analyze-tensions', group: 'analyze', repeats: 1, exec: () => post('/api/analyze', { mode: 'tensions', cards: [{ kind: 'doc', title: 'Plan A', text: 'Ship October, no localization to stay lean.' }, { kind: 'doc', title: 'Plan B', text: 'Localize into 8 languages for the October launch.' }] }, { sse: true, timeoutMs: 180_000 }),
    q: (r) => { const t = deltaText(r.events); return [must('streamed + done', t.length > 40 && finished(r.events)), grade('names the localization tension', coverage(t, ['localiz']))]; } },
  { id: 'analyze-gaps', group: 'analyze', repeats: 1, exec: () => post('/api/analyze', { mode: 'gaps', cards: [{ kind: 'doc', title: 'Launch', text: 'Ship the onboarding revamp in October.' }] }, { sse: true, timeoutMs: 180_000 }),
    q: (r) => [must('streamed + done', deltaText(r.events).length > 40 && finished(r.events))] },

  // ── seed prompts ──
  { id: 'seed-text', group: 'seed', repeats: 1, exec: () => post('/api/seed-prompts', { text: TRANSCRIPT, title: 'Product sync' }),
    q: (r) => [must('3–4 prompts', Array.isArray(r.json?.prompts) && r.json.prompts.length >= 3 && r.json.prompts.length <= 4), must('each has label+prompt', (r.json?.prompts ?? []).every((p) => p.label && p.prompt))], meta: (r) => ({ n: r.json?.prompts?.length ?? 0 }) },
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

const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** One execution → graded checks. Transient sidecar drops (fast empty/errored
 *  stream under load) are retried once — NOT a product failure. */
async function once(c) {
  const run = async () => {
    let r; try { r = await c.exec(); } catch (e) { r = { status: 0, events: [], json: null, ms: 0, error: String(e) }; }
    return r;
  };
  let r = await run();
  const transient = (r) => Boolean(r.error) || r.events.some((e) => e.type === 'error') || (c.group !== 'platform' && c.group !== 'router' && r.events.length > 0 && !r.events.some((e) => e.type === 'done'));
  if (transient(r)) { await new Promise((res) => setTimeout(res, 1500)); r = { ...(await run()), retried: true }; }
  let checks;
  try { checks = c.q(r); } catch (e) { checks = [{ name: 'grader-threw', score: 0, mustPass: true, detail: String(e).slice(0, 80) }]; }
  const hard = checks.filter((x) => x.mustPass);
  const soft = checks.filter((x) => !x.mustPass);
  const hardOk = hard.every((x) => x.score >= 1);
  const softScore = soft.length ? soft.reduce((a, x) => a + x.score, 0) / soft.length : 1;
  return { ms: r.ms, hardOk, softScore, checks, meta: c.meta ? (() => { try { return c.meta(r); } catch { return {}; } })() : {}, retried: Boolean(r.retried) };
}

async function runSuite(label) {
  const cases = CASES.filter((c) => ONLY.length === 0 || ONLY.includes(c.group));
  console.log(`\n▶ ${label}: ${cases.length} cases · concurrency ${CONCURRENCY} · repeats(quality)=${REPEATS}\n`);
  const started = Date.now();
  const records = await runPool(cases, async (c) => {
    const n = Math.max(1, c.repeats ?? 1);
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(await once(c));
    const hardPassRate = runs.filter((r) => r.hardOk).length / n;
    // quality = mean soft score over repeats that cleared the gates (a hard
    // fail contributes 0 — a malformed answer has no quality credit).
    const quality = runs.reduce((a, r) => a + (r.hardOk ? r.softScore : 0), 0) / n;
    // per-check mean score across repeats (for the compare's drift view)
    const checkMeans = {};
    for (const r of runs) for (const x of r.checks) { (checkMeans[x.name] ??= []).push(x.score); }
    const perCheck = Object.fromEntries(Object.entries(checkMeans).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)]));
    const pass = hardPassRate === 1 && quality >= 0.7;
    const medMs = median(runs.map((r) => r.ms));
    const meta = runs[runs.length - 1].meta;
    const failedGates = [...new Set(runs.flatMap((r) => r.checks.filter((x) => x.mustPass && x.score < 1).map((x) => x.name)))];
    const line = `${pass ? '✅' : '❌'} ${c.id.padEnd(22)} q=${quality.toFixed(2)} hard=${(hardPassRate * 100).toFixed(0)}%  x${n}${runs.some((r) => r.retried) ? ' (retried)' : ''}  ~${medMs}ms`;
    console.log(line);
    if (!pass) { if (failedGates.length) console.log(`      gate misses: ${failedGates.join(', ')}`); if (quality < 0.7) console.log(`      low grounding: ${JSON.stringify(perCheck)}`); }
    return { id: c.id, group: c.group, repeats: n, quality: +quality.toFixed(3), hardPassRate: +hardPassRate.toFixed(3), pass, perCheck, meta, medMs };
  });
  const q = records.filter((r) => r.group === 'quality');
  const snapshot = {
    label, startedAt: new Date(started).toISOString(), wallMs: Date.now() - started,
    cases: records,
    summary: {
      pass: records.filter((r) => r.pass).length, total: records.length,
      meanQuality: +(records.reduce((a, r) => a + r.quality, 0) / records.length).toFixed(3),
      meanQualityCritical: q.length ? +(q.reduce((a, r) => a + r.quality, 0) / q.length).toFixed(3) : null,
      medLatencyMs: median(records.map((r) => r.medMs)), // informational only
    },
  };
  console.log(`\n  ${snapshot.summary.pass}/${snapshot.summary.total} pass · mean quality ${snapshot.summary.meanQuality} · quality-critical ${snapshot.summary.meanQualityCritical} · (latency ~${snapshot.summary.medLatencyMs}ms median, informational) · wall ${Math.round(snapshot.wallMs / 1000)}s`);
  return snapshot;
}

/* ── compare (quality-only verdict) ───────────────────────────────────────────── */

function compare(basePath, candPath) {
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
  const byId = (s) => Object.fromEntries(s.cases.map((c) => [c.id, c]));
  const B = byId(base), C = byId(cand);
  const ids = [...new Set([...Object.keys(B), ...Object.keys(C)])];

  const regressions = [], gains = [], drift = [];
  for (const id of ids) {
    const b = B[id], c = C[id];
    if (!b || !c) { drift.push(`${id}: only in ${b ? 'baseline' : 'candidate'}`); continue; }
    // a REGRESSION is a hard-gate that started failing, or a real quality drop.
    if (b.hardPassRate === 1 && c.hardPassRate < 1) regressions.push(`${id} › hard-gate now failing (${(c.hardPassRate * 100).toFixed(0)}%)`);
    else if (c.quality + QUALITY_TOL < b.quality) regressions.push(`${id} › quality ${b.quality} → ${c.quality} (−${(b.quality - c.quality).toFixed(2)})`);
    if (b.hardPassRate < 1 && c.hardPassRate === 1) gains.push(`${id} › hard-gate now passing`);
    else if (c.quality > b.quality + QUALITY_TOL) gains.push(`${id} › quality ${b.quality} → ${c.quality} (+${(c.quality - b.quality).toFixed(2)})`);
    // per-check drift (grounding etc.)
    for (const name of new Set([...Object.keys(b.perCheck ?? {}), ...Object.keys(c.perCheck ?? {})])) {
      const bv = b.perCheck?.[name], cv = c.perCheck?.[name];
      if (bv !== undefined && cv !== undefined && Math.abs(bv - cv) >= 0.34) drift.push(`${id} › ${name}: ${bv} → ${cv}`);
    }
    const bm = JSON.stringify(b.meta ?? {}), cm = JSON.stringify(c.meta ?? {});
    if (bm !== cm) drift.push(`${id} › meta ${bm} → ${cm}`);
  }

  const line = '─'.repeat(66);
  console.log(`\n${line}\nRESPONSE-QUALITY A/B  baseline=${base.label}  candidate=${cand.label}\n${line}`);
  console.log(`pass:            ${base.summary.pass}/${base.summary.total}  →  ${cand.summary.pass}/${cand.summary.total}`);
  console.log(`mean quality:    ${base.summary.meanQuality}  →  ${cand.summary.meanQuality}`);
  console.log(`quality-critical:${base.summary.meanQualityCritical}  →  ${cand.summary.meanQualityCritical}`);
  console.log(`\nQUALITY REGRESSIONS: ${regressions.length}`);
  for (const r of regressions) console.log(`  🔴 ${r}`);
  console.log(`\nQUALITY GAINS: ${gains.length}`);
  for (const g of gains) console.log(`  🟢 ${g}`);
  console.log(`\nDRIFT (grounding / recorded values; not pass/fail): ${drift.length}`);
  for (const d of drift) console.log(`  • ${d}`);
  console.log(`\n(latency ~${base.summary.medLatencyMs}ms → ~${cand.summary.medLatencyMs}ms median — informational; sidecar wall-clock is not a quality signal)`);
  console.log(`\n${line}\nVERDICT: ${regressions.length === 0 ? '✅ NO QUALITY REGRESSIONS' : `🔴 ${regressions.length} QUALITY REGRESSION(S)`}\n${line}`);
  return regressions.length === 0;
}

/* ── cli ───────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  process.exit(compare(args[1], args[2]) ? 0 : 1);
} else {
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'run';
  const snap = await runSuite(label);
  if (out) { fs.writeFileSync(out, JSON.stringify(snap, null, 2)); console.log(`\nwrote ${out}`); }
}
