/**
 * Eval — Canvas pivot P0 (human primitives), via the right-edge ToolRail.
 * Run with preview + server up:  node scripts/eval-canvas-p0.mjs
 *
 *  A. The rail is present with all FigJam tools
 *  B. The rectangle tool activates tldraw's geo tool (rail → engine)
 *  C. The text tool activates the text tool
 *  D. Style panel HIDDEN on an empty board with the select tool (calm)
 *  E. Style panel appears when a shape is selected
 *  F. Style panel appears when a creation tool is active, hides again on select
 *  G. The style panel's tldraw icons are self-hosted (mask URL local, not cdn)
 *  H. Native primitives persist across a board switch
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
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url()) ? route.abort() : route.continue());
  await page.addInitScript(() => {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.includes('tldraw')) localStorage.removeItem(k); } catch {}
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
// Rail buttons sit at the screen edge; JS-click to avoid actionability flakiness.
const railClick = (page, name) => page.evaluate((n) => { document.querySelector(`[data-testid="rail.${n}"]`)?.click(); }, name);
const seedGeo = (page) => page.evaluate(() => {
  const mk = () => 'shape:' + Math.random().toString(36).slice(2);
  const rich = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  const id = mk();
  window.editor.createShape({ id, type: 'geo', x: 300, y: 300, props: { geo: 'rectangle', w: 200, h: 110, color: 'blue', fill: 'solid', richText: rich('Idea') } });
  return id;
});

async function run() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await open();

  // ── A. Rail present with all tools ──────────────────────────────────────
  const want = ['select', 'hand', 'text', 'rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'draw', 'frame', 'eraser', 'doc', 'note'];
  const present = await page.evaluate(() => [...document.querySelectorAll('.jz-rail [data-testid^="rail."]')].map((b) => b.getAttribute('data-testid').replace('rail.', '')));
  const missing = want.filter((w) => !present.includes(w));
  record('Tool rail present with all tools', missing.length === 0, missing.length ? `missing: ${missing}` : `${want.length} tools`);

  // ── B. Rectangle → geo ──────────────────────────────────────────────────
  await railClick(page, 'rectangle');
  await sleep(250);
  record('Rectangle tool activates geo tool', (await toolId(page)) === 'geo', `tool=${await toolId(page)}`);

  // ── C. Text → text ──────────────────────────────────────────────────────
  await railClick(page, 'text');
  await sleep(250);
  record('Text tool activates text tool', (await toolId(page)) === 'text', `tool=${await toolId(page)}`);

  await railClick(page, 'select');
  await page.evaluate(() => { window.editor.selectNone(); });
  await sleep(250);

  // ── D. Style panel hidden on empty board + select ───────────────────────
  record('Style panel hidden on empty board (calm)', (await stylePanelCount(page)) === 0);
  await page.screenshot({ path: `${OUT}/jz-p0-eval-empty.png` });

  // ── E. Style panel appears on selection ─────────────────────────────────
  const gid = await seedGeo(page);
  await page.evaluate((id) => { window.editor.select(id); }, gid);
  await sleep(300);
  record('Style panel appears on shape selection', (await stylePanelCount(page)) === 1);

  // ── G. Style panel icons self-hosted (shape is selected now) ────────────
  const maskUrl = await page.evaluate(() => {
    const icon = document.querySelector('.tlui-style-panel .tlui-icon, .tlui-style-panel [style*="mask"]');
    if (!icon) return null;
    const cs = getComputedStyle(icon);
    return cs.maskImage || cs.webkitMaskImage || null;
  });
  record('Style panel icons are self-hosted', !maskUrl || (!maskUrl.includes('cdn.tldraw.com')), maskUrl ? maskUrl.slice(0, 60) : 'no masked icon (ok)');

  // ── F. Creation tool shows panel, idle hides it ─────────────────────────
  await page.evaluate(() => { window.editor.selectNone(); });
  await railClick(page, 'ellipse');
  await sleep(300);
  const shownWhenCreating = (await stylePanelCount(page)) === 1;
  await railClick(page, 'select');
  await page.evaluate(() => { window.editor.selectNone(); });
  await sleep(300);
  const hiddenAgain = (await stylePanelCount(page)) === 0;
  record('Style panel shows for creation tool, hides on idle', shownWhenCreating && hiddenAgain, `creating=${shownWhenCreating} idle=${hiddenAgain}`);

  // ── H. Native primitives persist across a board switch ──────────────────
  const beforeGeo = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'geo').length);
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-new').click();
  await sleep(700);
  const entry = page.locator('.jz-boardentry-skip');
  if (await entry.count()) { await entry.click(); await sleep(500); }
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-name').first().click();
  await sleep(1200);
  const afterGeo = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'geo').length);
  record('Native primitives persist across board switch', afterGeo === beforeGeo && beforeGeo > 0, `geo: ${beforeGeo} → ${afterGeo}`);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} canvas-P0 checks passed`);
  writeFileSync(`${OUT}/jz-p0-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
