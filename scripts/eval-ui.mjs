/**
 * UI eval — drives the running preview build in a real browser and asserts the
 * key user-facing flows. LLM-backed checks (autopilot/table/comment) are slow.
 *
 * IMPORTANT — the "execution context was destroyed" trap: tldraw's Editor
 * methods (createShape, setCamera, select, zoomToFit, …) are chainable and
 * return the Editor itself. An `evaluate(() => editor.createShape(...))` makes
 * Playwright try to serialize that huge circular object across the CDP boundary,
 * which fails AS "Execution context was destroyed, most likely because of a
 * navigation" — masquerading as a sandbox flake. The fix is structural: every
 * editor-mutating evaluate uses a `{ … }` body so it returns undefined (or a
 * primitive like an id). Never let an Editor instance be the return value. With
 * that, even two synced clients are deterministic; the `pe`/`check` retries
 * remain only as a thin safety net.
 *
 * We also block tldraw's CDN font/icon requests (unreachable in the sandbox) so
 * the console isn't drowned in cert/network noise.
 *
 * Run with preview + server up:  node scripts/eval-ui.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function pe(page, fn, arg, n = 8) {
  for (let i = 0; i < n; i++) {
    try { return await page.evaluate(fn, arg); }
    catch (e) {
      if (i < n - 1 && /context was destroyed|Execution context|navigation/i.test(String(e))) {
        await sleep(500); await page.waitForFunction(() => Boolean(window.editor)).catch(() => {}); continue;
      }
      throw e;
    }
  }
}

let browser;
/** Fresh page, app mounted, settled. */
async function open(url = WEB) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // tldraw's CDN fonts/icons are unreachable in the sandbox — abort them so the
  // console isn't flooded with cert/network errors (they're cosmetic here).
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.addInitScript(() => { try { localStorage.removeItem('jz-onboarded'); localStorage.removeItem('jz-comments'); } catch {} });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);
  return page;
}
async function clearBoard(page) {
  await pe(page, () => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });
  await sleep(1000);
}
/** Run a check; retry the whole thing (fresh page) on a sandbox context teardown
 *  (an environment artifact, not a product failure). A real assertion fail
 *  (fn returns [false, …]) is NOT retried. */
async function check(name, fn, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const [ok, detail] = await fn();
      record(name, ok, detail);
      return;
    } catch (e) {
      const teardown = /context was destroyed|Execution context|navigation|Target closed|Timeout.*exceeded/i.test(String(e));
      if (teardown && attempt < retries) { await sleep(1000); continue; }
      record(name, false, String(e).split('\n')[0].slice(0, 70));
      return;
    }
  }
}

const PDF = (() => {
  try { return readFileSync('node_modules/pdf-parse/test/data/01-valid.pdf').toString('base64'); } catch { return ''; }
})();

async function main() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  console.log('UI eval\n');

  // 1. Local board mounts + roster present
  await check('Local board mounts + roster', async () => {
    const page = await open();
    const editor = await page.evaluate(() => Boolean(window.editor));
    const roster = await page.locator('.jz-roster').count();
    await page.close();
    return [editor && roster === 1, `editor=${editor} roster=${roster}`];
  });

  // 2. Multiplayer sync: two clients, one creates, the other sees it
  await check('Multiplayer sync (2 clients)', async () => {
    const room = 'eval-' + Date.now();
    const A = await open(`${WEB}/?room=${room}`);
    const B = await open(`${WEB}/?room=${room}`);
    await sleep(2000);
    // VOID body — createShape returns the chainable Editor; returning it would
    // make Playwright serialize a circular object and tear the context down.
    await pe(A, () => { window.editor.createShape({ type: 'note-card', x: 100, y: 100, props: { w: 220, h: 200, text: 'sync-eval-ping' } }); });
    const seen = await B.waitForFunction(() => {
      const s = window.editor.getCurrentPageShapes().find((x) => x.type === 'note-card');
      return s && s.props.text === 'sync-eval-ping' ? s.props.text : false;
    }, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => '');
    await A.close(); await B.close();
    return [seen === 'sync-eval-ping', `B saw "${seen}"`];
  });

  // 3. Drop an artifact → suggestion pills appear
  await check('Drop → suggestion pills', async () => {
    const page = await open(); await clearBoard(page);
    await pe(page, async () => { await window.editor.putExternalContent({ type: 'url', url: 'https://example.com/policy', point: { x: 0, y: 0 } }); });
    await sleep(800);
    await pe(page, () => { window.editor.setCamera({ x: 720, y: 560, z: 1 }); });
    const pills = await page.locator('.jz-offer-pill').count();
    await page.close();
    return [pills >= 3, `${pills} pills`];
  });

  // 4. Autopilot (Tab-to-continue) extends a doc
  await check('Autopilot extends a doc', async () => {
    const page = await open(); await clearBoard(page);
    await pe(page, () => { window.editor.createShape({ type: 'doc-card', x: 300, y: 160, props: { w: 560, h: 360, title: 'Async', text: 'Meetings kill momentum:' } }); window.editor.zoomToFit(); });
    await sleep(2200);
    const id = await pe(page, () => { const s = window.editor.getCurrentPageShapes().find((x) => x.type === 'doc-card'); window.editor.select(s.id); window.editor.setEditingShape(s.id); window.editor.setCurrentTool('select.editing_shape'); return s.id; });
    await page.waitForSelector('.jz-doc-textarea', { timeout: 5000 });
    await page.locator('.jz-doc-textarea').click(); await sleep(300);
    const before = await pe(page, (sid) => window.editor.getShape(sid).props.text.length, id);
    await page.locator('.jz-doc-textarea').press('Tab');
    const grew = await page.waitForFunction(([sid, n]) => (window.editor.getShape(sid)?.props.text.length ?? 0) > n + 40, [id, before], { timeout: 60000 }).then(() => true).catch(() => false);
    await page.close();
    return [grew, grew ? 'text extended' : 'no growth in 60s'];
  });

  // 5. Table cell-fill
  await check('Table cell-fill', async () => {
    const page = await open(); await clearBoard(page);
    await pe(page, () => { window.editor.createShape({ type: 'table-card', x: 280, y: 220, props: { w: 600, h: 200, columns: ['Tool', 'Price', 'Best for'], rows: [['Figma', '', ''], ['Sketch', '', '']] } }); window.editor.zoomToFit(); });
    await sleep(2200);
    const id = await pe(page, () => { const s = window.editor.getCurrentPageShapes().find((x) => x.type === 'table-card'); window.editor.select(s.id); window.editor.setEditingShape(s.id); window.editor.setCurrentTool('select.editing_shape'); return s.id; });
    await page.waitForSelector('.jz-table-cell', { timeout: 5000 });
    await page.locator('.jz-table-cell').first().click(); await sleep(300);
    await page.locator('.jz-table-cell').first().press('Tab');
    const filled = await page.waitForFunction((sid) => { const s = window.editor.getShape(sid); return s && s.props.rows.flat().filter((c) => c.trim()).length >= 4; }, id, { timeout: 70000 }).then(() => true).catch(() => false);
    await page.close();
    return [filled, filled ? 'cells filled' : 'incomplete in 70s'];
  });

  // 6. @mention picker
  await check('@mention picker', async () => {
    const page = await open(); await clearBoard(page);
    await pe(page, () => { window.editor.createShape({ type: 'note-card', x: 400, y: 300, props: { w: 260, h: 220, text: 'Launch plan ' } }); window.editor.zoomToFit(); });
    await sleep(2000);
    await pe(page, () => { const s = window.editor.getCurrentPageShapes().find((x) => x.type === 'note-card'); window.editor.select(s.id); window.editor.setEditingShape(s.id); window.editor.setCurrentTool('select.editing_shape'); });
    await page.waitForSelector('.jz-note textarea', { timeout: 5000 });
    await page.locator('.jz-note textarea').click(); await page.keyboard.press('End'); await page.keyboard.type('@', { delay: 50 });
    await sleep(500);
    const menu = await page.locator('.jz-mention-item').count();
    await page.close();
    return [menu >= 4, `${menu} agents listed`];
  });

  // 7. Comment thread + agent reply
  await check('Comment thread + agent reply', async () => {
    const page = await open(); await clearBoard(page);
    await pe(page, () => { window.editor.createShape({ id: 'shape:cm', type: 'note-card', x: 300, y: 300, props: { w: 260, h: 220, text: 'Beta launch plan' } }); window.editor.setCamera({ x: 60, y: -40, z: 1 }); window.editor.select('shape:cm'); window.editor.setCurrentTool('select'); });
    await page.waitForSelector('.jz-comments', { timeout: 6000 });
    await page.locator('.jz-comments-input').click();
    await page.locator('.jz-comments-input').type('What are we missing?', { delay: 10 });
    await page.keyboard.press('Enter'); await sleep(300);
    await page.locator('.jz-comments-chip').first().click();
    const replied = await page.waitForFunction(() => document.querySelectorAll('.jz-comment').length >= 2, { timeout: 55000 }).then(() => true).catch(() => false);
    await page.close();
    return [replied, replied ? 'agent replied in thread' : 'no reply in 55s'];
  });

  // 8. Auto-cluster of related drops
  await check('Auto-cluster related drops', async () => {
    if (!PDF) return [false, 'no sample PDF'];
    const page = await open(); await clearBoard(page);
    await pe(page, (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const files = ['onboarding-guide.pdf', 'onboarding-benchmarks.pdf'].map((n) => new File([bytes], n, { type: 'application/pdf' })); return window.editor.putExternalContent({ type: 'files', files, point: { x: 0, y: 0 } }); }, PDF);
    await sleep(1800);
    await pe(page, () => { window.editor.setCamera({ x: 700, y: 560, z: 0.7 }); });
    const hasBtn = await page.locator('.jz-cluster-btn').count();
    let clusterPills = 0;
    if (hasBtn) { await page.locator('.jz-cluster-btn').click(); await sleep(1200); clusterPills = await page.locator('.jz-offer-cluster .jz-offer-pill').count(); }
    await page.close();
    return [hasBtn === 1 && clusterPills >= 3, `button=${hasBtn} clusterPills=${clusterPills}`];
  });

  await browser.close();
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} passed`);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); if (browser) browser.close(); process.exit(1); });
