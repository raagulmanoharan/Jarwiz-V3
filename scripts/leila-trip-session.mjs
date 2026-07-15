/**
 * Leila — a pediatric nurse, not a founder — planning a 12-day Japan trip with
 * her sister. An orthogonal persona to Arjun (leisure vs business, geographic vs
 * financial). Tests whether Jarwiz helps a non-technical user reach a personal
 * goal, and whether the interactive-model suggestion stays appropriately QUIET
 * in a domain with almost no leverable numbers.
 *
 * Flow: pick the Trip persona → /Board her whole trip goal (one goal → a planned
 * day-by-day workspace) → /Map the three cities → check that itinerary cards do
 * NOT draw a "model this" pill. Screenshots each beat.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const out = {};

const GOAL = 'Plan a 12-day Japan trip for me and my sister around cherry-blossom season — Tokyo, Kyoto and Osaka, day by day. Balance the must-see sights with great food and a couple of genuinely slow days (I am burned out), on a mid-range budget.';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.route('**/*', (r) => /cdn\.tldraw|fonts\.goog|gstatic/.test(r.request().url()) ? r.abort() : r.continue());
await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.includes('tldraw')) localStorage.removeItem(k); } catch {} });
await page.goto('http://localhost:5173/?start=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
await sleep(1600);

// Leila picks the Trip persona ("Planning a trip").
const modal = page.locator('.jz-persona');
if (await modal.count()) {
  const trip = page.locator('.jz-persona-card', { hasText: 'Planning a trip' });
  if (await trip.count()) await trip.first().click().catch(() => {});
  else await page.locator('.jz-persona-skip').first().click().catch(() => {});
  await page.waitForSelector('.jz-persona', { state: 'detached', timeout: 8000 }).catch(() => {});
  await sleep(900);
}
out.intro_head = await page.locator('.jz-pb-intro-head').textContent().catch(() => '');
out.intro_starters = await page.locator('.jz-pb-intro-chip').allTextContents().catch(() => []);
log('Trip persona — heading:', JSON.stringify(out.intro_head), '| starters:', JSON.stringify(out.intro_starters));
await page.screenshot({ path: '/tmp/jz-leila-0-intro.png' });

const busy = () => page.evaluate(() => !!document.querySelector('.jz-promptbar-send--busy')).catch(() => false);
const cardShapes = () => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).map((s) => ({ id: s.id, type: s.type, title: String(s.props?.title || '').slice(0, 48) }))).catch(() => []);
async function pickMode(label) {
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type('/');
  await page.waitForSelector('.jz-mode-item', { timeout: 4000 }).catch(() => {});
  const ok = await page.evaluate((lab) => { const el = [...document.querySelectorAll('.jz-mode-item')].find((i) => i.querySelector('.jz-mode-item-label')?.textContent?.trim() === lab); if (el) { el.click(); return true; } return false; }, label).catch(() => false);
  await sleep(300); return ok;
}
async function waitWork(budgetMs) {
  const start = Math.min(Date.now() + 25000, Date.now() + budgetMs);
  while (Date.now() < start) { await sleep(1500); if (await busy()) break; }
  const deadline = Date.now() + budgetMs; let quiet = 0, last = '';
  while (Date.now() < deadline) { await sleep(3000); const st = await page.evaluate(() => { const el = document.querySelector('[class*="status"]'); return el ? (el.textContent || '').trim().slice(0, 70) : ''; }).catch(() => ''); if (st && st !== last) { log('   ·', st); last = st; } const b2 = await busy(); const running = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.props?.status === 'running').length).catch(() => 0); if (!b2 && running === 0) { quiet++; if (quiet >= 3) break; } else quiet = 0; }
}

// ── 1. /Board — one goal → a planned day-by-day trip workspace ───────────────
log('Leila: /Board — "Plan a 12-day Japan trip…"');
const before = (await cardShapes()).length;
await pickMode('Board');
await page.locator('.jz-promptbar-input').click();
await page.keyboard.type(GOAL, { delay: 2 });
await sleep(200); await page.keyboard.press('Enter');
await waitWork(320000);
out.board_cards = await cardShapes();
log('trip board built —', out.board_cards.length, 'cards:', JSON.stringify(out.board_cards.map((c) => c.title)));
await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(1000);
await page.screenshot({ path: '/tmp/jz-leila-1-board.png' });

// ── 2. Does the "model this" pill stay quiet on an itinerary card? ──────────
async function pillsFor(id) {
  await page.evaluate((sid) => { window.editor.selectNone(); window.editor.select(sid); return sid; }, id).catch(() => {});
  await sleep(500);
  let labels = []; const dl = Date.now() + 50000;
  while (Date.now() < dl) { await sleep(2000); labels = await page.locator('.jz-pb-chip').allTextContents().catch(() => []); if (labels.length && !(await page.locator('.jz-pb-chip--wait').count().catch(() => 0))) break; }
  return { labels, model: await page.locator('.jz-pb-chip--make').count().catch(() => -1) };
}
if (out.board_cards.length) {
  const first = out.board_cards[0];
  const p = await pillsFor(first.id);
  out.itinerary_card = { title: first.title, type: first.type, pills: p.labels, model_pill: p.model };
  log('selected "%s" — suggestions:', first.title, JSON.stringify(p.labels), '| model pill:', p.model);
  await page.screenshot({ path: '/tmp/jz-leila-2-suggest.png' });
}

// ── 3. /Map the three cities (the geographic card Arjun never really used) ───
await page.evaluate(() => { window.editor.selectNone(); }); await sleep(300);
log('Leila: /Map — Tokyo, Kyoto, Osaka');
const beforeMap = (await cardShapes()).length;
await pickMode('Map');
await page.locator('.jz-promptbar-input').click();
await page.keyboard.type('Map Tokyo, Kyoto and Osaka with the highlights in each and roughly how many days to spend, in cherry-blossom season.', { delay: 2 });
await sleep(200); await page.keyboard.press('Enter');
await waitWork(180000);
out.map_made = (await cardShapes()).length > beforeMap;
log('map card made:', out.map_made);
await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(1200);
await page.screenshot({ path: '/tmp/jz-leila-3-map.png' });

// Final board + content
out.final_cards = await cardShapes();
const content = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).map((s) => { const pr = s.props || {}; const text = String(pr.spec || pr.text || pr.markdown || (pr.rows ? JSON.stringify(pr.rows) : '') || (pr.stops ? JSON.stringify(pr.stops) : '') || ''); return { type: s.type, title: String(pr.title || ''), chars: text.length, text: text.slice(0, 1500) }; })).catch(() => []);
await page.screenshot({ path: '/tmp/jz-leila-BOARD.png' });
writeFileSync('/tmp/jz-leila.json', JSON.stringify({ ...out, content }, null, 2));
log('RESULT:', JSON.stringify({ intro_head: out.intro_head, starters: out.intro_starters, board: out.board_cards.map((c) => c.title), itinerary_model_pill: out.itinerary_card?.model_pill, map_made: out.map_made }));
await b.close(); process.exit(0);
