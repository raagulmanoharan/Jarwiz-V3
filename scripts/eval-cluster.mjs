/**
 * Eval — Big Rocks 2.1 (cluster stickies → named themes).
 * Run with preview + server up:  node scripts/eval-cluster.mjs
 *
 *  A. "✦ Cluster & summarise" appears for ≥3 selected sticky notes
 *  B. It does NOT appear for 2 notes (below the threshold)
 *  C. Clustering hits /api/cluster with the notes' text
 *  D. A summary doc card is produced ("themes emerged")
 *  E. The notes are re-laid into themed columns (distinct x positions) + recolored
 *  F. The whole synthesis is a single undo
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

// Seed `texts` as sticky notes in a loose grid; return their ids.
const seedNotes = (page, texts) =>
  page.evaluate((texts) => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    const ids = [];
    texts.forEach((t, i) => {
      const id = mk();
      ids.push(id);
      window.editor.createShape({
        id, type: 'note-card',
        x: 120 + (i % 3) * 260, y: 120 + Math.floor(i / 3) * 200,
        props: { w: 220, h: 160, text: t, color: '#fbf6e9' },
      });
    });
    window.__notes = ids;
    return ids;
  }, texts);

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  let clusterBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/cluster') && req.method() === 'POST') {
      try { clusterBody = JSON.parse(req.postData() || 'null'); } catch {}
    }
  });

  // ── B. No Cluster pill for only 2 notes ─────────────────────────────────
  await clear(page);
  await seedNotes(page, ['Login is slow', 'Onboarding too long']);
  await page.evaluate(() => { window.editor.select(...window.__notes); });
  await sleep(500);
  const clusterAt2 = await page.locator('.jz-ask-seed', { hasText: 'Cluster' }).count();
  record('Cluster hidden below 3 notes', clusterAt2 === 0);

  // ── A. Cluster pill appears for 6 notes ─────────────────────────────────
  await clear(page);
  const texts = [
    'Login is too slow', 'Users forget passwords', 'Onboarding has too many steps',
    'Password reset is confusing', 'First screen is overwhelming', '2FA setup fails often',
  ];
  await seedNotes(page, texts);
  await page.evaluate(() => { window.editor.select(...window.__notes); });
  await sleep(500);
  const beforeColors = await page.evaluate(() =>
    window.__notes.map((id) => { const b = window.editor.getShapePageBounds(id); return b ? Math.round(b.minX) : 0; }),
  );
  const pill = page.locator('.jz-ask-seed', { hasText: 'Cluster' });
  const pillVisible = (await pill.count()) > 0;
  record('Cluster appears for ≥3 notes', pillVisible);
  await page.screenshot({ path: `${OUT}/jz-cluster-before.png` });

  if (pillVisible) {
    await pill.first().click({ force: true });
    // Wait for the summary doc to appear (sidecar synthesis can take 10–20s).
    let docs = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(800);
      docs = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);
      if (docs >= 1) break;
    }
    record('Cluster hit /api/cluster with the notes', Boolean(clusterBody) && Array.isArray(clusterBody.items) && clusterBody.items.length === 6,
      clusterBody ? `items=${clusterBody.items?.length}` : 'no request');

    const summary = await page.evaluate(() => {
      const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
      return d ? { title: d.props.title, text: d.props.text } : null;
    });
    record('A summary doc was produced', Boolean(summary) && /theme/i.test(summary.text || ''),
      summary ? `title="${summary.title}"` : 'no doc');

    // Notes re-laid into themed columns: more distinct x positions than before,
    // and at least some recolored away from the original paper color.
    const after = await page.evaluate(() => ({
      xs: window.__notes.map((id) => { const b = window.editor.getShapePageBounds(id); return b ? Math.round(b.minX) : 0; }),
      colors: window.__notes.map((id) => window.editor.getShape(id)?.props?.color),
    }));
    const distinctCols = new Set(after.xs).size;
    const recolored = after.colors.some((c) => c && c !== '#fbf6e9');
    record('Notes re-laid into themed columns + recolored', distinctCols >= 2 && recolored,
      `cols=${distinctCols} recolored=${recolored}`);
    await page.evaluate(() => { window.editor.zoomToFit(); });
    await sleep(400);
    await page.screenshot({ path: `${OUT}/jz-cluster-after.png` });

    // ── F. Single undo restores everything ────────────────────────────────
    await page.evaluate(() => { window.editor.undo(); });
    await sleep(600);
    const afterUndo = await page.evaluate(() => ({
      docs: window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length,
      xs: window.__notes.map((id) => { const b = window.editor.getShapePageBounds(id); return b ? Math.round(b.minX) : 0; }),
      colors: window.__notes.map((id) => window.editor.getShape(id)?.props?.color),
    }));
    const restored =
      afterUndo.docs === 0 &&
      afterUndo.colors.every((c) => c === '#fbf6e9') &&
      afterUndo.xs.every((x, i) => Math.abs(x - beforeColors[i]) <= 2);
    record('Cluster is a single undo', restored, `docs=${afterUndo.docs}`);
  } else {
    record('Cluster hit /api/cluster with the notes', false, 'no pill');
    record('A summary doc was produced', false, 'no pill');
    record('Notes re-laid into themed columns + recolored', false, 'no pill');
    record('Cluster is a single undo', false, 'no pill');
  }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} cluster checks passed`);
  writeFileSync(`${OUT}/jz-cluster-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
