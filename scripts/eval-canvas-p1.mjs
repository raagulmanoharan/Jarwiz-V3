/**
 * Eval — Canvas pivot P1 (the AI sees primitives).
 * Run with preview + server up:  node scripts/eval-canvas-p1.mjs
 *
 * Before P1 the AI was blind to anything that wasn't a *-card: a flowchart you
 * drew gave it nothing. These checks prove native primitives now reach the model.
 *
 *  A. Autopilot boardContext includes a CONNECTED native geo shape (arrow-wired)
 *  B. Autopilot boardContext includes a NEARBY native text primitive
 *  C. The Ask affordance appears when a native shape (with text) is selected
 *  D. The Ask request carries the selected primitive's text as a source
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

// Seed helpers run in page context. richText is a literal ProseMirror doc.
const seed = (page, fn, arg) => page.evaluate(fn, arg);

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  let autopilotBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/autopilot') && !req.url().includes('/table') && req.method() === 'POST') {
      try { autopilotBody = JSON.parse(req.postData() || 'null'); } catch {}
    }
  });
  let askBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/ask') && req.method() === 'POST') {
      try { askBody = JSON.parse(req.postData() || 'null'); } catch {}
    }
  });

  // ── A. Connected native geo shape reaches autopilot boardContext ─────────
  await clear(page);
  autopilotBody = null;
  await seed(page, () => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const rich = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const docId = mk();
    const boxId = mk();
    window.__docId = docId;
    window.editor.createShape({ id: docId, type: 'doc-card', x: 200, y: 300, props: { w: 480, h: 300, title: 'Flow notes', text: 'The login flow starts at', sourcePdfId: '' } });
    window.editor.createShape({ id: boxId, type: 'geo', x: 800, y: 320, props: { geo: 'rectangle', w: 200, h: 110, color: 'blue', fill: 'solid', richText: rich('OAuth consent screen') } });
    // Wire doc → box with an arrow bound to both.
    const arrowId = mk();
    window.editor.createShape({ id: arrowId, type: 'arrow', props: { size: 's' } });
    window.editor.createBindings([
      { id: 'binding:' + Math.random().toString(36).slice(2), type: 'arrow', fromId: arrowId, toId: docId, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
      { id: 'binding:' + Math.random().toString(36).slice(2), type: 'arrow', fromId: arrowId, toId: boxId, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
    ]);
  });
  await sleep(400);
  await page.evaluate(() => { const id = window.__docId; window.editor.select(id); window.editor.setEditingShape(id); });
  await sleep(400);
  await page.locator('.jz-doc-textarea').click();
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(1500);
  const connected = autopilotBody?.boardContext?.find((c) => c.relation === 'connected' && /OAuth consent/.test(c.text));
  record('Autopilot sees a CONNECTED geo shape', Boolean(connected) && connected.kind === 'shape',
    connected ? `kind=${connected.kind} text="${connected.text}"` : 'not in boardContext');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── B. Nearby native text primitive reaches autopilot boardContext ───────
  await clear(page);
  autopilotBody = null;
  await seed(page, () => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const rich = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const docId = mk();
    window.__docId = docId;
    window.editor.createShape({ id: docId, type: 'doc-card', x: 300, y: 300, props: { w: 460, h: 280, title: 'Draft', text: 'Key risk to call out:', sourcePdfId: '' } });
    // A free-floating text label ~300px to the right (well within 700px).
    window.editor.createShape({ id: mk(), type: 'text', x: 820, y: 330, props: { richText: rich('Latency budget is 200ms p95') } });
  });
  await sleep(400);
  await page.evaluate(() => { const id = window.__docId; window.editor.select(id); window.editor.setEditingShape(id); });
  await sleep(400);
  await page.locator('.jz-doc-textarea').click();
  await sleep(200);
  await page.keyboard.press('Tab');
  await sleep(1500);
  const nearbyText = autopilotBody?.boardContext?.find((c) => c.kind === 'text' && /Latency budget/.test(c.text));
  record('Autopilot sees a NEARBY text primitive', Boolean(nearbyText),
    nearbyText ? `relation=${nearbyText.relation} text="${nearbyText.text}"` : 'not in boardContext');
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── C/D. Ask affordance + request on a native shape selection ────────────
  await clear(page);
  askBody = null;
  const boxId = await page.evaluate(() => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const rich = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const id = mk();
    window.editor.createShape({ id, type: 'geo', x: 500, y: 350, props: { geo: 'rectangle', w: 240, h: 130, color: 'green', fill: 'solid', richText: rich('Self-serve onboarding') } });
    return id;
  });
  await page.evaluate((id) => { window.editor.select(id); }, boxId);
  await sleep(500);
  // Selecting an askable shape grounds the prompt bar — it shows a removable chip.
  const askVisible = (await page.locator('.jz-pb-ground').count()) > 0;
  record('Ask affordance appears on a native shape selection', askVisible);
  await page.screenshot({ path: `${OUT}/jz-p1-ask-on-shape.png` });

  if (askVisible) {
    // Ask via the prompt bar; the selection is the grounding source.
    await page.locator('.jz-promptbar-input').fill('Summarise this in one line');
    await page.keyboard.press('Enter');
    await sleep(1500);
    const sentShapeText = Array.isArray(askBody?.sources) &&
      askBody.sources.some((s) => /Self-serve onboarding/.test(s.text || ''));
    record('Ask request carries the shape text as a source', sentShapeText,
      askBody ? `sources=${JSON.stringify(askBody.sources)?.slice(0, 90)}` : 'no /api/ask request');
  } else {
    record('Ask request carries the shape text as a source', false, 'grounding not shown');
  }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} canvas-P1 checks passed`);
  writeFileSync(`${OUT}/jz-p1-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
