/**
 * Eval — Canvas pivot P0 (human primitives).
 * Run with preview + server up:  node scripts/eval-canvas-p0.mjs
 *
 * Checks:
 *  A. The primitive toolbar is present with all FigJam tools
 *  B. Clicking the rectangle tool activates tldraw's geo tool (toolbar → engine)
 *  C. Clicking the text tool activates the text tool
 *  D. Style panel is HIDDEN on an empty board with the select tool (calm)
 *  E. Style panel appears when a shape is selected
 *  F. Style panel appears when a creation tool is active, hides again on select
 *  G. tldraw UI icons are self-hosted (mask URL is local, not cdn.tldraw.com)
 *  H. Native primitives persist across a board switch (same guarantee as cards)
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
  // Block cdn.tldraw.com so a leaked CDN dependency would surface as broken icons.
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.includes('tldraw')) localStorage.removeItem(k);
      }
    } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1400);
  const skip = page.locator('.jz-boardentry-skip');
  if (await skip.count()) { await skip.click(); await sleep(300); }
  return page;
}

const toolId = (page) => page.evaluate(() => window.editor.getCurrentToolId());
const stylePanelCount = (page) => page.locator('.tlui-style-panel').count();
const seedGeo = (page) =>
  page.evaluate(() => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const rich = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const id = mk();
    window.editor.createShape({ id, type: 'geo', x: 300, y: 300, props: { geo: 'rectangle', w: 200, h: 110, color: 'blue', fill: 'solid', richText: rich('Idea') } });
    return id;
  });

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // ── A. Toolbar present with all FigJam tools ────────────────────────────
  const want = ['select', 'hand', 'text', 'rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'draw', 'frame', 'eraser'];
  const present = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.tlui-toolbar button[data-testid^="tools."]')]
      .map((b) => b.getAttribute('data-testid').replace('tools.', ''));
    return ids;
  });
  const missing = want.filter((w) => !present.includes(w));
  record('Primitive toolbar present with all tools', missing.length === 0, missing.length ? `missing: ${missing}` : `${want.length} tools`);

  // ── B. Rectangle tool activates the geo tool ────────────────────────────
  await page.locator('[data-testid="tools.rectangle"]').click();
  await sleep(250);
  const afterRect = await toolId(page);
  record('Rectangle tool activates geo tool', afterRect === 'geo', `tool=${afterRect}`);

  // ── C. Text tool activates the text tool ────────────────────────────────
  await page.locator('[data-testid="tools.text"]').click();
  await sleep(250);
  const afterText = await toolId(page);
  record('Text tool activates text tool', afterText === 'text', `tool=${afterText}`);

  // Back to select, clear any selection, for the calm baseline.
  await page.locator('[data-testid="tools.select"]').click();
  await page.evaluate(() => { window.editor.selectNone(); });
  await sleep(250);

  // ── D. Style panel hidden on empty board + select tool ──────────────────
  const hiddenWhenIdle = (await stylePanelCount(page)) === 0;
  record('Style panel hidden on empty board (calm)', hiddenWhenIdle);
  await page.screenshot({ path: `${OUT}/jz-p0-eval-empty.png` });

  // ── E. Style panel appears when a shape is selected ─────────────────────
  const gid = await seedGeo(page);
  await page.evaluate((id) => { window.editor.select(id); }, gid);
  await sleep(300);
  const shownWhenSelected = (await stylePanelCount(page)) === 1;
  record('Style panel appears on shape selection', shownWhenSelected);
  await page.screenshot({ path: `${OUT}/jz-p0-eval-selected.png` });

  // ── F. Style panel appears with a creation tool, hides on select+none ────
  await page.evaluate(() => { window.editor.selectNone(); });
  await page.locator('[data-testid="tools.ellipse"]').click();
  await sleep(300);
  const shownWhenCreating = (await stylePanelCount(page)) === 1;
  await page.locator('[data-testid="tools.select"]').click();
  await page.evaluate(() => { window.editor.selectNone(); });
  await sleep(300);
  const hiddenAgain = (await stylePanelCount(page)) === 0;
  record('Style panel shows for creation tool, hides on idle', shownWhenCreating && hiddenAgain,
    `creating=${shownWhenCreating} idleAfter=${hiddenAgain}`);

  // ── G. Icons self-hosted (not cdn.tldraw.com) ───────────────────────────
  const maskUrl = await page.evaluate(() => {
    const icon = document.querySelector('.tlui-toolbar .tlui-icon');
    if (!icon) return null;
    const cs = getComputedStyle(icon);
    return cs.maskImage || cs.webkitMaskImage || null;
  });
  const selfHosted = !!maskUrl && !maskUrl.includes('cdn.tldraw.com') && maskUrl.includes('/assets/');
  record('tldraw UI icons are self-hosted', selfHosted, maskUrl ? maskUrl.slice(0, 70) : 'no icon');

  // ── H. Native primitives persist across a board switch ──────────────────
  // Ensure a known geo exists on this board, switch to a new board, switch back.
  const beforeGeo = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'geo').length);
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-new').click();
  await sleep(700);
  const entry = page.locator('.jz-boardentry-skip');
  if (await entry.count()) { await entry.click(); await sleep(500); }
  // Switch back to the original board.
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-name').first().click();
  await sleep(1200);
  const afterGeo = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'geo').length);
  record('Native primitives persist across board switch', afterGeo === beforeGeo && beforeGeo > 0,
    `geo: ${beforeGeo} → ${afterGeo}`);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} canvas-P0 checks passed`);
  writeFileSync(`${OUT}/jz-p0-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
