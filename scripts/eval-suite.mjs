/**
 * Comprehensive eval suite — drives the running preview build in a real browser
 * and asserts the user-facing surface we've built: sticky notes, the Ask
 * response shapes (doc / list+checklist / table / diagram / affinity), in-place
 * regeneration, and the diagram "render whole, no expand" rule.
 *
 * Two tiers:
 *   A. CLIENT RENDERING — seed shapes directly (fast, deterministic). Proves the
 *      cards render/behave without waiting on the model.
 *   B. SERVER ROUTING — handled by curl in the runner, not here.
 *
 * Sandbox rules (see eval-ui.mjs): every editor-mutating evaluate returns
 * undefined (never the chainable Editor), and CDN fonts are blocked.
 * Run with preview + server up:  node scripts/eval-suite.mjs
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
  results.push({ name, ok, detail });
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
      localStorage.removeItem('jz-onboarded');
      localStorage.removeItem('jz-comments');
    } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);
  return page;
}
const clear = (page) =>
  page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });
const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const seed = (page, spec) => page.evaluate((s) => { window.editor.createShape(s); }, spec);
const select = (page, id) => page.evaluate((i) => { window.editor.select(i); }, id);
const fit = (page) => page.evaluate(() => { window.editor.zoomToFit(); });
const propOf = (page, id, key) =>
  page.evaluate(({ i, k }) => window.editor.getShape(i)?.props?.[k], { i: id, k: key }).catch(() => undefined);
const heightOf = (page, id) => propOf(page, id, 'h');

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // ── 1. Empty state / onboarding renders ──────────────────────────────────
  await clear(page);
  await sleep(500);
  const emptyVisible = await page.locator('text=/Jarwiz|drop|drag|paste|start/i').count().catch(() => 0);
  record('empty board renders chrome (topbar/onboarding)', emptyVisible > 0);
  await page.screenshot({ path: `${OUT}/jz-suite-empty.png` });

  // ── 2. Sticky-note primitive: "n" key + dock button ──────────────────────
  await clear(page);
  await page.mouse.move(700, 450);
  await page.keyboard.press('n');
  await sleep(800);
  const noteAfterKey = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length);
  record('"n" key drops a sticky note', noteAfterKey >= 1, `${noteAfterKey} note(s)`);
  await page.keyboard.press('Escape');
  await clear(page);
  const dockBtn = page.locator('.jz-dock-btn');
  const haveDock = (await dockBtn.count()) > 0;
  // The dock sits bottom-left where tldraw's navigation panel also lives, so a
  // real click is intercepted (dockBlocked). The handler itself is fine — prove
  // that with a direct DOM click — but the overlap is a real usability bug.
  let dockBlocked = false;
  if (haveDock) {
    try {
      await dockBtn.click({ timeout: 3000 });
    } catch {
      dockBlocked = true;
    }
  }
  await sleep(600);
  let noteAfterDock = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length);
  if (noteAfterDock === 0 && haveDock) {
    await page.$eval('.jz-dock-btn', (el) => el.click());
    await sleep(600);
    noteAfterDock = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length);
  }
  record('dock button handler drops a sticky note', haveDock && noteAfterDock >= 1, `${noteAfterDock} note(s)`);
  record('dock button reachable (not overlapped by tldraw nav panel)', !dockBlocked, dockBlocked ? 'FINDING: nav panel intercepts clicks' : 'clear');
  await page.keyboard.press('Escape');

  // ── 3. Doc card markdown + checklist toggle ──────────────────────────────
  await clear(page);
  const docId = nid();
  await seed(page, {
    id: docId, type: 'doc-card', x: 200, y: 200,
    props: {
      w: 520, h: 360, title: 'Launch checklist', sourcePdfId: '',
      text: '## Pre-launch\n\n- [ ] Finalise pricing\n- [ ] Security review\n- [x] Draft announcement\n\nShip when all are green.',
    },
  });
  await sleep(800);
  await fit(page);
  await sleep(400);
  const checkboxes = await page.locator('.jz-md-checkbox').count().catch(() => 0);
  record('doc card renders task list as checkboxes', checkboxes === 3, `${checkboxes} checkboxes`);
  const heading = await page.locator('.jz-doc-content h2, .jz-doc-content h1').count().catch(() => 0);
  record('doc card renders markdown headings', heading >= 1);
  // Toggle the first unchecked box → source text flips to [x].
  const firstBox = page.locator('.jz-md-checkbox').first();
  await firstBox.click().catch(() => {});
  await sleep(600);
  const txt = await propOf(page, docId, 'text');
  record('toggling a checkbox rewrites the source line', /- \[x\] Finalise pricing/i.test(txt ?? ''), '');
  await page.screenshot({ path: `${OUT}/jz-suite-checklist.png` });

  // ── 4. Table card renders a grid ─────────────────────────────────────────
  await clear(page);
  const tableId = nid();
  await seed(page, {
    id: tableId, type: 'table-card', x: 200, y: 200,
    props: {
      w: 520, h: 320,
      columns: ['Option', 'Cost', 'Speed'],
      rows: [['Plan A', '$10', 'Fast'], ['Plan B', '$25', 'Faster'], ['Plan C', '$40', 'Fastest']],
    },
  });
  await sleep(800);
  await fit(page);
  await sleep(400);
  const cells = await page.locator('.jz-table-cell, [class*="table"] td, .jz-table td').count().catch(() => 0);
  record('table card renders cells', cells > 0, `${cells} cell nodes`);
  await page.screenshot({ path: `${OUT}/jz-suite-table.png` });

  // ── 5. Diagram card: renders whole, NO expand toggle (the new rule) ───────
  await clear(page);
  const diagId = nid();
  // A deliberately TALL diagram (mindmap) — would previously clamp + show Expand.
  await seed(page, {
    id: diagId, type: 'diagram-card', x: 200, y: 200,
    props: {
      w: 540, h: 360,
      title: 'Product areas',
      code: 'mindmap\n  root((Product))\n    Growth\n      Acquisition\n      Activation\n      Referral\n    Core\n      Editor\n      Canvas\n      Sync\n    Platform\n      Auth\n      Billing\n      API\n    Trust\n      Privacy\n      Security\n      Compliance',
    },
  });
  await sleep(3500); // mermaid render
  await fit(page);
  await sleep(600);
  const svgEls = await page.locator('.jz-diagram svg').count().catch(() => 0);
  record('diagram card renders SVG', svgEls >= 1, `${svgEls} svg`);
  const expandToggle = await page.locator('.jz-diagram .jz-expand-toggle, .jz-diagram button:has-text("Expand"), .jz-diagram button:has-text("Show")').count().catch(() => 0);
  record('diagram card has NO expand toggle', expandToggle === 0, `${expandToggle} toggle(s)`);
  const collapsed = await page.locator('.jz-diagram.jz-card-collapsed').count().catch(() => 0);
  record('diagram card is not collapsed/clamped', collapsed === 0);
  // The card grew to contain the whole SVG (card height >= rendered svg height).
  const cardH = await heightOf(page, diagId);
  const svgH = await page.evaluate(() => {
    const s = document.querySelector('.jz-diagram svg');
    return s ? Math.ceil(s.getBoundingClientRect().height / (window.editor.getZoomLevel() || 1)) : 0;
  }).catch(() => 0);
  record('diagram card height fits the whole diagram', cardH >= svgH - 8 && svgH > 0, `cardH=${cardH} svgH≈${svgH}`);
  await page.screenshot({ path: `${OUT}/jz-suite-diagram.png` });

  // ── 6. Affinity board: clustered sticky notes render with colours ─────────
  await clear(page);
  const labelA = nid(), labelB = nid(), n1 = nid(), n2 = nid(), n3 = nid();
  await page.evaluate((ids) => {
    const C = window.jzAffinity ?? null;
    const mk = (id, x, y, text, color, w = 200, h = 40) =>
      window.editor.createShape({ id, type: 'note-card', x, y, props: { w, h, text, color } });
    mk(ids.labelA, 200, 200, 'Speed', '#e8f0ff');
    mk(ids.n1, 200, 252, 'Faster onboarding', '#e8f0ff', 200, 90);
    mk(ids.n2, 200, 352, 'Fewer clicks', '#e8f0ff', 200, 90);
    mk(ids.labelB, 430, 200, 'Trust', '#fdeaf1');
    mk(ids.n3, 430, 252, 'Clear data policy', '#fdeaf1', 200, 90);
    void C;
  }, { labelA, labelB, n1, n2, n3 });
  await sleep(800);
  await fit(page);
  await sleep(400);
  const notes = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length);
  record('affinity board renders clustered notes', notes === 5, `${notes} notes`);
  await page.screenshot({ path: `${OUT}/jz-suite-affinity.png` });

  // ── 7. Refine affordance + chips for each response card ───────────────────
  for (const [type, props, expect] of [
    ['doc-card', { w: 520, h: 300, title: 'Doc', text: 'Some text here.', sourcePdfId: '' }, ['Shorter', 'As a table', 'As a diagram']],
    ['table-card', { w: 520, h: 300, columns: ['A', 'B'], rows: [['1', '2']] }, ['Add a row', 'As a diagram', 'As prose']],
    ['diagram-card', { w: 540, h: 300, title: 'D', code: 'flowchart TD\n A-->B' }, ['Add detail', 'Simplify', 'As prose']],
  ]) {
    await clear(page);
    const id = nid();
    await seed(page, { id, type, x: 200, y: 200, props });
    await sleep(700);
    await fit(page);
    await sleep(300);
    await select(page, id);
    await sleep(900);
    const chips = await page.locator('button.jz-ask-seed').allInnerTexts().catch(() => []);
    const joined = chips.join(' · ');
    const ok = expect.every((e) => chips.some((c) => c.includes(e)));
    record(`${type} shows in-place refine chips`, ok, joined);
  }

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  writeFileSync(`${OUT}/jz-suite-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
