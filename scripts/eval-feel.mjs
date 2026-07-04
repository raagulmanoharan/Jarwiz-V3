/**
 * Feel-pass eval (ROADMAP §10 #4): the quiet gap shimmers, and pdf.js loads
 * lazily without breaking the reader.
 *
 *  1. Cold load must NOT fetch the pdf.js chunk (it's out of the main bundle).
 *  2. Dropping a PDF shows shimmer placeholder pills while tailored seed pills
 *     generate, then swaps in the real pills (needs a model for the swap).
 *  3. The reader still renders: the lazy chunk loads on demand and paints the
 *     first page to the card's canvas.
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-feel.mjs
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
  const jsFetches = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'script' || req.url().endsWith('.mjs')) jsFetches.push(req.url());
  });
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(1000);
  await page.evaluate(() => {
    document.querySelector('.jz-boardentry')?.querySelector('button')?.click();
  });

  // ── 1. Cold load leaves pdf.js on the shelf ──────────────────────────────
  const coldPdfjs = jsFetches.filter((u) => /pdf/i.test(u));
  record('cold load fetches no pdf.js chunk', coldPdfjs.length === 0, coldPdfjs.join(', ') || 'clean');

  // ── 2. Drop → shimmer while pills generate → real pills swap in ─────────
  const pdfB64 = readFileSync('scripts/eval-pdfs/research-paper.pdf').toString('base64');
  await dropPdf(page, pdfB64, 'research-paper.pdf');
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().some((s) => s.type === 'pdf-card' && s.props.status === 'ready'),
    null,
    { timeout: 30_000 },
  );
  const shimmer = await page
    .waitForSelector('.jz-pb-chip--wait', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  record('shimmer pills fill the quiet gap', shimmer);
  await page.screenshot({ path: '/tmp/jz-feel-shimmer.png' });

  const realPills = await page
    .waitForSelector('button.jz-pb-chip', { timeout: 120_000 })
    .then(() => true)
    .catch(() => false);
  const shimmerGone = await page
    .waitForSelector('.jz-pb-chip--wait', { state: 'detached', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  record('real pills swap the shimmer out', realPills && shimmerGone);
  await page.screenshot({ path: '/tmp/jz-feel-pills.png' });

  // ── 3. The lazy reader still paints ──────────────────────────────────────
  const lazyPdfjs = jsFetches.filter((u) => /pdf/i.test(u));
  record('pdf.js chunk loaded on demand for the reader', lazyPdfjs.length > 0, `${lazyPdfjs.length} fetch(es)`);
  const painted = await page
    .waitForFunction(
      () => {
        const c = document.querySelector('.jz-pdf-canvas');
        return c && c.width > 100 && c.height > 100;
      },
      null,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  record('first page renders to the card canvas', painted);

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
