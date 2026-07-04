/**
 * Typed table columns eval: cycle a column to PHOTO → empty cells offer an
 * upload → picking a real PNG lands it in the blob store and renders in the
 * cell (server mime-sniffing included). Cycle a column to LINK → leaving a
 * bare URL in a cell fetches the page title (stubbed here — the sandbox
 * blocks outbound web) and stores a [Title](url) chip. No model needed.
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-table-types.mjs
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

// A real 4×4 red PNG so the blob store's magic-byte sniffing has bytes to read.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8z4AATAxIgGocOAMAQaYBD1CBM60AAAAASUVORK5CYII=',
  'base64',
);

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(url)) return route.abort();
    // The sandbox blocks the outside web — stub the preview endpoint so the
    // CLIENT behavior (bare URL → titled link chip) is testable. The server
    // endpoint itself is the link card's existing, separately-proven path.
    if (url.includes('/api/link/preview')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Example Domain' }) });
    }
    return route.continue();
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(800);
  await page.evaluate(() => {
    document.querySelector('.jz-boardentry')?.querySelector('button')?.click();
  });

  // A trip-planning grid: Stop | Link | Photo.
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'table-card', x: 420, y: 140,
      props: {
        w: 560, h: 220,
        columns: ['Stop', 'Link', 'Photo'],
        rows: [['Sagrada Família', '', ''], ['Park Güell', '', '']],
      },
    });
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    window.editor.select(t.id);
    window.editor.setEditingShape(t.id);
    window.editor.zoomToFit({ animation: { duration: 0 } });
  });
  await sleep(700);

  // ── Cycle column types from the header button ────────────────────────────
  const typeButtons = page.locator('.jz-table-coltype');
  await typeButtons.nth(1).click(); // Link column: text → link
  await typeButtons.nth(2).click(); // Photo column: text → link
  await typeButtons.nth(2).click(); //               link → photo
  await sleep(400);
  const types = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    return t.props.columnTypes;
  });
  record(
    'header button cycles column types',
    JSON.stringify(types) === JSON.stringify(['text', 'link', 'photo']),
    JSON.stringify(types),
  );

  // ── Link column: bare URL + blur → titled link chip ──────────────────────
  const linkCell = page.locator('.jz-table-row').first().locator('.jz-table-input').nth(1);
  await linkCell.click();
  await linkCell.fill('https://example.com/tickets');
  await page.locator('.jz-table-row').first().locator('.jz-table-input').first().click(); // blur
  await sleep(800);
  const linkVal = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    return t.props.rows[0][1];
  });
  record(
    'bare URL becomes a titled link on blur',
    linkVal === '[Example Domain](https://example.com/tickets)',
    linkVal,
  );

  // ── Photo column: empty cell offers an upload; picking a PNG fills it ────
  await page.keyboard.press('Escape'); // leave edit mode → static cells
  await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    window.editor.select(t.id);
  });
  await sleep(500);
  const uploadOffered = await page.isVisible('.jz-table-cellupload');
  record('empty photo cell offers "+ Photo"', uploadOffered);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.locator('.jz-table-cellupload').first().click(),
  ]);
  await chooser.setFiles({ name: 'sagrada.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForFunction(
    () => {
      const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
      return /^!\[sagrada\.png\]\(\/api\/assets\//.test(t.props.rows[0][2] ?? '');
    },
    null,
    { timeout: 15_000 },
  );
  const imgRendered = await page.waitForSelector('.jz-table-img', { timeout: 5000 }).then(() => true).catch(() => false);
  record('picked photo uploads to the blob store and renders in the cell', imgRendered);

  // ── The stored bytes come back as image/png (mime sniffing) ─────────────
  const mime = await page.evaluate(async () => {
    const t = window.editor.getCurrentPageShapes().find((s) => s.type === 'table-card');
    const url = t.props.rows[0][2].match(/\((\/api\/assets\/[^)]+)\)/)[1];
    const res = await fetch(url);
    return res.headers.get('content-type');
  });
  record('asset store serves the photo as image/png', mime === 'image/png', mime ?? 'none');
  await page.screenshot({ path: '/tmp/jz-table-types.png' });

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
