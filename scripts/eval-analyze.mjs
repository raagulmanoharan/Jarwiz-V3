/**
 * Eval — opinion agents (Big Rocks 2.3 tensions / 3.2 gaps / 3.1 critique).
 * Run with preview + server up:  node scripts/eval-analyze.mjs
 *
 *  A. The prompt-bar tools menu opens with the three agents
 *  B. "Scan for tensions" drops a Tensions doc that names a real conflict
 *  C. "What am I missing?" drops a "What's missing" doc
 *  D. "Devil's advocate" on a selection drops a critique doc
 *  E. Each analysis is a single undo
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

const docs = (page) =>
  page.evaluate(() =>
    window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').map((s) => ({ title: s.props.title, text: s.props.text })),
  );

// Run a tool from the prompt-bar menu, wait for a new doc card to appear.
async function runTool(page, label, baseline) {
  await page.locator('.jz-promptbar-tools').click();
  await sleep(250);
  await page.locator('.jz-promptbar-menuitem', { hasText: label }).first().click();
  for (let i = 0; i < 45; i++) {
    await sleep(800);
    const d = await docs(page);
    if (d.length > baseline) return d;
  }
  return await docs(page);
}

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // Seed cards with a deliberate tension + a strong assumption.
  await page.evaluate(() => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const add = (text) => window.editor.createShape({ id: mk(), type: 'note-card', x: 120 + Math.random() * 60, y: 120 + Math.random() * 60, props: { w: 220, h: 150, text, color: '#fbf6e9' } });
    add('P0 is speed: ship the fastest possible experience');
    add('P0 is completeness: cover every edge case before launch');
    add('Target enterprise buyers at a premium price, no pilot needed');
  });
  await sleep(400);

  // ── A. Tools menu opens ─────────────────────────────────────────────────
  await page.locator('.jz-promptbar-tools').click();
  await sleep(300);
  const menuItems = await page.locator('.jz-promptbar-menuitem').count();
  record('Prompt-bar tools menu opens with 3 agents', menuItems === 3, `${menuItems} items`);
  await page.screenshot({ path: `${OUT}/jz-analyze-menu.png` });
  await page.locator('.jz-promptbar-tools').click(); // close
  await sleep(200);

  // ── B. Tensions ─────────────────────────────────────────────────────────
  let base = (await docs(page)).length;
  let after = await runTool(page, 'tensions', base);
  const tensions = after.find((d) => /tension/i.test(d.title));
  record('Scan for tensions drops a Tensions doc', Boolean(tensions),
    tensions ? `"${tensions.title}"` : `docs=${after.length}`);
  record('Tensions names a real conflict (speed vs completeness)',
    Boolean(tensions) && /speed|complete|priorit/i.test(tensions.text || ''),
    tensions ? (tensions.text || '').slice(0, 80) : '');
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-analyze-tensions.png` });

  // ── E. Single undo removes the tensions doc ─────────────────────────────
  await page.evaluate(() => { window.editor.undo(); });
  await sleep(500);
  const afterUndo = (await docs(page)).length;
  record('Analysis is a single undo', afterUndo === base, `docs ${after.length}→${afterUndo}`);

  // ── C. Gaps ─────────────────────────────────────────────────────────────
  base = (await docs(page)).length;
  after = await runTool(page, 'missing', base);
  const gaps = after.find((d) => /missing/i.test(d.title));
  record('"What am I missing?" drops a gaps doc', Boolean(gaps), gaps ? `"${gaps.title}"` : `docs=${after.length}`);

  // ── D. Critique on a selection ──────────────────────────────────────────
  await page.evaluate(() => {
    const note = window.editor.getCurrentPageShapes().find((s) => s.type === 'note-card');
    if (note) window.editor.select(note.id);
  });
  await sleep(300);
  base = (await docs(page)).length;
  after = await runTool(page, "Devil", base);
  const critique = after.find((d) => /devil|advoc/i.test(d.title));
  record("Devil's advocate drops a critique doc", Boolean(critique), critique ? `"${critique.title}"` : `docs=${after.length}`);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-analyze-critique.png` });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} analyze checks passed`);
  writeFileSync(`${OUT}/jz-analyze-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
