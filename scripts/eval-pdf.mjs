/**
 * PDF-pipeline eval — the "robust" gate for the wedge (docs/ROADMAP.md §10 #1).
 * For every PDF in scripts/eval-pdfs/, drives the REAL pipeline over HTTP:
 *   upload → seed prompts (contextual pills) → ask → streamed answer,
 * and asserts: extraction produced pills, the answer streamed to completion,
 * and it carries at least one [p.N] page citation.
 *
 * Run with the server up (needs a model: API key or the Claude CLI sidecar):
 *   npm run dev --workspace=apps/server   # :3001
 *   node scripts/eval-pdf.mjs
 *
 * Add fixtures by dropping PDFs into scripts/eval-pdfs/ — aim to cover:
 * a research paper (checked in), a long report (100+ pages), a contract,
 * and a scanned/image-only doc (exercises the OCR fallback).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.JARWIZ_API ?? 'http://localhost:3001';
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'eval-pdfs');
const results = [];

const files = (await readdir(DIR)).filter((f) => f.endsWith('.pdf'));
if (!files.length) {
  console.error('No fixtures in scripts/eval-pdfs/');
  process.exit(1);
}

for (const file of files) {
  const t0 = Date.now();
  const checks = { upload: false, seeds: 0, streamed: false, citations: 0, error: '' };
  try {
    // 1 ── upload through the real presign + PUT path
    const presign = await (await fetch(`${API}/api/assets/presign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'pdf' }),
    })).json();
    const bytes = await readFile(join(DIR, file));
    const put = await fetch(`${API}${presign.uploadUrl}`, { method: 'PUT', body: bytes });
    checks.upload = put.ok;
    if (!put.ok) throw new Error(`upload ${put.status}`);

    // 2 ── contextual pills (exercises extraction + generation)
    const seeds = await (await fetch(`${API}/api/seed-prompts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: presign.assetId }),
    })).json();
    checks.seeds = seeds.prompts?.length ?? 0;

    // 3 ── a grounded ask, streamed to completion
    const res = await fetch(`${API}/api/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Summarise the key points',
        sources: [{ kind: 'pdf', assetId: presign.assetId, title: file }],
        skipClarify: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`ask ${res.status}`);
    let text = '';
    let done = false;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'card.delta') text += ev.textDelta;
        if (ev.type === 'done') done = true;
        if (ev.type === 'error') throw new Error(ev.message);
      }
    }
    checks.streamed = done && text.length > 100;
    checks.citations = (text.match(/\[p\.\d+\]/g) ?? []).length;
  } catch (e) {
    checks.error = String(e).slice(0, 120);
  }
  const pass = checks.upload && checks.seeds > 0 && checks.streamed && checks.citations > 0;
  results.push({ file, pass, secs: Math.round((Date.now() - t0) / 1000), ...checks });
}

console.log('\n=== PDF PIPELINE EVAL ===');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.file} (${r.secs}s) — upload=${r.upload} seeds=${r.seeds} streamed=${r.streamed} citations=${r.citations}${r.error ? ` error=${r.error}` : ''}`);
}
process.exit(results.every((r) => r.pass) ? 0 : 1);
