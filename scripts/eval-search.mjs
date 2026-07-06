/**
 * Cross-board search eval (ROADMAP §10 #7). Two boards with distinct content;
 * the side panel's search must match by title instantly, match by CONTENT of
 * an unmounted board (read from its database), show a snippet, and switch to
 * the board on click. No model needed — pure client.
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-search.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(800);
  await page.evaluate(() => {
    document.querySelector('.jz-boardentry')?.querySelector('button')?.click();
  });

  // ── Seed board 1 ("Kitchen reno") with a distinctive note, then board 2 ──
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'note-card',
      x: 100,
      y: 100,
      props: { text: 'ZANZIBAR-TILE quote from the contractor, 4400 EUR' },
    });
  });
  await sleep(1400); // let tldraw's throttled persister flush board 1
  await page.click('.jz-logo-btn');
  await page.waitForSelector('.jz-side');
  // Rename the first board so title-search is distinguishable from content.
  // (Match the exact board name — the Workspace section row is also a
  // .jz-side-item-name and would swallow a bare first-match dblclick.)
  await page.locator('.jz-side-item-name', { hasText: /^My workspace$/ }).dblclick();
  await page.fill('.jz-side-rename', 'Kitchen reno');
  await page.keyboard.press('Enter');
  await page.click('.jz-side-new'); // creates + switches to board 2, closes panel
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(800);
  await page.evaluate(() => {
    document.querySelector('.jz-boardentry')?.querySelector('button')?.click();
  });
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'note-card',
      x: 100,
      y: 100,
      props: { text: 'Board two talks about MARMALADE-FESTIVAL planning instead' },
    });
  });
  await sleep(1400);

  // ── Title search filters instantly ────────────────────────────────────────
  await page.click('.jz-logo-btn');
  await page.waitForSelector('.jz-side-search');
  await page.fill('.jz-side-search', 'kitchen');
  await sleep(700);
  const titleRows = await page.locator('.jz-side-row .jz-side-item-name').allTextContents();
  record(
    'title search filters the board list',
    titleRows.length === 1 && /kitchen/i.test(titleRows[0]),
    titleRows.join(' | '),
  );

  // ── Content search finds the UNMOUNTED board and shows a snippet ─────────
  await page.fill('.jz-side-search', 'zanzibar-tile');
  await sleep(900); // debounce + database read
  const hitRows = await page.locator('.jz-side-row .jz-side-item-name').allTextContents();
  const snippet = await page.locator('.jz-side-item-snippet').first().textContent().catch(() => '');
  record(
    'content search surfaces the unmounted board',
    hitRows.length === 1 && /kitchen/i.test(hitRows[0]),
    hitRows.join(' | '),
  );
  record('hit carries a content snippet', /ZANZIBAR-TILE/i.test(snippet ?? ''), snippet ?? 'none');
  await page.screenshot({ path: '/tmp/jz-search-hit.png' });

  // ── No-match state is honest ──────────────────────────────────────────────
  await page.fill('.jz-side-search', 'xylophone-quartz');
  await sleep(900);
  const emptyNote = await page.locator('.jz-side-note').textContent().catch(() => '');
  record('no-match state says so', /no boards match/i.test(emptyNote ?? ''), emptyNote ?? 'none');

  // ── Click a hit → switches to that board ─────────────────────────────────
  await page.fill('.jz-side-search', 'zanzibar-tile');
  await sleep(900);
  await page.click('.jz-side-row .jz-side-item');
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(900);
  const onBoard = await page.evaluate(() => {
    const notes = window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card');
    return notes.map((n) => n.props.text).join(' ');
  });
  record('clicking the hit switches to that board', /ZANZIBAR-TILE/.test(onBoard), onBoard.slice(0, 60));

  await page.close();
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
