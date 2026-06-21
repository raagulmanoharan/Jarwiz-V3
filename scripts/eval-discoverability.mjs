/**
 * Eval — discoverability P3 (quick-action chips + coachmark).
 * Run with preview + server up:  node scripts/eval-discoverability.mjs
 *
 *  A. No quick-action chips on an empty board
 *  B. Chips appear when the board has content and nothing is selected
 *  C. Chips hide when an askable shape is selected (grounding takes over)
 *  D. Coachmark appears once the board grows (≥5), dismiss sticks
 *  E. A chip runs a board scan (a result doc appears)
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

let browser;
async function open() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.route('**/*', (route) => /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url()) ? route.abort() : route.continue());
  await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.includes('tldraw')) localStorage.removeItem(k); } catch {} });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1400);
  const skip = page.locator('.jz-boardentry-skip'); if (await skip.count()) { await skip.click(); await sleep(400); }
  return page;
}

const seedNotes = (page, n, from = 0) => page.evaluate(({ n, from }) => {
  const mk = () => 'shape:' + Math.random().toString(36).slice(2);
  window.__notes = window.__notes || [];
  for (let i = 0; i < n; i++) { const id = mk(); window.__notes.push(id); window.editor.createShape({ id, type: 'note-card', x: 120 + ((from + i) % 4) * 250, y: 160 + Math.floor((from + i) / 4) * 190, props: { w: 220, h: 150, text: `Observation ${from + i + 1}: a real point worth a sentence`, color: '#fbf6e9' } }); }
  window.editor.selectNone();
}, { n, from });

async function run() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await open();

  // ── A. Empty board → no chips ───────────────────────────────────────────
  await sleep(300);
  record('No chips on an empty board', (await page.locator('.jz-pb-chip').count()) === 0);

  // ── B. Content + nothing selected → chips ───────────────────────────────
  await seedNotes(page, 3);
  await sleep(400);
  const chips = await page.locator('.jz-pb-chip').count();
  record('Chips appear with board content', chips >= 2, `${chips} chips`);
  await page.screenshot({ path: `${OUT}/jz-disc-chips.png` });

  // ── C. Selection hides chips ────────────────────────────────────────────
  await page.evaluate(() => { window.editor.select(window.__notes[0]); });
  await sleep(300);
  record('Chips hide when something is selected', (await page.locator('.jz-pb-chip').count()) === 0);
  await page.evaluate(() => { window.editor.selectNone(); });
  await sleep(200);

  // ── D. Coachmark at ≥5 cards, dismiss sticks ────────────────────────────
  await seedNotes(page, 2, 3); // total 5
  await sleep(400);
  const coach = (await page.locator('.jz-coach').count()) > 0;
  record('Coachmark appears once the board grows', coach);
  await page.screenshot({ path: `${OUT}/jz-disc-coach.png` });
  if (coach) {
    await page.locator('.jz-coach-dismiss').click();
    await sleep(300);
    const gone = (await page.locator('.jz-coach').count()) === 0;
    const persisted = await page.evaluate(() => localStorage.getItem('jz-coach-agents') === '1');
    record('Dismissing the coachmark sticks', gone && persisted);
  } else {
    record('Dismissing the coachmark sticks', false, 'no coachmark');
  }

  // ── E. A chip runs a scan ───────────────────────────────────────────────
  const beforeDocs = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);
  await page.locator('.jz-pb-chip', { hasText: 'missing' }).click();
  let docs = beforeDocs;
  for (let i = 0; i < 45; i++) { await sleep(800); docs = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length); if (docs > beforeDocs) break; }
  record('A chip runs a board scan (result appears)', docs > beforeDocs, `docs ${beforeDocs}→${docs}`);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} discoverability checks passed`);
  writeFileSync(`${OUT}/jz-disc-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
