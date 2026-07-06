/**
 * Eval — Canvas pivot P3 (native-canvas craft).
 * Run with preview + server up:  node scripts/eval-canvas-p3.mjs
 *
 *  A. "⤢ Tidy" appears for a connected multi-selection
 *  B. "⤢ Tidy" does NOT appear for an unconnected multi-selection
 *  C. Tidy aligns a messy connected chain into a clean column (same x, even gaps)
 *  D. Tidy is a single undo (positions restored)
 *  E. The "Flowchart" template seeds native shapes + connectors via onboarding
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

const clear = (page) =>
  page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });

// Seed three scattered boxes; optionally wire a→b→c with bound arrows.
const seedChain = (page, connect) =>
  page.evaluate((connect) => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const rich = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const a = mk(), b = mk(), c = mk();
    window.editor.createShape({ id: a, type: 'geo', x: 140, y: 120, props: { geo: 'rectangle', w: 150, h: 70, color: 'blue', fill: 'solid', richText: rich('A') } });
    window.editor.createShape({ id: b, type: 'geo', x: 560, y: 270, props: { geo: 'rectangle', w: 150, h: 70, color: 'blue', fill: 'solid', richText: rich('B') } });
    window.editor.createShape({ id: c, type: 'geo', x: 320, y: 430, props: { geo: 'rectangle', w: 150, h: 70, color: 'blue', fill: 'solid', richText: rich('C') } });
    if (connect) {
      const wire = (from, to) => {
        const arrow = mk();
        window.editor.createShape({ id: arrow, type: 'arrow', props: { size: 's' } });
        window.editor.createBindings([
          { id: 'binding:' + Math.random().toString(36).slice(2), type: 'arrow', fromId: arrow, toId: from, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
          { id: 'binding:' + Math.random().toString(36).slice(2), type: 'arrow', fromId: arrow, toId: to, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
        ]);
      };
      wire(a, b); wire(b, c);
    }
    window.__nodes = [a, b, c];
    return [a, b, c];
  }, connect);

const nodePositions = (page) =>
  page.evaluate(() =>
    window.__nodes.map((id) => {
      const b = window.editor.getShapePageBounds(id);
      return { x: Math.round(b.minX), y: Math.round(b.minY) };
    }),
  );

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // Open the action bar's Refine menu (idempotent) and return whether it lists "Tidy".
  const refineHasTidy = async () => {
    const refine = page.locator('.jz-cardbar-btn', { hasText: 'Refine' });
    if (!(await refine.count())) return false;
    if ((await page.locator('.jz-cardbar-menu').count()) === 0) { await refine.first().click(); await sleep(300); }
    return (await page.locator('.jz-cardbar-item', { hasText: 'Tidy' }).count()) > 0;
  };

  // ── B. No Tidy for an unconnected multi-selection ───────────────────────
  await clear(page);
  await seedChain(page, false);
  await page.evaluate(() => { window.editor.select(...window.__nodes); });
  await sleep(500);
  record('Tidy hidden for an unconnected selection', (await refineHasTidy()) === false);

  // ── A. Tidy appears for a connected selection ───────────────────────────
  await clear(page);
  await seedChain(page, true);
  await page.evaluate(() => { window.editor.select(...window.__nodes); });
  await sleep(500);
  const before = await nodePositions(page);
  const tidyVisible = await refineHasTidy(); // opens Refine; leaves it open
  record('Tidy appears for a connected selection', tidyVisible);
  await page.screenshot({ path: `${OUT}/jz-p3-before-tidy.png` });

  // ── C. Tidy aligns the chain into a clean column ────────────────────────
  if (tidyVisible) {
    await page.locator('.jz-cardbar-item', { hasText: 'Tidy' }).first().click();
    await sleep(900);
    await page.evaluate(() => { window.editor.selectNone(); });
    await sleep(300);
    const after = await nodePositions(page);
    // A 3-node chain → 3 rows, 1 col: equal x, strictly increasing, even y gaps.
    const xs = after.map((p) => p.x);
    const ys = after.map((p) => p.y).sort((a, b) => a - b);
    const sameX = Math.max(...xs) - Math.min(...xs) <= 2;
    const gap1 = ys[1] - ys[0];
    const gap2 = ys[2] - ys[1];
    const evenGaps = Math.abs(gap1 - gap2) <= 2 && gap1 > 0;
    record('Tidy aligns the chain into a clean column', sameX && evenGaps,
      `xs=${JSON.stringify(xs)} gaps=${gap1},${gap2}`);
    await page.screenshot({ path: `${OUT}/jz-p3-after-tidy.png` });

    // ── D. Single undo restores original positions ────────────────────────
    await page.evaluate(() => { window.editor.undo(); });
    await sleep(500);
    const restored = await nodePositions(page);
    const same = restored.every((p, i) => Math.abs(p.x - before[i].x) <= 2 && Math.abs(p.y - before[i].y) <= 2);
    record('Tidy is a single undo', same, JSON.stringify(restored));
  } else {
    record('Tidy aligns the chain into a clean column', false, 'no pill');
    record('Tidy is a single undo', false, 'no pill');
  }

  // ── E. Flowchart template seeds native shapes + connectors ──────────────
  await page.locator('.jz-board-chip').first().click();
  await sleep(300);
  await page.locator('.jz-bsw-new').click();
  await sleep(700);
  await page.locator('.jz-boardentry-input').fill('Release flow');
  await sleep(150);
  await page.locator('.jz-tpl-chip', { hasText: 'Flowchart' }).click();
  await sleep(150);
  await page.locator('.jz-boardentry-submit').click();
  await sleep(1300);
  const tpl = await page.evaluate(() => {
    const all = window.editor.getCurrentPageShapes();
    return { geo: all.filter((s) => s.type === 'geo').length, arrow: all.filter((s) => s.type === 'arrow').length };
  });
  record('Flowchart template seeds shapes + connectors', tpl.geo >= 3 && tpl.arrow >= 2,
    `geo=${tpl.geo} arrows=${tpl.arrow}`);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-p3-flowchart-template.png` });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} canvas-P3 checks passed`);
  writeFileSync(`${OUT}/jz-p3-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
