/**
 * Verify the model suggestion feels natural, not tiring:
 *   A. an ADJUSTABLE card (unit economics) → the "model it" pill appears.
 *   B. once a model exists FROM that card → the pill is suppressed (no nag).
 *   C. a STATIC reference table (listing counts) → no model pill (raised bar).
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
await page.goto('http://localhost:5173/?start=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
await sleep(1500);
const modal = page.locator('.jz-persona'); if (await modal.count()) { await page.locator('.jz-persona-skip').first().click().catch(() => {}); await sleep(600); }

async function pillsFor(id) {
  await page.evaluate((sid) => { window.editor.selectNone(); window.editor.select(sid); return sid; }, id).catch(() => {});
  await sleep(500);
  let labels = [];
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    await sleep(2000);
    labels = await page.locator('.jz-pb-chip').allTextContents().catch(() => []);
    if (labels.length && !(await page.locator('.jz-pb-chip--wait').count().catch(() => 0))) break;
  }
  const modelPill = await page.locator('.jz-pb-chip--make').count().catch(() => -1);
  return { labels, modelPill };
}

// ── A. adjustable card → model pill ─────────────────────────────────────────
await page.evaluate(() => { window.editor.createShape({ id: 'shape:econ', type: 'doc-card', x: 200, y: 180, props: { w: 420, h: 320, title: 'Unit Economics (per order)', text: '# Unit Economics — per laundry order\n- Price per order: ₹425\n- Wash & fold (₹45/kg × 5kg): ₹225 (53%)\n- Pickup & delivery: ₹80\n- Packaging: ₹15\n- Ops/dispatch: ₹35\n- Contribution margin: ₹70 (16%)\n- Fixed costs: ₹95,000/month\n- Break-even: ~62 orders/day' } }); });
const A = await pillsFor('shape:econ');
out.A_economics = A; log('A — economics pills:', JSON.stringify(A.labels), '| model pill:', A.modelPill);

// ── B. add a model built FROM the econ card → suppress the pill ──────────────
await page.evaluate(() => {
  const id = 'shape:proto1';
  window.editor.createShape({ id, type: 'prototype-card', x: 700, y: 180, props: { w: 460, h: 340, html: '<!doctype html><html><body style="margin:0;background:#0f172a;color:#fff;font-family:system-ui;padding:20px"><h3>Break-even model</h3></body></html>', title: 'Break-even model', prompt: 'x', status: 'done' } });
  window.editor.updateShape({ id, type: 'prototype-card', meta: { jzSources: ['shape:econ'] } });
});
await sleep(500);
const B = await pillsFor('shape:econ');
out.B_after_model = B; log('B — after a model exists, econ pills:', JSON.stringify(B.labels), '| model pill:', B.modelPill);
await page.screenshot({ path: '/tmp/jz-restraint-suppressed.png' });

// ── C. static reference table → no model pill ───────────────────────────────
await page.evaluate(() => { window.editor.createShape({ id: 'shape:mkt', type: 'doc-card', x: 200, y: 560, props: { w: 420, h: 300, title: 'City Market Size', text: '# Active STR listings by city (reference)\n- Bangalore: ~10,656 listings, ~40% occupancy\n- Chennai: ~1,455 listings, 52% occupancy\n- Pondicherry: ~1,603 listings, 28% occupancy\nSource: AirDNA snapshot, Q2. Figures are reported counts.' } }); });
const C = await pillsFor('shape:mkt');
out.C_static = C; log('C — static market-size pills:', JSON.stringify(C.labels), '| model pill:', C.modelPill);

writeFileSync('/tmp/jz-restraint.json', JSON.stringify(out, null, 2));
log('RESULT: A.model=%s (want 1)  B.model=%s (want 0)  C.model=%s (want 0)', out.A_economics.modelPill, out.B_after_model.modelPill, out.C_static.modelPill);
await b.close(); process.exit(0);
