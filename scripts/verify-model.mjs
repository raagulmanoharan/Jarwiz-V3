/**
 * Verify the board-connected interactive-model feature end to end:
 *   Phase 1 (deterministic) — a prototype whose HTML self-posts jz:proto proves
 *     the results-out plumbing: the outputs strip renders + "Push to note" makes
 *     a real note-card.
 *   Phase 2 — seeding economics cards makes the "Turn this into a model" pill
 *     appear (the proactive contextual suggestion).
 *   Phase 3 (best-effort) — clicking the pill fires a GROUNDED prototype and a
 *     real interactive model renders (grounded on the board's numbers).
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const out = {};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 960 } });
const page = await ctx.newPage();
await page.route('**/*', (r) => /cdn\.tldraw|fonts\.goog|gstatic/.test(r.request().url()) ? r.abort() : r.continue());
await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.includes('tldraw')) localStorage.removeItem(k); } catch {} });
let askBody = null;
page.on('request', (r) => { if (r.url().includes('/api/ask') && r.method() === 'POST') { try { askBody = JSON.parse(r.postData() || '{}'); } catch {} } });
await page.goto('http://localhost:5173/?start=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
await sleep(1500);
const modal = page.locator('.jz-persona'); if (await modal.count()) { await page.locator('.jz-persona-skip').first().click().catch(() => {}); await sleep(600); }

// ── Phase 1: results-out plumbing (deterministic self-posting prototype) ─────
await page.evaluate(() => {
  // Declarative markup only (no script) — exercises the injected results bridge.
  const html = '<!doctype html><html><body style="margin:0;font-family:system-ui;background:#0f172a;color:#fff;padding:24px"><h2>Break-even model</h2><div data-jz-output="Break-even">62/day</div><div data-jz-output="Contribution margin">16%</div><div data-jz-output="Monthly TAM">₹1.2cr</div></body></html>';
  window.editor.createShape({ id: 'shape:prototest', type: 'prototype-card', x: 200, y: 200, props: { w: 460, h: 340, html, title: 'Break-even model', prompt: 'x', status: 'done' } });
});
await sleep(1500);
out.strip_visible = await page.locator('.jz-proto-outputs').count();
out.outputs_text = await page.locator('.jz-proto-output').allTextContents().catch(() => []);
log('Phase 1 — outputs strip present:', out.strip_visible, JSON.stringify(out.outputs_text));
await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(600);
await page.screenshot({ path: '/tmp/jz-model-1-resultsout.png' });
// push to note
const notesBefore = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length);
await page.locator('.jz-proto-outputs-push').first().click().catch(() => {});
await sleep(800);
const notesAfter = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length);
out.push_to_note = notesAfter > notesBefore;
out.note_text = await page.evaluate(() => { const n = window.editor.getCurrentPageShapes().find((s) => s.type === 'note-card'); return String(n?.props?.text || '').slice(0, 160); });
log('Phase 1 — push-to-note created a note:', out.push_to_note, JSON.stringify(out.note_text));

// clean slate for the pill test
await page.evaluate(() => { window.editor.deleteShapes(window.editor.getCurrentPageShapes().map((s) => s.id)); });
await sleep(500);

// ── Phase 2: the proactive "Turn this into a model" pill ────────────────────
await page.evaluate(() => {
  const mk = (id, x, title, text) => window.editor.createShape({ id, type: 'doc-card', x, y: 160, props: { w: 360, h: 300, title, text } });
  mk('shape:econ', 120, 'Unit Economics (per order)', '# Unit Economics — per order\n- Price per order: ₹425\n- Wash & fold (₹45/kg × 5kg): ₹225 (53%)\n- Pickup & delivery: ₹80 (19%)\n- Packaging: ₹15\n- Ops/dispatch: ₹35\n- Contribution margin: ₹70 (16%)\n- Break-even: 62 orders/day');
  mk('shape:mkt', 520, 'City Market Size', '# Market size\n- Bangalore: ~10,656 STR listings, ~40% occupancy\n- Chennai: ~1,455 listings, 52% occupancy\n- Pondicherry: ~1,603 listings, 28% occupancy\n- TAM Bangalore ≈ ₹1.2 crore/month');
});
await sleep(800);
await page.evaluate(() => { window.editor.selectNone(); window.editor.zoomToFit(); }); await sleep(700);
const modelChip = page.locator('.jz-pb-chip', { hasText: 'Turn this into a model' });
out.pill_present = await modelChip.count();
log('Phase 2 — "Turn this into a model" pill present:', out.pill_present);
await page.screenshot({ path: '/tmp/jz-model-2-pill.png' });

// ── Phase 3 (best-effort): pill → grounded model ────────────────────────────
if (out.pill_present) {
  const protoBefore = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'prototype-card').length);
  askBody = null;
  await modelChip.first().click().catch(() => {});
  await sleep(1500);
  out.ask_shape = askBody?.shape; out.ask_sources = (askBody?.sources || []).length;
  log('Phase 3 — grounded ask fired: shape=%s sources=%s', out.ask_shape, out.ask_sources);
  const deadline = Date.now() + 260000;
  let made = false;
  while (Date.now() < deadline) {
    await sleep(3000);
    const n = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'prototype-card' && String(s.props?.html || '').trim() && s.props?.status !== 'running').length).catch(() => 0);
    if (n > protoBefore) { made = true; break; }
  }
  out.model_rendered = made;
  await sleep(2500);
  out.model_emitted_outputs = await page.locator('.jz-proto-outputs').count();
  log('Phase 3 — real model rendered:', made, '| emitted outputs strip:', out.model_emitted_outputs);
  await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(1000);
  await page.screenshot({ path: '/tmp/jz-model-3-grounded.png' });
}

writeFileSync('/tmp/jz-model-verify.json', JSON.stringify(out, null, 2));
log('RESULT:', JSON.stringify(out));
await b.close(); process.exit(0);
