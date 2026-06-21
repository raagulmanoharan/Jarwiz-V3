/**
 * Eval — Canvas pivot P2 (the AI builds primitives).
 * Run with preview + server up:  node scripts/eval-canvas-p2.mjs
 *
 * The north star: the agent authors real, editable primitives. "Turn this into a
 * flowchart" lays out native geo shapes + bound connectors you can then tweak.
 *
 *  A. The "◇ Flowchart" action appears on a selection
 *  B. Clicking it hits /api/diagram with the selected source as grounding
 *  C. A flowchart of native geo shapes is built on the canvas
 *  D. The shapes are wired with native connectors (arrows)
 *  E. The build is a single undo (Cmd+Z removes the whole flowchart)
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

const counts = (page) =>
  page.evaluate(() => {
    const all = window.editor.getCurrentPageShapes();
    return { geo: all.filter((s) => s.type === 'geo').length, arrow: all.filter((s) => s.type === 'arrow').length };
  });

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  let diagramBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/diagram') && req.method() === 'POST') {
      try { diagramBody = JSON.parse(req.postData() || 'null'); } catch {}
    }
  });

  // Seed a doc describing a process, and select it as the grounding source.
  const docId = await page.evaluate(() => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const id = mk();
    window.editor.createShape({
      id, type: 'doc-card', x: 240, y: 320,
      props: { w: 460, h: 280, title: 'Signup', text: 'User signup: collect email and password, validate, create the account, then send a verification email.', sourcePdfId: '' },
    });
    return id;
  });
  await page.evaluate((id) => { window.editor.select(id); }, docId);
  await sleep(500);

  // ── A. The Flowchart action appears ─────────────────────────────────────
  const pill = page.locator('.jz-ask-seed', { hasText: 'Flowchart' });
  const pillVisible = (await pill.count()) > 0;
  record('"◇ Flowchart" action appears on a selection', pillVisible);

  const before = await counts(page);

  // ── B/C/D. Click it → request + flowchart built ─────────────────────────
  if (pillVisible) {
    await pill.first().click();
    // The agent now DRAWS node-by-node then the connectors, asynchronously —
    // wait for the full draw to settle (nodes AND edges, counts stable) before
    // asserting or undoing.
    let after = before;
    let stable = 0;
    let prev = '';
    for (let i = 0; i < 45; i++) {
      await sleep(800);
      after = await counts(page);
      const sig = `${after.geo}/${after.arrow}`;
      if (after.geo - before.geo >= 3 && after.arrow - before.arrow >= 2 && sig === prev) {
        if (++stable >= 2) break;
      } else {
        stable = 0;
      }
      prev = sig;
    }
    record('Flowchart request hit /api/diagram with grounding',
      Boolean(diagramBody) && Array.isArray(diagramBody.sources) && diagramBody.sources.length > 0,
      diagramBody ? `sources=${diagramBody.sources?.length}` : 'no request');
    record('Native geo shapes were built', after.geo - before.geo >= 3, `geo: ${before.geo} → ${after.geo}`);
    record('Shapes are wired with connectors', after.arrow - before.arrow >= 2, `arrows: ${before.arrow} → ${after.arrow}`);
    await page.evaluate(() => { window.editor.selectNone(); });
    await sleep(400);
    await page.screenshot({ path: `${OUT}/jz-p2-flowchart.png` });

    // ── E. Single undo removes the whole flowchart ────────────────────────
    await page.evaluate(() => { window.editor.undo(); });
    await sleep(600);
    const afterUndo = await counts(page);
    record('Flowchart build is a single undo', afterUndo.geo === before.geo && afterUndo.arrow === before.arrow,
      `geo→${afterUndo.geo} arrows→${afterUndo.arrow}`);
  } else {
    record('Flowchart request hit /api/diagram with grounding', false, 'no pill');
    record('Native geo shapes were built', false, 'no pill');
    record('Shapes are wired with connectors', false, 'no pill');
    record('Flowchart build is a single undo', false, 'no pill');
  }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} canvas-P2 checks passed`);
  writeFileSync(`${OUT}/jz-p2-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
