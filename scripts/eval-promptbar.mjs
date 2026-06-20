/**
 * Eval — bottom-centre prompt bar (Stitch-style agent query box).
 * Run with preview + server up:  node scripts/eval-promptbar.mjs
 *
 *  A. The prompt bar is present at the bottom-centre, above the toolbar
 *  B. A sourceless query hits /api/ask with empty sources and drops a card
 *  C. With a selection, the placeholder reflects grounding ("Ask across N")
 *  D. Typing in the bar does not trigger canvas shortcuts (d/n)
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

const docCount = (page) =>
  page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  let askBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/ask') && req.method() === 'POST') {
      try { askBody = JSON.parse(req.postData() || 'null'); } catch {}
    }
  });

  // ── A. Prompt bar present at bottom-centre ──────────────────────────────
  const bar = page.locator('.jz-promptbar');
  const present = (await bar.count()) > 0;
  record('Prompt bar is present', present);
  await page.screenshot({ path: `${OUT}/jz-promptbar-empty.png` });

  // ── D. Typing in the bar does not trigger canvas shortcuts ──────────────
  const beforeDocs = await docCount(page);
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type('design a dn flow');
  await sleep(300);
  const afterTypeDocs = await docCount(page);
  record('Typing in the bar does not fire d/n shortcuts', afterTypeDocs === beforeDocs,
    `docs ${beforeDocs}→${afterTypeDocs}`);
  // Clear it.
  await page.locator('.jz-promptbar-input').fill('');

  // ── B. Sourceless query drops a card ────────────────────────────────────
  await page.evaluate(() => { window.editor.selectNone(); });
  await page.locator('.jz-promptbar-input').fill('List three principles of good onboarding');
  askBody = null;
  await page.keyboard.press('Enter');
  // Wait for the answer card to appear (sidecar can take a while).
  let docs = beforeDocs;
  for (let i = 0; i < 40; i++) {
    await sleep(800);
    docs = await docCount(page);
    if (docs > beforeDocs) break;
  }
  record('Sourceless query hits /api/ask with no sources',
    Boolean(askBody) && Array.isArray(askBody.sources) && askBody.sources.length === 0,
    askBody ? `sources=${askBody.sources?.length}` : 'no request');
  record('Sourceless query drops an answer card', docs > beforeDocs, `docs ${beforeDocs}→${docs}`);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/jz-promptbar-answer.png` });

  // ── C. Placeholder reflects a grounding selection ───────────────────────
  const noteId = await page.evaluate(() => {
    const id = 'shape:' + Math.random().toString(36).slice(2);
    window.editor.createShape({ id, type: 'note-card', x: 200, y: 200, props: { w: 220, h: 150, text: 'A note', color: '#fbf6e9' } });
    window.editor.select(id);
    return id;
  });
  await sleep(400);
  const ph = await page.locator('.jz-promptbar-input').getAttribute('placeholder');
  record('Placeholder reflects grounding selection', /Ask across 1/.test(ph || ''), ph || '');

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} prompt-bar checks passed`);
  writeFileSync(`${OUT}/jz-promptbar-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
