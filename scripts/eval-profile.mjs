/**
 * Drop-moment profile eval (docs/PDF-EDGE.md build 3 / ROADMAP §10 #3).
 * Drives the REAL flow in a browser against the preview build: a genuine
 * DragEvent drop (exercising ingestion + upload), the offer chip, dismissal,
 * re-offer on a fresh drop, and accepting — which must stream a profile doc
 * card with a provenance edge via the ordinary Ask pipeline (needs a model:
 * API key or the Claude CLI sidecar; the streamed section can take a minute).
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-profile.mjs
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

/** Dispatch a real drop of a PDF onto the canvas — the true ingestion path. */
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
  await sleep(600);
  await page.evaluate(() => {
    document.querySelector('.jz-boardentry')?.querySelector('.jz-boardentry-skip, button')?.click();
  });

  const pdfB64 = readFileSync('scripts/eval-pdfs/research-paper.pdf').toString('base64');

  // ── 1. Drop → card ready → offer chip appears ────────────────────────────
  await dropPdf(page, pdfB64, 'research-paper.pdf');
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().some((s) => s.type === 'pdf-card' && s.props.status === 'ready'),
    null,
    { timeout: 30_000 },
  );
  const chipSeen = await page
    .waitForSelector('.jz-profile-offer', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  record('drop moment: PDF lands ready and the profile chip offers', chipSeen);
  await page.screenshot({ path: '/tmp/jz-profile-offer.png' });

  // ── 2. ✕ declines quietly ────────────────────────────────────────────────
  await page.click('.jz-profile-offer-x');
  const goneAfterX = await page.waitForSelector('.jz-profile-offer', { state: 'detached', timeout: 3000 }).then(() => true).catch(() => false);
  record('✕ dismisses the offer', goneAfterX);

  // ── 3. A fresh drop offers again ─────────────────────────────────────────
  await page.keyboard.press('Escape');
  await dropPdf(page, pdfB64, 'research-paper-2.pdf');
  const reOffered = await page
    .waitForSelector('.jz-profile-offer', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  record('a fresh drop re-offers', reOffered);

  // ── 4. Accept → streamed profile doc card with provenance edge ──────────
  const before = await page.evaluate(() => ({
    docs: window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length,
    arrows: window.editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').length,
  }));
  await page.click('.jz-profile-offer-main');
  const chipGoneOnRun = await page.waitForSelector('.jz-profile-offer', { state: 'detached', timeout: 3000 }).then(() => true).catch(() => false);
  record('accepting consumes the offer', chipGoneOnRun);

  await page.waitForSelector('.jz-draft-keep', { timeout: 180_000 });
  const profile = await page.evaluate(() => {
    const docs = window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card');
    const d = docs[docs.length - 1];
    return d ? { text: d.props.text, title: d.props.title } : null;
  });
  const arrowsAfter = await page.evaluate(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').length,
  );
  record(
    'profile streams into a doc card',
    Boolean(profile && profile.text.length > 200 && profile.title.length > 0),
    profile ? `${profile.text.length} chars, title "${profile.title}"` : 'no doc card',
  );
  record(
    'profile card is structured (What this is / Red flags / questions)',
    Boolean(profile && /what this is/i.test(profile.text) && /red flags/i.test(profile.text)),
  );
  record('provenance edge drawn from the PDF', arrowsAfter > before.arrows, `${before.arrows} → ${arrowsAfter}`);
  await page.screenshot({ path: '/tmp/jz-profile-card.png' });
  await page.click('.jz-draft-keep');
  await sleep(400);

  // ── 5. The durable path: Refine menu on a PDF card ──────────────────────
  await page.evaluate(() => {
    const pdf = window.editor.getCurrentPageShapes().find((s) => s.type === 'pdf-card');
    if (pdf) window.editor.select(pdf.id);
  });
  await page.waitForSelector('.jz-cardbar', { timeout: 5000 });
  await page.click('.jz-cardbar-btn');
  const inMenu = await page.isVisible('text=Profile this document');
  record('Refine menu keeps the durable "Profile this document" path', inMenu);

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
