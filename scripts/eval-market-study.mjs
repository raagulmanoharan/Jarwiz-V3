/**
 * Goal-driven persona session — "Arjun", a UX designer in Bangalore weighing a
 * venture: an on-demand laundry + linen service for Airbnb / short-term-rental
 * hosts. His GOAL is an extensive market study to decide (a) whether the gap is
 * real and (b) which city to launch first — Bangalore, Chennai, or Pondicherry.
 *
 * This is not a fixed feature test; it follows the arc a founder's study takes:
 *   EXPLORE  → four live-web research dossiers (opportunity, competition,
 *              host pain, and Pondicherry-as-a-different-market)
 *   SYNTHESISE → the completion test: select the dossiers as GROUNDING and ask
 *              Jarwiz to (5) compare the three cities in a Table and (6) turn it
 *              all into a launch Debrief (decisions · actions · risks).
 *
 * We record every /api/ask request ({shape, sources, deep}) as hard evidence of
 * whether grounding actually attached the prior cards — the crux of "can he
 * finish the study, or just pile up disconnected answers?"
 *
 * Robustness (per CLAUDE.md sandbox note): one shared context (board persists in
 * IndexedDB), a fresh page per step, evaluates strictly before each screenshot,
 * and no evaluate ever returns a chained Editor.
 *
 * Run with preview (5173) + server (3001) up:  node scripts/eval-market-study.mjs
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// The founder's journey. `ground:true` steps select the board's cards first so
// the ask is grounded on the research; `mode` forces a "/" answer shape.
const STEPS = [
  { id: '1-opportunity', kind: 'research',
    text: 'Research the Airbnb and short-term-rental market in Bangalore, Chennai and Pondicherry — roughly how many active listings, what kind of hosts and properties, and how big the opportunity is for a dedicated laundry and linen service in each.' },
  { id: '2-competition', kind: 'research',
    text: 'Investigate what laundry, linen and turnover-cleaning options Airbnb hosts in Bangalore and Chennai actually use today — existing services and startups, local dhobis and laundries, what they charge, and where hosts are underserved.' },
  { id: '3-hostpain', kind: 'research',
    text: 'Dig into the biggest laundry and linen pain points Airbnb and homestay hosts in India face between guest stays — quality, reliability, turnaround time, pricing, and how they cope with turnovers today.' },
  { id: '4-pondicherry', kind: 'research',
    text: 'Research the homestay and Airbnb scene in Pondicherry specifically — how seasonal and tourist-driven it is, typical occupancy, and whether it is big enough to support a laundry and linen service the way a metro like Bangalore could.' },
  { id: '5-compare', kind: 'ground', mode: 'Table',
    text: 'Compare Bangalore, Chennai and Pondicherry as launch markets for this laundry-and-linen service — put listings / market size, existing competition, pricing power, seasonality, and ease of entry side by side.' },
  { id: '6-debrief', kind: 'ground', mode: 'Debrief',
    text: 'Given all of this, which of these three cities should I launch in first, what are the biggest risks to this business, and what should I do next to validate it?' },
];

let context;
const reqLog = [];

async function openPage(fresh) {
  const page = await context.newPage();
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url()) ? route.abort() : route.continue());
  if (fresh) {
    await page.addInitScript(() => {
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.includes('tldraw')) localStorage.removeItem(k); } catch {}
    });
  }
  page.on('request', (r) => {
    if (r.url().includes('/api/ask') && r.method() === 'POST') {
      try { const b = JSON.parse(r.postData() || '{}'); reqLog.push({ t: new Date().toISOString().slice(11, 19), shape: b.shape || '(auto)', sources: (b.sources || []).length, deep: !!b.deep, prompt: (b.prompt || '').slice(0, 60) }); } catch {}
    }
  });
  await page.goto(fresh ? `${WEB}/?start=1` : WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 30000 });
  await sleep(1600);
  const modal = page.locator('.jz-persona');
  if (await modal.count().catch(() => 0)) {
    const research = page.locator('.jz-persona-card', { hasText: 'Researching a topic' });
    if (await research.count().catch(() => 0)) await research.first().click().catch(() => {});
    else await page.locator('.jz-persona-skip').first().click().catch(() => {});
    await page.waitForSelector('.jz-persona', { state: 'detached', timeout: 8000 }).catch(() => {});
    await sleep(800);
  }
  return page;
}

// counts (all primitive returns)
const shapeCount = (page) => page.evaluate(() => window.editor.getCurrentPageShapes().length).catch(() => 0);
const runningCount = (page) => page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.props?.status === 'running').length).catch(() => 1);
const statusLine = (page) => page.evaluate(() => { const el = document.querySelector('.jz-agent-status, .jz-cursor-status, [class*="status"]'); return el ? (el.textContent || '').trim().slice(0, 80) : ''; }).catch(() => '');

async function ground(page) {
  // Select every card on the board so the next ask is grounded on the research.
  await page.evaluate(() => { window.editor.selectAll(); }); // block → undefined
  await sleep(400);
  const n = await page.evaluate(() => window.editor.getSelectedShapeIds().length).catch(() => 0);
  const ph = await page.locator('.jz-promptbar-input').getAttribute('placeholder').catch(() => '');
  log(`   grounding on ${n} selected card(s); placeholder = "${ph}"`);
  return n;
}

async function pickMode(page, label) {
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type('/');
  await page.waitForSelector('.jz-mode-menu', { timeout: 4000 }).catch(() => {});
  const item = page.locator('.jz-mode-item', { hasText: label });
  if (await item.count().catch(() => 0)) { await item.first().click().catch(() => {}); log(`   picked "/" ${label} mode`); return true; }
  log(`   "/" ${label} mode not found — falling back to prose phrasing`);
  await page.keyboard.press('Backspace');
  return false;
}

async function runStep(page, step) {
  const before = await shapeCount(page);
  if (step.kind === 'ground') await ground(page);
  if (step.mode) await pickMode(page, step.mode);
  await page.locator('.jz-promptbar-input').click();
  await page.keyboard.type(step.text, { delay: 2 });
  await sleep(200);
  await page.keyboard.press('Enter');
  log(`[${step.id}] submitted (${step.kind}${step.mode ? ' / ' + step.mode : ''})`);

  const deadline = Date.now() + 300_000;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(2500);
    const st = await statusLine(page);
    if (st && st !== last) { log(`   · ${st}`); last = st; }
    const grew = (await shapeCount(page)) > before;
    if (grew && (await runningCount(page)) === 0) break;
  }
  const grew = (await shapeCount(page)) > before;
  log(`[${step.id}] ${grew ? 'produced a card ✅' : 'no new card ⏱'}`);
  await sleep(4000); // flush IndexedDB
  return grew;
}

async function extractAll(page) {
  return page.evaluate(() =>
    window.editor.getCurrentPageShapes()
      .filter((s) => String(s.type).endsWith('-card'))
      .map((s) => {
        const p = s.props || {};
        const text = String(p.spec || p.markdown || p.text || p.content || p.body || (p.rows ? JSON.stringify(p.rows) : '') || '');
        return { type: s.type, title: String(p.title || ''), status: String(p.status || ''), chars: text.length, text: text.slice(0, 4000) };
      }));
}

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

  const outcomes = [];
  for (let i = 0; i < STEPS.length; i++) {
    const page = await openPage(i === 0);
    page.on('console', (m) => { if (m.type() === 'error') log('  [console.error]', m.text().slice(0, 90)); });
    if (i === 0) { log("Arjun opens Jarwiz. Goal: market study → build it? which city first?"); await page.screenshot({ path: `${OUT}/jz-study-0-empty.png` }); }
    else log(`Arjun reopens the board (${await shapeCount(page)} cards so far) for step ${step_label(i)}.`);
    let ok = false;
    try { ok = await runStep(page, STEPS[i]); } catch (e) { log(`  [${STEPS[i].id}] error`, e.message.split('\n')[0]); }
    try { await page.evaluate(() => { window.editor.zoomToFit(); }); await sleep(900); } catch {}
    await page.screenshot({ path: `${OUT}/jz-study-${STEPS[i].id}.png` }).catch(() => {});
    outcomes.push({ id: STEPS[i].id, ok });
    await page.close().catch(() => {});
  }

  log('Laying out the final board…');
  const page = await openPage(false);
  try {
    await page.evaluate(() => {
      const cards = window.editor.getCurrentPageShapes().filter((s) => String(s.type).endsWith('-card')).sort((a, b) => a.id.localeCompare(b.id));
      const COLS = 3, GAP = 140; const w = 640, h = 760;
      cards.forEach((c, i) => window.editor.updateShape({ id: c.id, type: c.type, x: (i % COLS) * (w + GAP), y: Math.floor(i / COLS) * (h + GAP) }));
    });
    await sleep(700);
    await page.evaluate(() => { window.editor.zoomToFit(); });
    await sleep(1200);
  } catch (e) { log('  arrange skipped', e.message.split('\n')[0]); }
  await page.screenshot({ path: `${OUT}/jz-study-BOARD.png` }).catch(() => {});
  const content = await extractAll(page).catch(() => []);
  writeFileSync(`${OUT}/jz-study-content.json`, JSON.stringify({ outcomes, reqLog, content }, null, 2));

  log(`\nStudy session done. ${outcomes.filter((o) => o.ok).length}/${STEPS.length} steps produced a card; ${content.length} cards on the board.`);
  log('Request evidence:'); reqLog.forEach((r) => log(`   ${r.t}  shape=${r.shape}  sources=${r.sources}  deep=${r.deep}  "${r.prompt}…"`));
  await browser.close();
  process.exit(0);
}
function step_label(i) { return STEPS[i].id; }

run().catch((e) => { console.error(e); process.exit(1); });
