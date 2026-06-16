/**
 * Eval — combining sources + disambiguation. Drives the preview build:
 *   • an image card is askable (vision source)
 *   • a multi-select shows the "Combining N · …" affordance
 *   • an ambiguous request surfaces a clarifying question with options, and
 *     answering it produces a card (skips re-asking)
 * The clarify + answer paths hit the real model (sidecar). Screenshots → /tmp.
 * Run with preview + server up:  node scripts/eval-combine.mjs
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };

// A tiny valid 1×1 PNG data URL.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let browser;
async function open() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) => /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url()) ? route.abort() : route.continue());
  await page.addInitScript(() => { try { localStorage.removeItem('jz-onboarded'); } catch {} });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);
  return page;
}
const clear = (page) => page.evaluate(() => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });
const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const seed = (page, spec) => page.evaluate((s) => { window.editor.createShape(s); }, spec);
const selectMany = (page, ids) => page.evaluate((xs) => { window.editor.select(...xs); }, ids);
const responseCount = (page) => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => ['doc-card', 'table-card', 'diagram-card'].includes(s.type)).length);

async function run() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await open();

  // ── A. Image card is askable ─────────────────────────────────────────────
  await clear(page);
  const img = nid();
  await seed(page, { id: img, type: 'image-card', x: 250, y: 250, props: { w: 320, h: 240, src: PNG, name: 'chart.png' } });
  await sleep(500);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await page.evaluate((i) => { window.editor.select(i); }, img);
  await sleep(900);
  const askVisible = (await page.locator('.jz-ask-pill').count().catch(() => 0)) > 0;
  record('image card is askable (Ask affordance shows)', askVisible);

  // ── B. Multi-select shows the "Combining N" affordance ───────────────────
  await clear(page);
  const doc = nid(), img2 = nid();
  await seed(page, { id: doc, type: 'doc-card', x: 120, y: 200, props: { w: 460, h: 300, title: 'Q3 notes', text: 'Revenue up 20% QoQ. Churn down to 3%. Two new enterprise logos.', sourcePdfId: '' } });
  await seed(page, { id: img2, type: 'image-card', x: 640, y: 200, props: { w: 320, h: 240, src: PNG, name: 'chart.png' } });
  await sleep(500);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await selectMany(page, [doc, img2]);
  await sleep(900);
  const combiningTxt = (await page.locator('.jz-ask-combining').innerText().catch(() => '')).trim();
  record('multi-select shows "Combining N · …"', /Combining 2/.test(combiningTxt) && /Image/.test(combiningTxt) && /Doc/.test(combiningTxt), combiningTxt);
  await page.screenshot({ path: `${OUT}/jz-combine-multiselect.png` });

  // ── C. Ambiguous request → clarifying question → answer → card ────────────
  await page.locator('.jz-ask-pill').first().click({ timeout: 8000 });
  await page.fill('.jz-ask-input', 'do something with these');
  await page.press('.jz-ask-input', 'Enter');

  let sawClarify = false;
  for (let i = 0; i < 150; i++) {
    if (await page.locator('.jz-clarify-opt').count().catch(() => 0)) { sawClarify = true; break; }
    await sleep(400);
  }
  const optsText = await page.locator('.jz-clarify-opt').allInnerTexts().catch(() => []);
  record('ambiguous request shows a clarifying question + options', sawClarify, optsText.join(' · '));
  await page.screenshot({ path: `${OUT}/jz-combine-clarify.png` });

  if (sawClarify) {
    const before = await responseCount(page);
    await page.locator('.jz-clarify-opt').first().click();
    // Answer re-runs the Ask (skipClarify) → a draft card streams in.
    let made = false;
    for (let i = 0; i < 160; i++) {
      await sleep(700);
      if ((await responseCount(page)) > before || (await page.locator('.jz-draft-keep').count().catch(() => 0))) { made = true; break; }
    }
    record('answering the question produces a card', made);
    await page.evaluate(() => { window.editor.zoomToFit(); });
    await sleep(600);
    await page.screenshot({ path: `${OUT}/jz-combine-answered.png` });
  }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} combine checks passed`);
  writeFileSync(`${OUT}/jz-combine-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
