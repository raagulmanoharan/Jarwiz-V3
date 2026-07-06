/**
 * Eval — in-place regeneration progress + cancel. Selects an answer card, asks
 * a same-type tweak (real model), waits for the "Regenerating…" control to
 * appear, then clicks Cancel and asserts the card's PREVIOUS content is restored
 * (the model call is aborted and the history mark is bailed). Run with preview +
 * server up:  node scripts/eval-regen-cancel.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };

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
const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const docText = (page, id) => page.evaluate((i) => window.editor.getShape(i)?.props?.text ?? '', id).catch(() => '');

async function run() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await open();
  await page.evaluate(() => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });

  const id = nid();
  const original = 'Remote work is allowed three days a week. Managers approve schedules quarterly. Equipment stipends up to $500 are available annually.';
  await page.evaluate(({ i, t }) => {
    window.editor.createShape({ id: i, type: 'doc-card', x: 200, y: 200, props: { w: 520, h: 320, title: 'Policy', text: t, sourcePdfId: '' } });
  }, { i: id, t: original });
  await sleep(500);
  await page.evaluate((i) => { window.editor.zoomToFit(); window.editor.select(i); }, id);
  await sleep(900);

  // Ask a same-type tweak (stays a doc → in-place).
  await page.locator('.jz-ask-pill').first().click({ timeout: 8000 });
  await page.fill('.jz-ask-input', 'Rewrite this much longer with far more detail and many extra sections');
  await page.press('.jz-ask-input', 'Enter');

  // Wait for the "Regenerating…" control (in-place progress affordance).
  let sawRegen = false;
  for (let i = 0; i < 150; i++) {
    if (await page.locator('.jz-draft-label', { hasText: 'Regenerating' }).count().catch(() => 0)) { sawRegen = true; break; }
    await sleep(200);
  }
  record('in-place shows a "Regenerating…" progress control', sawRegen);

  // Cancel it.
  if (sawRegen) {
    await page.screenshot({ path: `${OUT}/jz-regen-cancel.png` });
    await page.locator('.jz-draft .jz-draft-discard', { hasText: 'Cancel' }).click().catch(() => {});
  }
  // Give the abort/bail a moment, then confirm restoration.
  await sleep(2500);
  const after = await docText(page, id);
  const regenGone = (await page.locator('.jz-draft-label', { hasText: 'Regenerating' }).count().catch(() => 0)) === 0;
  record('Cancel restores the previous content', after === original, after === original ? 'exact match' : `got ${after.length} chars`);
  record('Cancel clears the progress control', regenGone);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} cancel checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
