/**
 * Eval — writing partner (doc entry + board-aware Tab + cold-start).
 * Run with preview + server up:  node scripts/eval-writing-partner.mjs
 *
 * Checks:
 *  A. "d" key drops a doc card and opens it for editing (caret ready)
 *  B. Dock "Doc" button does the same
 *  C. Tab on a card with text fires Autopilot (stream caret appears)
 *  D. Cold-start clarify fires when doc is empty + untitled + no board context
 *  E. Board context is gathered: a connected doc card appears in the request
 *     (verified via network interception)
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
  await page.addInitScript(() => { try { localStorage.removeItem('jz-onboarded'); } catch {} });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1400);
  return page;
}

const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const clear = (page) =>
  page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });
const seed = (page, spec) =>
  page.evaluate((s) => { window.editor.createShape(s); }, spec);
const shapeCount = (page) =>
  page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // ── A. "d" key drops a doc card and enters edit mode ────────────────────
  await clear(page);
  await page.mouse.click(700, 400); // focus the canvas so the window key handler hears 'd'
  await sleep(150);
  const beforeD = await shapeCount(page);
  await page.keyboard.press('d');
  await sleep(600);
  const afterD = await shapeCount(page);
  const editingAfterD = await page.evaluate(() => Boolean(window.editor.getEditingShapeId()));
  record('"d" key drops a doc card', afterD > beforeD, `shapes: ${beforeD} → ${afterD}`);
  record('"d" key opens doc for editing', editingAfterD);
  await page.screenshot({ path: `${OUT}/jz-wp-d-key.png` });

  // ── B. Toolbar "Doc" button drops a doc card ────────────────────────────
  await clear(page);
  const beforeBtn = await shapeCount(page);
  await page.evaluate(() => document.querySelector('[data-testid="rail.doc"]').click());
  await sleep(600);
  const afterBtn = await shapeCount(page);
  const editingAfterBtn = await page.evaluate(() => Boolean(window.editor.getEditingShapeId()));
  record('Dock "Doc" button drops a doc card', afterBtn > beforeBtn);
  record('Dock "Doc" button opens doc for editing', editingAfterBtn);
  await page.screenshot({ path: `${OUT}/jz-wp-dock-btn.png` });

  // ── C. Tab on a card with text fires Autopilot ───────────────────────────
  await clear(page);
  const did = nid();
  await seed(page, {
    id: did,
    type: 'doc-card',
    x: 400,
    y: 300,
    props: { w: 520, h: 360, title: 'Quarterly review', text: 'Revenue grew 15% this quarter', sourcePdfId: '' },
  });
  // Intercept the autopilot request to confirm Tab triggered it.
  let autopilotRequested = false;
  page.on('request', (req) => {
    if (req.url().includes('/api/autopilot') && !req.url().includes('/table') && req.method() === 'POST') {
      autopilotRequested = true;
    }
  });
  await page.evaluate((id) => { window.editor.select(id); window.editor.setEditingShape(id); }, did);
  await sleep(500);
  await page.locator('.jz-doc-textarea').click();
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(1000); // wait for the fetch to be issued (not the full response)
  record('Tab on card with text fires Autopilot', autopilotRequested);
  // Wait for sidecar to respond and text to grow.
  for (let i = 0; i < 15; i++) {
    await sleep(700);
    const len = await page.evaluate((id) => (window.editor.getShape(id)?.props?.text ?? '').length, did);
    if (len > 29) break;
  }
  const textAfterTab = await page.evaluate((id) => (window.editor.getShape(id)?.props?.text ?? ''), did);
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-wp-autopilot-stream.png` });

  // ── D. Cold-start clarify fires on empty untitled card with no context ───
  await clear(page);
  const did2 = nid();
  await seed(page, {
    id: did2,
    type: 'doc-card',
    x: 400,
    y: 300,
    props: { w: 520, h: 360, title: '', text: '', sourcePdfId: '' },
  });
  await page.evaluate((id) => { window.editor.select(id); window.editor.setEditingShape(id); }, did2);
  await sleep(500);
  await page.locator('.jz-doc-textarea').click();
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(1200);
  const clarifyVisible = (await page.locator('.jz-clarify').count().catch(() => 0)) > 0;
  const clarifyQ = await page.locator('.jz-clarify-q').innerText().catch(() => '');
  const clarifyOpts = await page.locator('.jz-clarify-opt').count().catch(() => 0);
  record('Cold-start clarify fires on empty untitled card', clarifyVisible, clarifyQ);
  record('Cold-start clarify shows options', clarifyOpts >= 2, `${clarifyOpts} options`);
  await page.screenshot({ path: `${OUT}/jz-wp-cold-start.png` });

  // Answering the clarify should fire Autopilot (title becomes the answer).
  if (clarifyVisible) {
    await page.locator('.jz-clarify-opt').first().click();
    await sleep(2000);
    const titleAfter = await page.evaluate((id) => {
      const s = window.editor.getShape(id);
      return s ? s.props.title || '' : '';
    }, did2);
    const textAfter = await page.evaluate((id) => {
      const s = window.editor.getShape(id);
      return s ? s.props.text || '' : '';
    }, did2);
    record('Answering cold-start sets title and triggers draft', titleAfter.length > 0 || textAfter.length > 0,
      `title="${titleAfter}" text_len=${textAfter.length}`);
    await page.evaluate(() => { window.editor.zoomToFit(); });
    await sleep(400);
    await page.screenshot({ path: `${OUT}/jz-wp-cold-start-answered.png` });
  }

  // ── E. Board context — Tab includes connected cards in request ────────────
  await clear(page);
  const srcId = nid();
  const ctxId = nid();
  // Capture the /api/autopilot request body.
  let capturedBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/autopilot') && req.method() === 'POST') {
      try { capturedBody = JSON.parse(req.postData() || 'null'); } catch {}
    }
  });
  await seed(page, {
    id: srcId,
    type: 'doc-card',
    x: 200,
    y: 300,
    props: { w: 520, h: 360, title: 'My doc', text: 'Writing in progress', sourcePdfId: '' },
  });
  await seed(page, {
    id: ctxId,
    type: 'note-card',
    x: 820,
    y: 300,
    props: { w: 220, h: 120, text: 'Key insight: speed matters', color: '#fbf6e9' },
  });
  // Connect the two with an arrow.
  await page.evaluate(
    ([fromId, toId]) => {
      const { createShapeId, createBindingId } = window.tldraw ?? {};
      // Use editor directly to create an arrow.
      const arrowId = 'shape:arrow-' + Math.random().toString(36).slice(2);
      window.editor.createShape({ id: arrowId, type: 'arrow', props: { size: 's' } });
      const bindStart = 'binding:' + Math.random().toString(36).slice(2);
      const bindEnd = 'binding:' + Math.random().toString(36).slice(2);
      window.editor.createBindings([
        { id: bindStart, type: 'arrow', fromId: arrowId, toId: fromId, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
        { id: bindEnd, type: 'arrow', fromId: arrowId, toId: toId, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
      ]);
    },
    [srcId, ctxId],
  );
  await sleep(400);
  await page.evaluate((id) => { window.editor.select(id); window.editor.setEditingShape(id); }, srcId);
  await sleep(400);
  await page.locator('.jz-doc-textarea').click();
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(1500);
  const hasBoardContext = capturedBody !== null && Array.isArray(capturedBody.boardContext) && capturedBody.boardContext.length > 0;
  record(
    'Tab includes connected cards in boardContext',
    hasBoardContext,
    hasBoardContext
      ? `${capturedBody.boardContext.length} card(s), first: ${JSON.stringify(capturedBody.boardContext[0])}`
      : 'no boardContext in request',
  );
  await page.evaluate(() => { window.editor.zoomToFit(); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/jz-wp-board-context.png` });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} writing-partner checks passed`);
  writeFileSync(`${OUT}/jz-wp-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
