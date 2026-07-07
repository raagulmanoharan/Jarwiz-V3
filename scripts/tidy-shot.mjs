/**
 * Tidy Up spike — before/after capture. Seeds a deliberately messy scatter of
 * cards (varied sizes, big vertical + horizontal gaps), shoots it, clicks the
 * global tidy button, then shoots the masonry-packed result.
 *
 * Follows the sandbox gotchas in CLAUDE.md: production build via preview, every
 * evaluate() returns undefined (never the chainable Editor), work-before-shot.
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = `(() => {
  const e = window.editor;
  e.getCurrentPageShapes().length && e.deleteShapes(e.getCurrentPageShapes().map(s => s.id));
  const mk = (type, x, y, props) => e.createShape({ type, x, y, props });
  // Left column: a tall doc + a note stranded far below (vertical gap to close).
  mk('doc-card',  40,  40, { w: 416, h: 300, title: 'Brief', text: 'Async beats meetings — the case for writing-first.' });
  mk('note-card', 60, 760, { w: 220, h: 220, text: 'Follow-up: pilot with the design team first.' });
  // Middle column: two cards with a gap between them.
  mk('link-card', 620, 120, { w: 320, h: 300, url: 'https://example.com', title: 'Reference', description: 'A source link.' });
  mk('note-card', 660, 620, { w: 220, h: 220, text: 'Counterpoint: sync is better for conflict.' });
  // Right column: one wide table pushed way out.
  mk('doc-card', 1200, 300, { w: 500, h: 260, title: 'Draft', text: 'Section one of the synthesis goes here.' });
  e.zoomToFit();
})()`;

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (r) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(r.request().url()) ? r.abort() : r.continue(),
  );
  await page.addInitScript(() => { try { localStorage.removeItem('jz-onboarded'); } catch {} });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });

  await page.evaluate(SEED);
  await sleep(2500);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/jz-tidy-before.png` });
  console.log('  ✓ jz-tidy-before.png');

  // Click the global tidy button (frames the result via zoomToBounds).
  await page.locator('.jz-tidy-btn').click();
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/jz-tidy-after.png` });
  console.log('  ✓ jz-tidy-after.png');

  await page.close();
  await browser.close();
}
main().catch((e) => { console.error(String(e).split('\n')[0]); process.exit(1); });
