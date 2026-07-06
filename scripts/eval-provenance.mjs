/**
 * Eval — show your work (Big Rocks 2.2, Ask sourcing).
 * Run with preview + server up:  node scripts/eval-provenance.mjs
 *
 *  A. After an Ask grounded in a source, selecting the answer shows "Based on: [src]"
 *  B. The header names the actual source label
 *  C. Clicking a source selects + zooms to it
 *  D. A sourceless query's answer shows NO provenance header
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

let browser;
async function open() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.includes('tldraw')) localStorage.removeItem(k);
      }
    } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1400);
  const skip = page.locator('.jz-boardentry-skip');
  if (await skip.count()) { await skip.click(); await sleep(300); }
  return page;
}

const answerId = (page, excludeId) =>
  page.evaluate((excludeId) => {
    const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card' && s.id !== excludeId);
    return d ? d.id : null;
  }, excludeId);

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // Seed a titled source doc and Ask grounded in it (via prompt bar selection).
  const srcId = await page.evaluate(() => {
    const id = 'shape:' + Math.random().toString(36).slice(2);
    window.editor.createShape({
      id, type: 'doc-card', x: 200, y: 300,
      props: { w: 460, h: 280, title: 'Pricing memo', text: 'We will charge $49/mo with a 14-day trial.', sourcePdfId: '' },
    });
    window.editor.select(id);
    return id;
  });
  await sleep(400);
  await page.locator('.jz-promptbar-input').fill('Summarise this in one sentence');
  await page.keyboard.press('Enter');

  // Wait for the answer card to appear.
  let ansId = null;
  for (let i = 0; i < 45; i++) {
    await sleep(800);
    ansId = await answerId(page, srcId);
    if (ansId) break;
  }
  // Select the answer and look for the provenance header.
  if (ansId) {
    await page.evaluate((id) => { window.editor.select(id); }, ansId);
    await sleep(500);
  }
  // "Based on ▾" lives in the card action bar; open it to reveal the sources.
  const basedBtn = page.locator('.jz-cardbar-btn', { hasText: 'Based on' });
  const provVisible = (await basedBtn.count()) > 0;
  record('Answer shows a "Based on" header', provVisible);
  if (provVisible) { await basedBtn.first().click(); await sleep(200); }
  const srcText = provVisible ? (await page.locator('.jz-cardbar-item').first().innerText().catch(() => '')).trim() : '';
  record('Header names the source label', /Pricing memo/.test(srcText), srcText);
  await page.screenshot({ path: `${OUT}/jz-prov-header.png` });

  // ── C. Clicking the source selects + zooms it ───────────────────────────
  if (provVisible) {
    await page.locator('.jz-cardbar-item', { hasText: 'Pricing memo' }).first().click();
    await sleep(600);
    const sel = await page.evaluate(() => window.editor.getSelectedShapeIds());
    record('Clicking a source selects it', sel.length === 1 && sel[0] === srcId, JSON.stringify(sel));
  } else {
    record('Clicking a source selects it', false, 'no header');
  }

  // ── D. Sourceless query → no provenance header (fresh page, no pending draft) ──
  const page2 = await open();
  await page2.locator('.jz-promptbar-input').fill('Name three onboarding metrics');
  await page2.keyboard.press('Enter');
  let newDoc = null;
  for (let i = 0; i < 45; i++) {
    await sleep(800);
    newDoc = await page2.evaluate(() => {
      const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
      return d ? d.id : null;
    });
    if (newDoc) break;
  }
  if (newDoc) {
    await page2.evaluate((id) => { window.editor.select(id); }, newDoc);
    await sleep(500);
  }
  const provOnSourceless = (await page2.locator('.jz-cardbar-btn', { hasText: 'Based on' }).count()) > 0;
  record('Sourceless answer has no provenance header', newDoc !== null && !provOnSourceless,
    newDoc ? 'answer present, no header' : 'no answer');

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} provenance checks passed`);
  writeFileSync(`${OUT}/jz-prov-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
