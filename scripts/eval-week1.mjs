/**
 * Eval — Week 1 "Make it safe to invest in" (multi-board + onboarding + templates).
 * Run with preview + server up:  node scripts/eval-week1.mjs
 *
 * Checks:
 *  A. Topbar shows the active board name chip
 *  B. Board switcher opens, lists boards, "+ New" creates a board
 *  C. New board triggers the "What are you working on?" onboarding dialog
 *  D. Naming + "Start blank" seeds a doc card titled with the project name
 *  E. A template ("Problem → Bets → Metrics") seeds multiple cards
 *  F. Switching back to the first board restores its own canvas (persistence isolation)
 *  G. Rename persists in the chip
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
  // Fresh start: clear board metadata + any tldraw snapshots so the run is deterministic.
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.startsWith('TLDRAW') || k.includes('tldraw')) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1400);
  return page;
}

const docCount = (page) =>
  page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);
const totalCount = (page) =>
  page.evaluate(() => window.editor.getCurrentPageShapes().length);
const clear = (page) =>
  page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // ── A. Topbar shows the active board name chip ──────────────────────────
  const chip = page.locator('.jz-board-chip');
  const chipVisible = (await chip.count()) > 0;
  const chipText = chipVisible ? (await chip.first().innerText()).trim() : '';
  record('Topbar shows the board-name chip', chipVisible, chipText);
  await page.screenshot({ path: `${OUT}/jz-w1-topbar.png` });

  // Seed a card on the first (legacy) board so we can later prove isolation.
  await clear(page);
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'doc-card', x: 300, y: 300,
      props: { w: 480, h: 300, title: 'Legacy board note', text: 'This lives on board one', sourcePdfId: '' },
    });
  });
  await sleep(300);
  const board1Docs = await docCount(page);

  // ── B. Board switcher opens and lists boards ────────────────────────────
  await chip.first().click();
  await sleep(400);
  const switcherVisible = (await page.locator('.jz-bsw').count()) > 0;
  const itemsBefore = await page.locator('.jz-bsw-item').count();
  record('Board switcher opens with a board list', switcherVisible, `${itemsBefore} board(s)`);
  await page.screenshot({ path: `${OUT}/jz-w1-switcher.png` });

  // ── C. "+ New" creates a board and triggers onboarding ──────────────────
  await page.locator('.jz-bsw-new').click();
  await sleep(700);
  const entryVisible = (await page.locator('.jz-boardentry').count()) > 0;
  const headingText = entryVisible ? await page.locator('.jz-boardentry-heading').innerText() : '';
  record('New board triggers onboarding dialog', entryVisible, headingText);
  await page.screenshot({ path: `${OUT}/jz-w1-onboarding.png` });

  // ── D. Name it + "Start blank" → seeds a titled doc card ────────────────
  await page.locator('.jz-boardentry-input').fill('Auth revamp');
  await sleep(150);
  // "Start blank" is the first chip; it's selected by default.
  await page.locator('.jz-boardentry-submit').click();
  await sleep(900);
  const blankDocs = await docCount(page);
  const blankTitle = await page.evaluate(() => {
    const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
    return d ? d.props.title : '';
  });
  record('"Start blank" seeds a doc titled with the project name', blankDocs >= 1 && blankTitle === 'Auth revamp',
    `docs=${blankDocs} title="${blankTitle}"`);
  const chipAfterName = (await page.locator('.jz-board-chip').first().innerText()).trim();
  record('Chip reflects the new board name', chipAfterName.includes('Auth revamp'), chipAfterName);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-w1-blank-named.png` });

  // ── E. A template seeds multiple cards ──────────────────────────────────
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-new').click();
  await sleep(700);
  await page.locator('.jz-boardentry-input').fill('Onboarding v3');
  await sleep(150);
  // Click the "Problem → Bets → Metrics" template chip.
  await page.locator('.jz-tpl-chip', { hasText: 'Problem' }).click();
  await sleep(200);
  await page.screenshot({ path: `${OUT}/jz-w1-template-picked.png` });
  await page.locator('.jz-boardentry-submit').click();
  await sleep(1200);
  const templateDocs = await docCount(page);
  record('Template seeds multiple cards', templateDocs >= 3, `${templateDocs} doc cards`);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/jz-w1-template-applied.png` });

  // ── F. Switching back to board one restores its own canvas ──────────────
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  // First item in the list is the legacy board ("My workspace").
  await page.locator('.jz-bsw-name').first().click();
  await sleep(1200);
  const restoredDocs = await docCount(page);
  const restoredTitle = await page.evaluate(() => {
    const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
    return d ? d.props.title : '';
  });
  record('Switching boards restores the original canvas', restoredDocs === board1Docs && restoredTitle === 'Legacy board note',
    `docs=${restoredDocs} title="${restoredTitle}"`);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-w1-board-isolation.png` });

  // ── G. Rename persists in the chip ──────────────────────────────────────
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-action').first().click(); // rename (pencil) on first item
  await sleep(300);
  await page.locator('.jz-bsw-rename').fill('Renamed workspace');
  await page.keyboard.press('Enter');
  await sleep(400);
  const chipAfterRename = (await page.locator('.jz-board-chip').first().innerText()).trim();
  record('Rename updates the chip', chipAfterRename.includes('Renamed workspace'), chipAfterRename);
  await page.screenshot({ path: `${OUT}/jz-w1-rename.png` });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} week-1 checks passed`);
  writeFileSync(`${OUT}/jz-w1-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
