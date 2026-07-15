/**
 * Arjun, end to end, using the NEW interactive-model suggestion in his real flow:
 *   1. He asks Jarwiz to work out the unit economics (a real card).
 *   2. He selects it — Jarwiz proactively offers to MODEL it (a contextual pill).
 *   3. He taps it → a grounded, live calculator seeded from the numbers.
 *   4. He drags a slider and watches an output move.
 *   5. He reselects the card later — the offer is gone (already modeled), replaced
 *      by deeper follow-ups.
 * Drives the real app (sidecar, live). Screenshots each beat.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const out = {};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1560, height: 980 } });
const page = await ctx.newPage();
await page.route('**/*', (r) => /cdn\.tldraw|fonts\.goog|gstatic/.test(r.request().url()) ? r.abort() : r.continue());
await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.includes('tldraw')) localStorage.removeItem(k); } catch {} });
let askBody = null;
page.on('request', (r) => { if (r.url().includes('/api/ask') && r.method() === 'POST') { try { askBody = JSON.parse(r.postData() || '{}'); } catch {} } });
await page.goto('http://localhost:5173/?start=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
await sleep(1500);
const modal = page.locator('.jz-persona');
if (await modal.count()) { const p = page.locator('.jz-persona-card', { hasText: 'Building a product' }); if (await p.count()) await p.first().click().catch(() => {}); else await page.locator('.jz-persona-skip').first().click().catch(() => {}); await sleep(700); }

const cardCount = () => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => /doc-card|table-card|dashboard-card/.test(String(s.type))).length).catch(() => 0);

// ── 1. Arjun asks for the unit economics (a real card) ──────────────────────
log('Arjun: "work out the unit economics for the laundry service…"');
const before = await cardCount();
await page.locator('.jz-promptbar-input').click();
await page.keyboard.type('Work out the unit economics per laundry order for an on-demand laundry & linen service for Airbnb hosts in Bangalore — price per order, the main costs (wash & fold, pickup & delivery, packaging, ops), contribution margin, fixed costs, and break-even orders per day.', { delay: 2 });
await sleep(200);
await page.keyboard.press('Enter');
// The answer streams as a DRAFT with a Keep/Discard bar; Jarwiz stands its
// suggestion pills down until the card is kept. Wait for Keep, then click it.
let deadline = Date.now() + 220000;
const keepBtn = page.locator('button', { hasText: /^Keep$/ });
while (Date.now() < deadline) { await sleep(3000); if (await keepBtn.count().catch(() => 0)) break; }
out.economics_made = (await cardCount()) > before;
await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(800);
await page.screenshot({ path: '/tmp/jz-arjun-1-economics.png' });
if (await keepBtn.count().catch(() => 0)) { await keepBtn.first().click().catch(() => {}); log('Arjun clicks "Keep" — the economics card is now on his board.'); await sleep(1500); }
const econId = await page.evaluate(() => { const s = window.editor.getCurrentPageShapes().filter((x) => /doc-card|table-card/.test(String(x.type))).pop(); return s ? s.id : null; });
log('economics card kept:', out.economics_made, econId);

// ── 2. He selects it; Jarwiz offers to model it ─────────────────────────────
await page.evaluate((id) => { window.editor.selectNone(); if (id) window.editor.select(id); return id; }, econId).catch(() => {});
await sleep(500);
let labels = [];
deadline = Date.now() + 55000;
while (Date.now() < deadline) { await sleep(2000); labels = await page.locator('.jz-pb-chip').allTextContents().catch(() => []); if (labels.length && !(await page.locator('.jz-pb-chip--wait').count().catch(() => 0))) break; }
out.suggestions = labels;
out.model_pill = await page.locator('.jz-pb-chip--make').first().textContent().catch(() => '');
out.model_pill_present = await page.locator('.jz-pb-chip--make').count().catch(() => 0);
log('Jarwiz suggests:', JSON.stringify(labels));
log('→ interactive-model offer:', JSON.stringify(out.model_pill), '(present:', out.model_pill_present + ')');
await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(700);
await page.screenshot({ path: '/tmp/jz-arjun-2-suggest.png' });

// ── 3. He taps it → grounded live model ─────────────────────────────────────
if (out.model_pill_present) {
  await page.locator('.jz-pb-chip--make').first().click().catch(() => {});
  await sleep(900);
  out.pinned = await page.locator('.jz-pb-mode').allTextContents().catch(() => []);
  askBody = null;
  await page.keyboard.press('Enter');
  await sleep(1500);
  out.model_ask = { shape: askBody?.shape, sources: (askBody?.sources || []).length };
  log('grounded model ask:', JSON.stringify(out.model_ask));
  deadline = Date.now() + 220000; let made = false;
  while (Date.now() < deadline) { await sleep(3000); const n = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'prototype-card' && String(s.props?.html || '').trim() && s.props?.status !== 'running').length).catch(() => 0); if (n > 0) { made = true; break; } }
  out.model_made = made;
  await sleep(2000);
  await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(1000);
  await page.screenshot({ path: '/tmp/jz-arjun-3-model.png' });
  log('live model rendered:', made);

  // ── 4. He drags a slider and watches an output move ───────────────────────
  try {
    const frame = page.frameLocator('.jz-prototype-frame');
    const slider = frame.locator('input[type="range"]').first();
    if (await slider.count()) {
      const outputsBefore = await frame.locator('body').innerText().catch(() => '');
      const box = await slider.boundingBox();
      if (box) { await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2); await sleep(600); }
      const outputsAfter = await frame.locator('body').innerText().catch(() => '');
      out.slider_changed_output = outputsBefore !== outputsAfter;
      log('dragged a slider — output recomputed:', out.slider_changed_output);
      await page.screenshot({ path: '/tmp/jz-arjun-4-adjusted.png' });
    } else { log('no slider found in frame (model may use number fields)'); }
  } catch (e) { log('slider interaction skipped:', e.message.split('\n')[0]); }

  // ── 5. Reselect the economics card — offer is gone ────────────────────────
  await page.evaluate((id) => { window.editor.selectNone(); if (id) window.editor.select(id); return id; }, econId).catch(() => {});
  await sleep(2500);
  let labels2 = [];
  deadline = Date.now() + 40000;
  while (Date.now() < deadline) { await sleep(2000); labels2 = await page.locator('.jz-pb-chip').allTextContents().catch(() => []); if (labels2.length && !(await page.locator('.jz-pb-chip--wait').count().catch(() => 0))) break; }
  out.suggestions_after = labels2;
  out.model_pill_after = await page.locator('.jz-pb-chip--make').count().catch(() => -1);
  log('after modeling, Jarwiz suggests:', JSON.stringify(labels2), '| model offer present:', out.model_pill_after);
  await page.screenshot({ path: '/tmp/jz-arjun-5-nonag.png' });
}

writeFileSync('/tmp/jz-arjun.json', JSON.stringify(out, null, 2));
log('RESULT:', JSON.stringify(out));
await b.close(); process.exit(0);
