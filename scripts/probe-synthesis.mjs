/**
 * Isolated probe of the two "finish the study" affordances, separated from the
 * long research run so we can tell a real Jarwiz limitation from an automation
 * artifact:
 *   A. the "/" answer-shape menu (Table) — via the visible button, not keystrokes
 *   B. a GROUNDED decision ask over selected cards → does it produce a card, and
 *      does the /api/ask request actually carry the cards as sources?
 * Uses fast seeded note-cards (no deep research) so it runs in ~1 minute.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const out = { menu: {}, grounded: {}, req: [] };

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  await page.route('**/*', (r) => /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(r.request().url()) ? r.abort() : r.continue());
  await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.includes('tldraw')) localStorage.removeItem(k); } catch {} });
  page.on('request', (r) => { if (r.url().includes('/api/ask') && r.method() === 'POST') { try { const b = JSON.parse(r.postData() || '{}'); out.req.push({ shape: b.shape || '(auto)', sources: (b.sources || []).length, deep: !!b.deep }); } catch {} } });

  await page.goto(`${WEB}/?start=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
  await sleep(1500);
  const modal = page.locator('.jz-persona');
  if (await modal.count().catch(() => 0)) { await page.locator('.jz-persona-skip').first().click().catch(() => {}); await sleep(600); }

  // Seed three "research summary" notes (fast, deterministic grounding targets).
  await page.evaluate(() => {
    const mk = (x, t) => window.editor.createShape({ id: 'shape:' + Math.random().toString(36).slice(2), type: 'note-card', x, y: 140, props: { w: 260, h: 170, text: t, color: '#fbf6e9' } });
    mk(120, 'Bangalore: ~10,656 STR listings, year-round IT demand, but crowded organized laundry market.');
    mk(440, 'Chennai: ~1,455 listings, 52% occupancy, medical + business travel smooths demand, lighter competition.');
    mk(760, 'Pondicherry: ~1,603 listings, 28% occupancy, 6-month tourist season, almost no organized laundry.');
  });
  await sleep(800);

  // ── Probe A: the "/" shape menu via the visible button ────────────────────
  const modeBtn = page.locator('[aria-label="Choose the answer\'s shape"]');
  out.menu.buttonPresent = (await modeBtn.count().catch(() => 0)) > 0;
  if (out.menu.buttonPresent) {
    await modeBtn.first().click().catch(() => {});
    await sleep(500);
    out.menu.opened = (await page.locator('.jz-mode-menu').count().catch(() => 0)) > 0;
    const table = page.locator('.jz-mode-item', { hasText: 'Table' });
    out.menu.tableItem = (await table.count().catch(() => 0)) > 0;
    if (out.menu.tableItem) {
      await table.first().click().catch(() => {});
      await sleep(400);
      const chip = await page.locator('.jz-promptbar-mode-chip, .jz-mode-chip, [class*="mode-chip"]').count().catch(() => 0);
      out.menu.tableChipShown = chip > 0;
    }
  }
  log('menu probe:', JSON.stringify(out.menu));
  await page.screenshot({ path: '/tmp/jz-probe-menu.png' }).catch(() => {});
  // Clear any picked mode so it doesn't force Table on the decision ask.
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);

  // ── Probe B: grounded decision ask over the 3 notes ───────────────────────
  const before = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).length).catch(() => 0);
  await page.evaluate(() => { window.editor.selectAll(); });
  await sleep(400);
  out.grounded.selected = await page.evaluate(() => window.editor.getSelectedShapeIds().length).catch(() => 0);
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type('Based on these three city notes, which city should I launch a laundry service in first, and why? List the key risks.', { delay: 3 });
  await sleep(200);
  await page.keyboard.press('Enter');
  log('grounded decision submitted; selected =', out.grounded.selected);
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const now = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).length).catch(() => before);
    const running = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.props?.status === 'running').length).catch(() => 0);
    if (now > before && running === 0) break;
  }
  const after = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).length).catch(() => before);
  out.grounded.producedCard = after > before;
  out.grounded.newText = await page.evaluate(() => {
    const s = window.editor.getCurrentPageShapes().filter((x) => x.type === 'doc-card' || x.type === 'dashboard-card').pop();
    const p = s?.props || {}; return String(p.markdown || p.text || p.content || p.spec || '').slice(0, 800);
  }).catch(() => '');
  log('grounded produced card:', out.grounded.producedCard);
  await page.evaluate(() => { try { window.editor.zoomToFit(); } catch {} }).catch(() => {});
  await sleep(800);
  await page.screenshot({ path: '/tmp/jz-probe-grounded.png' }).catch(() => {});

  writeFileSync('/tmp/jz-probe.json', JSON.stringify(out, null, 2));
  log('DONE. req evidence:', JSON.stringify(out.req));
  await browser.close();
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
