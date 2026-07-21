/**
 * Server eval — exercises every backend endpoint against the running server and
 * asserts the shape of what comes back. Real (sidecar) LLM calls are slow, so
 * this takes a few minutes. Run with the server up:  node scripts/eval-server.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/home/user/Jarwiz-V3/apps/server/');
const { WebSocket } = require('ws');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const BASE = 'http://localhost:3001';
const results = [];
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); };
const fail = (name, detail = '') => { results.push({ name, ok: false, detail }); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); };

/** POST and collect SSE `data:` events until 'done'/'error' or timeout. */
async function collectSSE(path, body, maxMs = 90_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), maxMs);
  const events = [];
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) return { events, status: res.status };
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
    return { events, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log('Server eval\n');

  // 1. health
  try {
    const r = await fetch(`${BASE}/api/health`).then((x) => x.json());
    r.ok ? pass('GET /api/health', 'ok:true') : fail('GET /api/health', JSON.stringify(r));
  } catch (e) { fail('GET /api/health', String(e)); }

  // 2. capabilities
  let mode = 'demo';
  try {
    const r = await fetch(`${BASE}/api/capabilities`).then((x) => x.json());
    mode = r.mode;
    typeof r.live === 'boolean' && ['api', 'sidecar', 'demo'].includes(r.mode)
      ? pass('GET /api/capabilities', `live=${r.live} mode=${r.mode}`)
      : fail('GET /api/capabilities', JSON.stringify(r));
  } catch (e) { fail('GET /api/capabilities', String(e)); }

  const source = { cardId: 'c1', kind: 'note', x: 0, y: 0, w: 220, h: 220, text: 'The James Webb telescope sees infrared light from the early universe.' };

  // 3. agent run (Summarizer → a doc card streamed)
  try {
    const { events } = await collectSSE('/api/agents/summarizer/run', { source, placement: { x: 400, y: 0 } });
    const created = events.find((e) => e.type === 'card.create');
    const deltas = events.filter((e) => e.type === 'card.delta').length;
    const done = events.some((e) => e.type === 'done');
    created && deltas > 0 && done
      ? pass('POST /api/agents/summarizer/run', `kind=${created.kind} deltas=${deltas}`)
      : fail('POST /api/agents/summarizer/run', `created=${!!created} deltas=${deltas} done=${done}`);
  } catch (e) { fail('POST /api/agents/summarizer/run', String(e)); }

  // 4. Writer format routing (comparison brief → a table)
  try {
    const cmp = { ...source, text: 'Compare React vs Vue vs Svelte — pros and cons' };
    const { events } = await collectSSE('/api/agents/writer/run', { source: cmp, placement: { x: 400, y: 0 } });
    const created = events.find((e) => e.type === 'card.create');
    created && created.kind === 'table'
      ? pass('Writer response-shape routing', 'comparison → table')
      : fail('Writer response-shape routing', `kind=${created?.kind}`);
  } catch (e) { fail('Writer response-shape routing', String(e)); }

  // 5. Autopilot prose
  try {
    const { events } = await collectSSE('/api/autopilot', { kind: 'doc', title: 'Async beats meetings', text: 'Meetings are where momentum goes to die:' });
    const deltas = events.filter((e) => e.type === 'delta').length;
    deltas > 0 && events.some((e) => e.type === 'done')
      ? pass('POST /api/autopilot', `${deltas} deltas`)
      : fail('POST /api/autopilot', `deltas=${deltas}`);
  } catch (e) { fail('POST /api/autopilot', String(e)); }

  // 6. Autopilot table fill
  try {
    const { events } = await collectSSE('/api/autopilot/table', {
      columns: ['Tool', 'Price', 'Best for'],
      rows: [['Figma', '', ''], ['Sketch', '', '']],
    });
    const cells = events.filter((e) => e.type === 'cell').length;
    cells >= 3 ? pass('POST /api/autopilot/table', `${cells} cells`) : fail('POST /api/autopilot/table', `cells=${cells}`);
  } catch (e) { fail('POST /api/autopilot/table', String(e)); }

  // 7. Comment reply
  try {
    const { events } = await collectSSE('/api/comment', {
      agentId: 'researcher', cardKind: 'note', cardTitle: 'Launch plan',
      thread: [{ author: 'you', text: 'What are we missing before launch?' }],
    });
    const deltas = events.filter((e) => e.type === 'delta').length;
    deltas > 0 ? pass('POST /api/comment', `${deltas} deltas`) : fail('POST /api/comment', `deltas=${deltas}`);
  } catch (e) { fail('POST /api/comment', String(e)); }

  // 10. Multiplayer sync — WebSocket upgrade accepted
  try {
    const ok = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:3001/api/sync/eval-room?sessionId=eval${Date.now()}`);
      const to = setTimeout(() => { ws.close(); resolve(false); }, 6000);
      ws.on('open', () => { clearTimeout(to); ws.close(); resolve(true); });
      ws.on('error', () => { clearTimeout(to); resolve(false); });
    });
    ok ? pass('WS /api/sync/:room', 'upgrade accepted') : fail('WS /api/sync/:room', 'no upgrade');
  } catch (e) { fail('WS /api/sync/:room', String(e)); }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} passed`);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
