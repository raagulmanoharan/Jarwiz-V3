/**
 * Verify the INTUITIVE model suggestion: selecting a quantitative card makes
 * Jarwiz propose an interactive-model pill among its AI next-move suggestions
 * (above the composer) — no regex, no pre-wired action-bar item. Tapping it
 * pins Prototype and produces a grounded, live model.
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

// One quantitative card — a unit-economics doc — then select it.
await page.evaluate(() => {
  window.editor.createShape({ id: 'shape:econ', type: 'doc-card', x: 260, y: 200, props: { w: 420, h: 340, title: 'Unit Economics (per order)', text: '# Unit Economics — per laundry order\n- Price per order: ₹425\n- Wash & fold (₹45/kg × 5kg): ₹225 (53%)\n- Pickup & delivery: ₹80 (19%)\n- Packaging: ₹15 (4%)\n- Ops/dispatch allocated: ₹35 (8%)\n- Contribution margin: ₹70 per order (16%)\n- Fixed costs: ₹95,000/month\n- Break-even: ~62 orders/day\nBangalore ~10,656 listings · Chennai ~1,455 · Pondicherry ~1,603.' } });
  window.editor.select('shape:econ');
});
await sleep(600);
await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(500);

// Wait for the AI seed pills to arrive (they replace the shimmer).
let labels = [];
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  await sleep(2000);
  labels = await page.locator('.jz-pb-chip').allTextContents().catch(() => []);
  if (labels.length && !(await page.locator('.jz-pb-chip--wait').count())) break;
}
out.pill_labels = labels;
out.model_pill_present = await page.locator('.jz-pb-chip--make').count();
out.model_pill_label = await page.locator('.jz-pb-chip--make').first().textContent().catch(() => '');
log('seed pills:', JSON.stringify(labels));
log('interactive-model pill present:', out.model_pill_present, JSON.stringify(out.model_pill_label));
await page.screenshot({ path: '/tmp/jz-suggest-1-pills.png' });

if (out.model_pill_present) {
  await page.locator('.jz-pb-chip--make').first().click().catch(() => {});
  await sleep(900);
  out.pinned_mode = await page.locator('.jz-pb-mode').allTextContents().catch(() => []);
  out.prompt_filled = (await page.locator('.jz-promptbar-input').textContent().catch(() => '') || '').slice(0, 80);
  log('after tap — pinned mode:', JSON.stringify(out.pinned_mode), '| prompt:', JSON.stringify(out.prompt_filled));
  await page.screenshot({ path: '/tmp/jz-suggest-2-pinned.png' });
  // Send it → grounded model.
  askBody = null;
  await page.keyboard.press('Enter');
  await sleep(1500);
  out.ask_shape = askBody?.shape; out.ask_sources = (askBody?.sources || []).length;
  log('grounded ask fired: shape=%s sources=%s', out.ask_shape, out.ask_sources);
  const d2 = Date.now() + 260000; let made = false;
  while (Date.now() < d2) { await sleep(3000); const n = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'prototype-card' && String(s.props?.html || '').trim() && s.props?.status !== 'running').length).catch(() => 0); if (n > 0) { made = true; break; } }
  out.model_rendered = made;
  await sleep(2500);
  out.model_outputs_strip = await page.locator('.jz-proto-outputs').count();
  await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(1000);
  await page.screenshot({ path: '/tmp/jz-suggest-3-model.png' });
  log('model rendered:', made, '| outputs strip:', out.model_outputs_strip);
}

writeFileSync('/tmp/jz-suggest-verify.json', JSON.stringify(out, null, 2));
log('RESULT:', JSON.stringify(out));
await b.close(); process.exit(0);
