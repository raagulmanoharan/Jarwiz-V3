/**
 * Eval — conversational depth (Big Rocks 3.3).
 * Run with preview + server up:  node scripts/eval-discuss.mjs
 *
 *  A. A "Discuss" chip appears on a selected doc card
 *  B. Opening it shows the thread panel
 *  C. A follow-up revises the SAME card in place (text changes, no new card)
 *  D. The exchange is logged in the thread (you + agent turns)
 *  E. The revision is a single undo
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

  // Seed a doc card with real content and select it.
  const id = await page.evaluate(() => {
    const id = 'shape:' + Math.random().toString(36).slice(2);
    window.editor.createShape({
      id, type: 'doc-card', x: 360, y: 280,
      props: { w: 520, h: 360, title: 'Pricing strategy', text: '## Pricing\n\nWe will launch at $49/mo for all customers, self-serve only.', sourcePdfId: '' },
    });
    window.__doc = id;
    window.editor.select(id);
    return id;
  });
  await sleep(500);

  // ── A. Discuss chip appears ─────────────────────────────────────────────
  const chip = page.locator('.jz-discuss-chip');
  const chipVisible = (await chip.count()) > 0;
  record('Discuss chip appears on a doc card', chipVisible);

  // ── B. Opening shows the thread panel ───────────────────────────────────
  let panelVisible = false;
  if (chipVisible) {
    await chip.first().click({ force: true });
    await sleep(300);
    panelVisible = (await page.locator('.jz-discuss-panel').count()) > 0;
  }
  record('Discuss panel opens', panelVisible);
  await page.screenshot({ path: `${OUT}/jz-discuss-open.png` });

  // ── C/D. Follow-up revises the card in place + logs the exchange ────────
  const beforeText = await page.evaluate((id) => window.editor.getShape(id).props.text, id);
  const beforeDocs = await docCount(page);
  if (panelVisible) {
    await page.locator('.jz-discuss-input').fill('What about enterprise customers who need a pilot and invoicing?');
    await page.locator('.jz-discuss-send').click();
    // Wait for the card text to change (revise can take a while).
    for (let i = 0; i < 45; i++) {
      await sleep(800);
      const t = await page.evaluate((id) => window.editor.getShape(id).props.text, id);
      if (t !== beforeText) break;
    }
  }
  const afterText = await page.evaluate((id) => window.editor.getShape(id).props.text, id);
  const afterDocs = await docCount(page);
  record('Follow-up revises the SAME card in place', afterText !== beforeText && afterDocs === beforeDocs,
    `changed=${afterText !== beforeText} docs ${beforeDocs}→${afterDocs}`);
  const youTurns = await page.locator('.jz-discuss-turn--you').count();
  const agentTurns = await page.locator('.jz-discuss-turn--agent').count();
  record('The exchange is logged (you + agent turns)', youTurns >= 1 && agentTurns >= 1,
    `you=${youTurns} agent=${agentTurns}`);
  await page.evaluate((id) => { window.editor.select(id); window.editor.zoomToFit(); }, id);
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-discuss-revised.png` });

  // ── E. Single undo restores the original text ───────────────────────────
  await page.evaluate(() => { window.editor.undo(); });
  await sleep(500);
  const undoneText = await page.evaluate((id) => window.editor.getShape(id).props.text, id);
  record('Revision is a single undo', undoneText === beforeText, undoneText === beforeText ? 'restored' : 'not restored');

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} discuss checks passed`);
  writeFileSync(`${OUT}/jz-discuss-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
