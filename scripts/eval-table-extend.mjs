/**
 * The owner's table-extension flow, end to end (needs a model):
 * drop a PDF → ask for a comparison → the answer lands as a table → SELECT it
 * (not edit) → the edge + strip is already there → click it → a new empty
 * column appears and the card enters edit mode → name the column → Tab →
 * Jarwiz fills the new cells from the PDF.
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-table-extend.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function dropPdf(page, b64, name) {
  await page.evaluate(
    ({ b64, name }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: 'application/pdf' }));
      const target = document.querySelector('.tl-container');
      const r = target.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt };
      target.dispatchEvent(new DragEvent('dragover', opts));
      target.dispatchEvent(new DragEvent('drop', opts));
    },
    { b64, name },
  );
}

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

  // ── Drop the PDF, ask for a comparison ────────────────────────────────────
  const pdfB64 = readFileSync('scripts/eval-pdfs/research-paper.pdf').toString('base64');
  await dropPdf(page, pdfB64, 'research-paper.pdf');
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().some((s) => s.type === 'pdf-card' && s.props.status === 'ready'),
    null,
    { timeout: 30_000 },
  );
  await page.fill('.jz-promptbar-input', 'Compare trace-based and method-based compilation side by side.');
  await page.focus('.jz-promptbar-input');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.jz-draft-keep', { timeout: 180_000 });
  await page.click('.jz-draft-keep');
  await sleep(600);

  // ── The kept table is SELECTED — the + strips must already be there ──────
  const state0 = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    return t
      ? { cols: t.props.columns.length, rows: t.props.rows.length, selected: window.editor.getOnlySelectedShapeId() === t.id }
      : null;
  });
  record('comparison lands as a table, selected', Boolean(state0?.selected), state0 ? `${state0.cols} cols` : 'none');
  const stripVisible = await page.isVisible('.jz-table-edgeadd-col');
  record('add-column strip is available WITHOUT entering edit mode', stripVisible);

  // ── Click + → column added, edit mode begins ─────────────────────────────
  await page.click('.jz-table-edgeadd-col');
  await sleep(500);
  const state1 = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    return { cols: t.props.columns.length, editing: window.editor.getEditingShapeId() === t.id };
  });
  record(
    'click adds the column and enters edit mode',
    state1.cols === (state0?.cols ?? 0) + 1 && state1.editing,
    `${state0?.cols} → ${state1.cols} cols, editing=${state1.editing}`,
  );

  // ── Name the new aspect, then Tab lets Jarwiz fill it from the PDF ───────
  const lastHeader = page.locator('.jz-table-headcell-edit .jz-table-input').last();
  await lastHeader.click();
  await lastHeader.fill('Memory cost');
  const lastCell = page.locator('.jz-table-row').first().locator('.jz-table-input').last();
  await lastCell.click();
  await page.keyboard.press('Tab');
  const filled = await page
    .waitForFunction(
      () => {
        const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
        if (!t) return false;
        const lastCol = t.props.columns.length - 1;
        const vals = t.props.rows.map((r) => (r[lastCol] ?? '').trim());
        return vals.filter(Boolean).length >= Math.max(1, Math.floor(vals.length / 2));
      },
      null,
      { timeout: 180_000 },
    )
    .then(() => true)
    .catch(() => false);
  const finalCol = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    const lastCol = t.props.columns.length - 1;
    return { name: t.props.columns[lastCol], sample: (t.props.rows[0]?.[lastCol] ?? '').slice(0, 60) };
  });
  record('Tab autofills the new column from the document', filled, `"${finalCol.name}": ${finalCol.sample}`);
  await page.screenshot({ path: '/tmp/jz-table-extend.png' });

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
