/**
 * Eval — full table editing. Drives the preview build and exercises every
 * table function on a table card: enter edit mode, add a column, add a row,
 * edit a header and a cell, then delete a column and a row. Deterministic
 * (no model calls). Run with preview up:  node scripts/eval-table.mjs
 */

import { createRequire } from 'node:module';

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
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url()) ? route.abort() : route.continue(),
  );
  await page.addInitScript(() => { try { localStorage.removeItem('jz-onboarded'); } catch {} });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);
  return page;
}
const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const props = (page, id) => page.evaluate((i) => window.editor.getShape(i)?.props, id);

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();
  await page.evaluate(() => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });

  const id = nid();
  await page.evaluate((i) => {
    window.editor.createShape({
      id: i, type: 'table-card', x: 200, y: 200,
      props: { w: 560, h: 220, columns: ['Option', 'Cost', 'Speed'], rows: [['A', '$10', 'Fast'], ['B', '$25', 'Faster']] },
    });
  }, id);
  await sleep(500);
  await page.evaluate((i) => { window.editor.select(i); window.editor.setEditingShape(i); }, id);
  await sleep(900);

  const editing = (await page.locator('.jz-table-del-col').count().catch(() => 0)) > 0;
  record('table enters edit mode (delete affordances visible)', editing);

  let p = await props(page, id);
  const cols0 = p.columns.length, rows0 = p.rows.length;

  // Add a column.
  await page.click('.jz-table-edgeadd-col');
  await sleep(500);
  p = await props(page, id);
  record('add column', p.columns.length === cols0 + 1, `${cols0} → ${p.columns.length}`);

  // Add a row.
  await page.click('.jz-table-edgeadd-row');
  await sleep(500);
  p = await props(page, id);
  record('add row', p.rows.length === rows0 + 1, `${rows0} → ${p.rows.length}`);

  // Edit a header cell.
  const head0 = page.locator('.jz-table-headcell-edit .jz-table-input').first();
  await head0.click();
  await head0.fill('Plan');
  await sleep(400);
  p = await props(page, id);
  record('edit a header', p.columns[0] === 'Plan', `columns[0]="${p.columns[0]}"`);

  // Edit a body cell.
  const cell0 = page.locator('.jz-table-cell.jz-table-input').first();
  await cell0.click();
  await cell0.fill('Hello');
  await sleep(400);
  p = await props(page, id);
  record('edit a cell', p.rows[0][0] === 'Hello', `rows[0][0]="${p.rows[0][0]}"`);

  await page.screenshot({ path: `${OUT}/jz-table-editing.png` });

  // Delete a column (the first ×).
  const colsBeforeDel = p.columns.length;
  await page.locator('.jz-table-del-col').first().click();
  await sleep(500);
  p = await props(page, id);
  record('delete a column', p.columns.length === colsBeforeDel - 1 && p.rows.every((r) => r.length === colsBeforeDel - 1), `${colsBeforeDel} → ${p.columns.length} (rows trimmed: ${p.rows.every((r) => r.length === p.columns.length)})`);

  // Delete a row (the first ×).
  const rowsBeforeDel = p.rows.length;
  await page.locator('.jz-table-del-row').first().click();
  await sleep(500);
  p = await props(page, id);
  record('delete a row', p.rows.length === rowsBeforeDel - 1, `${rowsBeforeDel} → ${p.rows.length}`);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} table checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
