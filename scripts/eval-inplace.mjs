/**
 * Eval — in-place regeneration. Drives the running preview build in a real
 * browser and asserts the user-facing flow: select an answer card, ask a
 * same-type tweak, and the SAME card is rewritten (not a new one); Cmd+Z
 * restores its previous content. Also screenshots the refine affordance for a
 * doc card and a diagram card (the new chips + diagrams being askable).
 *
 * Same sandbox rules as eval-ui.mjs: every editor-mutating evaluate uses a
 * `{ … }` body so it returns undefined (never the chainable Editor), and CDN
 * fonts are blocked. Run with preview + server up:  node scripts/eval-inplace.mjs
 */

import { createRequire } from 'node:module';

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
      localStorage.removeItem('jz-onboarded');
      localStorage.removeItem('jz-comments');
    } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);
  return page;
}

const docText = (page, id) =>
  page.evaluate((i) => window.editor.getShape(i)?.props?.text ?? '', id).catch(() => '');
const countType = (page, t) =>
  page.evaluate((tt) => window.editor.getCurrentPageShapes().filter((s) => s.type === tt).length, t).catch(() => 0);

/** Wait until the doc card's text has changed from `before` and settled (no
 *  streaming caret, text stable for a beat). */
async function waitForRegen(page, id, before, timeout = 120000) {
  const start = Date.now();
  let last = '';
  let stable = 0;
  while (Date.now() - start < timeout) {
    const txt = await docText(page, id);
    const caret = await page.locator('.jz-stream-caret').count().catch(() => 0);
    if (txt && txt !== before && caret === 0) {
      if (txt === last) stable += 1;
      else stable = 0;
      last = txt;
      if (stable >= 2) return txt;
    } else {
      last = txt;
      stable = 0;
    }
    await sleep(800);
  }
  return last;
}

const SEED_DOC = `(() => {
  const { createShapeId } = window.tldraw ?? {};
  const id = (window.editor.createShapeId ? window.editor.createShapeId() : undefined);
  const sid = id ?? ('shape:' + Math.random().toString(36).slice(2));
  window.editor.createShape({
    id: sid, type: 'doc-card', x: 200, y: 200,
    props: {
      w: 520, h: 360,
      title: 'Remote work policy',
      text: 'The policy lets employees work remotely up to three days per week. Managers approve schedules quarterly and may require in-office days for team planning. Equipment stipends of up to five hundred dollars are available annually. Core collaboration hours are 10am to 3pm in the employee\\'s local time zone. Performance is measured by outcomes, not hours logged, and all remote staff must maintain a secure, private workspace for handling confidential material.',
      sourcePdfId: '',
    },
  });
  return sid;
})()`;

const SEED_DIAGRAM = `(() => {
  const sid = (window.editor.createShapeId ? window.editor.createShapeId() : ('shape:' + Math.random().toString(36).slice(2)));
  window.editor.createShape({
    id: sid, type: 'diagram-card', x: 200, y: 200,
    props: {
      w: 540, h: 360,
      title: 'Login flow',
      code: 'flowchart TD\\n  A[Start] --> B{Logged in?}\\n  B -- No --> C[Show login]\\n  C --> D[Submit]\\n  D --> B\\n  B -- Yes --> E[Dashboard]',
    },
  });
  return sid;
})()`;

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });

  // ── 1. In-place regeneration of a doc card ───────────────────────────────
  const page = await open();
  await page.evaluate((s) => {
    const ids = window.editor.getCurrentPageShapes().map((x) => x.id);
    if (ids.length) window.editor.deleteShapes(ids);
  }, null);
  await sleep(600);
  const id = await page.evaluate(SEED_DOC);
  await sleep(600);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(600);
  await page.evaluate((i) => { window.editor.select(i); }, id);
  await sleep(1200);

  // Refine affordance + follow-up chips for a doc card.
  const docChips = await page.locator('button.jz-ask-seed').allInnerTexts().catch(() => []);
  record('doc-card shows refine chips', docChips.length > 0, docChips.join(' · '));
  await page.screenshot({ path: `${OUT}/jz-inplace-doc-selected.png` });

  const before = await docText(page, id);
  const beforeCount = await countType(page, 'doc-card');

  // Click "Shorter" — a same-type tweak → in-place regeneration.
  const shorter = page.locator('button.jz-ask-seed', { hasText: 'Shorter' });
  const haveShorter = (await shorter.count()) > 0;
  record('"Shorter" chip present', haveShorter);
  if (haveShorter) await shorter.first().click();

  const after = await waitForRegen(page, id, before);
  const afterCount = await countType(page, 'doc-card');
  await page.screenshot({ path: `${OUT}/jz-inplace-doc-regenerated.png` });

  record('same card id preserved', Boolean(await page.evaluate((i) => Boolean(window.editor.getShape(i)), id)));
  record('no new card spawned (count unchanged)', afterCount === beforeCount, `${beforeCount} → ${afterCount}`);
  record('content changed in place', Boolean(after) && after !== before,
    `${before.length} → ${after.length} chars`);

  // Cmd+Z restores the previous content (single undo).
  await page.evaluate(() => { window.editor.undo(); });
  await sleep(1500);
  const restored = await docText(page, id);
  record('Cmd+Z restores prior content', restored === before,
    restored === before ? 'exact match' : `got ${restored.length} chars`);

  await page.close();

  // ── 2. Diagram card is askable + has its own refine chips ────────────────
  const page2 = await open();
  await page2.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((x) => x.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });
  await sleep(600);
  const did = await page2.evaluate(SEED_DIAGRAM);
  await sleep(1500); // let mermaid render
  await page2.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(800);
  await page2.evaluate((i) => { window.editor.select(i); }, did);
  await sleep(1200);

  const diaChips = await page2.locator('button.jz-ask-seed').allInnerTexts().catch(() => []);
  const askPill = await page2.locator('.jz-ask-pill, .jz-ask').count().catch(() => 0);
  record('diagram-card is askable (affordance shows)', askPill > 0 || diaChips.length > 0, diaChips.join(' · '));
  record('diagram-card has refine chips', diaChips.some((t) => /Add detail|Simplify|As prose/.test(t)));
  await page2.screenshot({ path: `${OUT}/jz-inplace-diagram-selected.png` });
  await page2.close();

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
