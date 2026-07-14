/**
 * FREESTYLE persona run — the counter-test to "this is just 4 ChatGPT queries in
 * boxes". Instead of forcing four doc dossiers, we hand Jarwiz the GOAL and let
 * it use the canvas-native, chat-impossible moves, then judge whether the
 * paradigm actually helps Arjun reach the goal:
 *
 *   1. /Board (compose)  — one goal → Jarwiz PLANS and builds a whole set of
 *                          cards laid out as a workspace (not one linear answer).
 *   2. /Map              — the three cities as an actual geographic map + pins.
 *   3. Analyze › gaps    — "what am I missing?" reasoning ACROSS every card.
 *   4. Analyze › tensions— surface contradictions between the cards.
 *   5. /Debrief          — a grounded decision (decisions · actions · risks)
 *                          built FROM the whole board.
 *
 * Robustness: shared context (board persists), fresh page per step, evaluates
 * before screenshots, no evaluate returns a chained Editor. "/" modes are opened
 * via the visible button (typing "/" doesn't trip React state under automation).
 *
 * Run with preview (5173) + server (3001) up:  node scripts/eval-freestyle.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const GOAL = 'Build me a market-study workspace to decide whether to launch an on-demand laundry and linen service for Airbnb / short-term-rental hosts, and whether to start in Bangalore, Chennai or Pondicherry. Cover market size per city, existing competition, host pain points, unit economics, per-city fit, and the biggest risks.';

let context;
const reqLog = [];
const shapeSnap = async (page) => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).map((s) => ({ type: s.type, title: String(s.props?.title || '').slice(0, 60) }))).catch(() => []);
const cardCount = (page) => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).length).catch(() => 0);
const runningCount = (page) => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.props?.status === 'running').length).catch(() => 0);
const statusLine = (page) => page.evaluate(() => { const el = document.querySelector('.jz-agent-status,[class*="status"]'); return el ? (el.textContent || '').trim().slice(0, 80) : ''; }).catch(() => '');

async function openPage(fresh) {
  const page = await context.newPage();
  await page.route('**/*', (r) => /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(r.request().url()) ? r.abort() : r.continue());
  if (fresh) await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.includes('tldraw')) localStorage.removeItem(k); } catch {} });
  page.on('request', (r) => { const u = r.url(); if (r.method() === 'POST' && /\/api\/(ask|compose|analyze|diagram|geo)/.test(u)) { try { const b = JSON.parse(r.postData() || '{}'); reqLog.push({ t: new Date().toISOString().slice(11, 19), ep: u.split('/api/')[1].split('?')[0], shape: b.shape || b.mode || '(auto)', sources: (b.sources || b.cards || []).length }); } catch {} } });
  await page.goto(fresh ? `${WEB}/?start=1` : WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
  await sleep(1600);
  const modal = page.locator('.jz-persona');
  if (await modal.count().catch(() => 0)) { const r = page.locator('.jz-persona-card', { hasText: 'Researching a topic' }); if (await r.count().catch(() => 0)) await r.first().click().catch(() => {}); else await page.locator('.jz-persona-skip').first().click().catch(() => {}); await page.waitForSelector('.jz-persona', { state: 'detached', timeout: 8000 }).catch(() => {}); await sleep(700); }
  return page;
}

async function pickMode(page, label) {
  // Typing "/" opens the mode menu in every composer state (the footer button is
  // hidden during intro onboarding). Click the item by EXACT label so "Board"
  // doesn't match "Dashboard".
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type('/');
  await page.waitForSelector('.jz-mode-item', { timeout: 4000 }).catch(() => {});
  const clicked = await page.evaluate((lab) => {
    const items = [...document.querySelectorAll('.jz-mode-item')];
    const el = items.find((i) => i.querySelector('.jz-mode-item-label')?.textContent?.trim() === lab);
    if (el) { el.click(); return true; }
    return false;
  }, label).catch(() => false);
  await sleep(300);
  log(`   ${clicked ? 'picked' : 'FAILED to pick'} "/" ${label}`);
  return clicked;
}

// The composer's send button carries a busy class for the WHOLE lifecycle of a
// compose / debrief / analyze run (Planning… → Building… → done). That's the
// reliable "still working" signal — card-count stability isn't, because the CLI
// sidecar builds cards one at a time with long gaps between them.
const busy = (page) => page.evaluate(() => !!document.querySelector('.jz-promptbar-send--busy')).catch(() => false);

async function waitSettle(page, before, budgetMs) {
  const deadline = Date.now() + budgetMs;
  // 1) wait for work to actually start (busy on, or a card appears) — up to 25s.
  const startBy = Math.min(Date.now() + 25000, deadline);
  while (Date.now() < startBy) { await sleep(1500); if ((await busy(page)) || (await cardCount(page)) > before) break; }
  // 2) wait for it to finish: not busy AND nothing streaming, quiet for ~9s.
  let quiet = 0, lastStatus = '';
  while (Date.now() < deadline) {
    await sleep(3000);
    const st = await statusLine(page); if (st && st !== lastStatus) { log(`   · ${st}`); lastStatus = st; }
    if (!(await busy(page)) && (await runningCount(page)) === 0) { quiet += 1; if (quiet >= 3) break; } else quiet = 0;
  }
  return (await cardCount(page)) - before;
}

async function typeAndSend(page, text) {
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type(text, { delay: 2 });
  await sleep(200);
  await page.keyboard.press('Enter');
}

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
  const timeline = [];

  // ── 1. /Board compose: the goal → a whole planned workspace ───────────────
  let page = await openPage(true);
  log('FREESTYLE. Arjun gives Jarwiz the whole goal and lets it build the workspace.');
  await page.screenshot({ path: `${OUT}/jz-fs-0-empty.png` });
  let before = await cardCount(page);
  await pickMode(page, 'Board');
  await typeAndSend(page, GOAL);
  log('[1] /Board compose submitted — Jarwiz planning + building the card set…');
  const made1 = await waitSettle(page, before, 320000);
  const snap1 = await shapeSnap(page);
  log(`[1] compose produced ${made1} card(s):`, JSON.stringify(snap1.slice(0, 12)));
  timeline.push({ step: 'board-compose', made: made1, cards: snap1 });
  await page.evaluate(() => { try { window.editor.zoomToFit(); } catch {} }); await sleep(1000);
  await page.screenshot({ path: `${OUT}/jz-fs-1-board.png` });
  await sleep(4000); await page.close();

  // ── 2. /Map the three cities ──────────────────────────────────────────────
  page = await openPage(false);
  before = await cardCount(page);
  await pickMode(page, 'Map');
  await typeAndSend(page, 'Map Bangalore, Chennai and Pondicherry, with a pin and one line on each city\'s short-term-rental market for a laundry service.');
  log('[2] /Map submitted…');
  const made2 = await waitSettle(page, before, 180000);
  log(`[2] map produced ${made2} card(s)`); timeline.push({ step: 'map', made: made2, cards: await shapeSnap(page) });
  await page.evaluate(() => { try { window.editor.zoomToFit(); } catch {} }); await sleep(1000);
  await page.screenshot({ path: `${OUT}/jz-fs-2-map.png` });
  await sleep(4000); await page.close();

  // ── 3 & 4. Analyze ACROSS the board: gaps, then tensions ──────────────────
  page = await openPage(false);
  for (const [mode, title] of [['gaps', 'Name the due-diligence gaps on this board'], ['tensions', 'Find contradictions between cards']]) {
    before = await cardCount(page);
    const chip = page.locator(`[title="${title}"]`);
    if (await chip.count().catch(() => 0)) {
      await chip.first().click().catch(() => {});
      log(`[3/4] Analyze › ${mode} clicked…`);
      const made = await waitSettle(page, before, 150000);
      log(`[3/4] ${mode} produced ${made} card(s)`); timeline.push({ step: `analyze-${mode}`, made });
    } else { log(`[3/4] analyze chip "${mode}" not visible`); timeline.push({ step: `analyze-${mode}`, made: 0, note: 'chip not visible' }); }
    await sleep(2000);
  }
  await page.evaluate(() => { try { window.editor.zoomToFit(); } catch {} }); await sleep(1000);
  await page.screenshot({ path: `${OUT}/jz-fs-3-analyze.png` });
  await sleep(4000); await page.close();

  // ── 5. /Debrief grounded on the whole board → the decision ────────────────
  page = await openPage(false);
  before = await cardCount(page);
  await page.evaluate(() => { window.editor.selectAll(); }); await sleep(400);
  const sel = await page.evaluate(() => window.editor.getSelectedShapeIds().length).catch(() => 0);
  await pickMode(page, 'Debrief');
  await typeAndSend(page, 'Given everything on this board, which city should I launch in first, what are the biggest risks, and what should I do next to validate it?');
  log(`[5] /Debrief submitted, grounded on ${sel} cards…`);
  const made5 = await waitSettle(page, before, 260000);
  log(`[5] debrief produced ${made5} card(s)`); timeline.push({ step: 'debrief', made: made5, grounded: sel });
  await page.evaluate(() => { try { window.editor.zoomToFit(); } catch {} }); await sleep(1200);
  await page.screenshot({ path: `${OUT}/jz-fs-BOARD.png` });

  const content = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).map((s) => { const p = s.props || {}; const text = String(p.spec || p.text || p.markdown || p.content || (p.rows ? JSON.stringify(p.rows) : '') || ''); return { type: s.type, title: String(p.title || ''), chars: text.length, text: text.slice(0, 3000) }; })).catch(() => []);
  writeFileSync(`${OUT}/jz-fs-content.json`, JSON.stringify({ goal: GOAL, timeline, reqLog, content }, null, 2));
  log('\nFREESTYLE done. Cards on board:', content.length);
  content.forEach((c) => log(`   ${c.type.padEnd(16)} ${String(c.chars).padStart(5)}ch  ${c.title.slice(0, 56)}`));
  log('Requests:'); reqLog.forEach((r) => log(`   ${r.t} ${r.ep.padEnd(9)} shape/mode=${r.shape} sources=${r.sources}`));
  await browser.close();
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
