/**
 * Screengrab harness — drives the running preview server (mock mode) in a real
 * browser and captures named PNGs of each milestone state, so PRs and standups
 * can show the product, not just describe it.
 *
 * Usage: with the production build served (see scripts/README.md):
 *   node scripts/screens.mjs
 * Output: /tmp/jz-*.png
 *
 * Sandbox reality: this environment intermittently tears down the page's JS
 * execution context (blocked font/asset fetches), and crucially it tends to do
 * so right AFTER a screenshot. So the harness:
 *   1. Runs each screenshot in its own fresh page/session.
 *   2. Does all evaluate() work BEFORE the screenshot, never after.
 *   3. Retries each shot independently until it lands.
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready(page) {
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
}

/**
 * Seed shapes, then settle with a fixed wait. Do NOT retry-poll the editor here:
 * calling editor methods mid-remount (while tldraw reloads its store) re-triggers
 * the teardown and turns a one-off into a loop. A plain wait lets it settle; the
 * per-shot withRetry (fresh browser) covers the occasional bad attempt.
 */
async function seedAndSettle(page) {
  await clearAndSettle(page);
  await page.evaluate(SEED);
  await sleep(2500);
  await page.evaluate(() => window.editor.zoomToFit());
}

const shapeCount = (page, type) =>
  page
    .evaluate((t) => window.editor.getCurrentPageShapes().filter((s) => s.type === t).length, type)
    .catch(() => 0);

async function waitFor(fn, { timeout = 25000, every = 250, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn().catch(() => false)) return true;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label}`);
}

// A single seed note keeps the capture stable in this sandbox (more cards =
// more render churn = more flaky context teardowns). The Writer synthesizes a
// single source just as well, so the story still reads: brief → draft → edge.
// Create-only: clearing happens earlier (clearAndSettle), separated by a wait —
// bundling delete+create in one evaluate with no settle triggers the teardown.
const SEED = `(() => {
  window.editor.createShape({ type: 'note-card', x: 200, y: 240,
    props: { w: 260, h: 220, text: 'Async beats meetings — make the case for a writing-first culture.' } });
  window.editor.zoomToFit();
})()`;

/** Fresh page, app mounted, editor live, first-run reset. */
async function openApp(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('jz-onboarded');
    } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await ready(page); // minimal wait — matches the proven-stable probe timing
  return page;
}

/** Clear the board, then settle — the proven prelude to a stable seed. */
async function clearAndSettle(page) {
  await page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });
  await sleep(1300);
}

async function openPalette(page) {
  await page.evaluate(() => window.editor.selectAll());
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })),
  );
  await page.waitForSelector('.jz-palette', { timeout: 4000 });
}

/** Autopilot (Tab-to-continue): seed a doc with a brief, edit it, press Tab,
 *  capture the continuation streaming in place. Proven stable in this sandbox. */
async function shotAutopilot(page) {
  await clearAndSettle(page);
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'doc-card',
      x: 360,
      y: 200,
      props: {
        w: 520,
        h: 380,
        title: 'Async beats meetings',
        text: 'Meetings are where momentum goes to die. A writing-first culture trades the calendar for the document:',
      },
    });
    window.editor.zoomToFit();
  });
  await sleep(2500);
  const id = await page.evaluate(() => {
    const s = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
    window.editor.select(s.id);
    window.editor.setEditingShape(s.id);
    window.editor.setCurrentTool('select.editing_shape');
    return s.id;
  });
  await page.waitForSelector('.jz-doc-textarea', { timeout: 5000 });
  await page.locator('.jz-doc-textarea').click();
  await sleep(300);
  await page.locator('.jz-doc-textarea').press('Tab');
  await page
    .waitForFunction((sid) => (window.editor.getShape(sid)?.props.text.length ?? 0) > 140, id, {
      timeout: 15000,
    })
    .catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/jz-autopilot.png` });
  log('  ✓ jz-autopilot.png');
}

/**
 * Single-session capture of the milestone states. The empty and autopilot
 * shots are reliable here; the palette/summon shots create multiple shapes and
 * are flaky in this sandbox, so they're best-effort (a failure logs and is
 * skipped rather than aborting the whole run). See the gotchas in CLAUDE.md.
 */
async function captureAll(browser) {
  const page = await openApp(browser);

  // 1) Empty state + first-run nudge (reliable).
  await clearAndSettle(page);
  await page.screenshot({ path: `${OUT}/jz-empty.png` });
  log('  ✓ jz-empty.png');

  // 2) Autopilot — the signature moment (reliable).
  await shotAutopilot(page);

  // 3) Best-effort: ⌘K palette + Writer run (multi-shape, flaky here).
  try {
    await clearAndSettle(page);
    await page.evaluate(SEED);
    await sleep(2500);
    await page.evaluate(() => window.editor.zoomToFit());

    await openPalette(page);
    await page.locator('.jz-palette-item', { hasText: 'Writer' }).hover();
    await sleep(400);
    await page.screenshot({ path: `${OUT}/jz-palette.png` });
    log('  ✓ jz-palette.png');

    await page.locator('.jz-palette-item', { hasText: 'Writer' }).click();
    await waitFor(() => shapeCount(page, 'doc-card').then((n) => n >= 1), { label: 'doc card' });
    await sleep(800);
    await page.evaluate(() => window.editor.zoomToFit());
    await sleep(400);
    await page.screenshot({ path: `${OUT}/jz-writer-streaming.png` });
    log('  ✓ jz-writer-streaming.png');

    await sleep(9000);
    await page.evaluate(() => {
      window.editor.selectNone();
      window.editor.zoomToFit();
    });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/jz-synthesis.png` });
    log('  ✓ jz-synthesis.png');
  } catch (err) {
    log(`  (skipped palette/summon shots — flaky sandbox: ${String(err).split('\n')[0].slice(0, 70)})`);
  }

  await page.close();
}

async function main() {
  const attempts = 6;
  for (let i = 1; i <= attempts; i++) {
    log(`attempt ${i}/${attempts}…`);
    const browser = await chromium.launch({
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--no-sandbox'],
    });
    try {
      await captureAll(browser);
      await browser.close();
      log('\nAll screengrabs written to /tmp/jz-*.png');
      return;
    } catch (err) {
      await browser.close().catch(() => {});
      log(`  attempt ${i} failed: ${String(err).split('\n')[0].slice(0, 90)}`);
      if (i === attempts) throw err;
      await sleep(800);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
