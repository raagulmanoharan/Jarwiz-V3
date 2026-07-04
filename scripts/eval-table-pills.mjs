/**
 * Format-aware pills eval: a card holding two comparable concepts must yield
 * a contextual pill that proposes COMPARING them, phrased so the answer lands
 * as a comparison table (pickShape routes compare/versus wording to 'table').
 * Needs a model (API key or sidecar) — pills and the answer are generated.
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-table-pills.mjs
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

  // A card that plainly holds two comparable approaches.
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'doc-card',
      x: 200,
      y: 140,
      props: {
        title: 'Rendering strategy',
        text: 'We are weighing two rendering strategies for the canvas. Server-side rendering pre-renders every card on the API and ships HTML — fast first paint, but every interaction round-trips. Client-side rendering ships a bundle and renders locally — slower cold start, instant interactions, works offline. The team must pick one for the beta.',
      },
    });
    const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
    window.editor.select(d.id);
  });

  // ── Pills arrive; one proposes the comparison ────────────────────────────
  await page.waitForSelector('button.jz-pb-chip', { timeout: 60_000 }).catch(async (e) => { const st = await page.evaluate(() => ({ sel: window.editor.getSelectedShapeIds().length, shim: Boolean(document.querySelector('.jz-pb-chip--wait')), chips: document.querySelectorAll('.jz-pb-chip').length, dock: document.querySelector('.jz-promptbar-dock')?.outerHTML.slice(0,400) })); console.log('TIMEOUT STATE', JSON.stringify(st)); throw e; });
  await sleep(400);
  const labels = await page.locator('button.jz-pb-chip').allTextContents();
  const compareIdx = labels.findIndex((l) => /\b(compare|vs\.?|versus)\b/i.test(l));
  record(
    'a pill proposes comparing the two concepts',
    compareIdx >= 0,
    labels.join(' | '),
  );

  // ── Its prompt is phrased to land as a table ─────────────────────────────
  await page.locator('button.jz-pb-chip').nth(Math.max(0, compareIdx)).click();
  const prompt = await page.inputValue('.jz-promptbar-input');
  record(
    "the pill's prompt uses comparison wording (routes to the table shape)",
    /\b(compare|comparison|versus|vs\.?|side by side)\b/i.test(prompt),
    prompt.slice(0, 90),
  );

  // ── Submitting it produces a table card ──────────────────────────────────
  await page.focus('.jz-promptbar-input');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.jz-draft-keep', { timeout: 180_000 });
  const table = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    return t ? { columns: t.props.columns, rows: t.props.rows.length } : null;
  });
  record(
    'the answer lands as a comparison table',
    Boolean(table && table.columns.length >= 2 && table.rows >= 2),
    table ? `${table.columns.length} cols × ${table.rows} rows: ${table.columns.join(' / ')}` : 'no table card',
  );
  await page.screenshot({ path: '/tmp/jz-compare-pill-table.png' });
  await page.click('.jz-draft-keep');

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
