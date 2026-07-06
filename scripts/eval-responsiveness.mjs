/**
 * Eval — Responsiveness P1 (streaming + skeletons + onboarding + launcher).
 * Run with preview + server up:  node scripts/eval-responsiveness.mjs
 *
 *  A. First-run onboarding dialog fires on a fresh install (was the bug)
 *  B. The agent launcher is labelled "Agents" (discoverable)
 *  C. An opinion agent gives feedback fast (skeleton/cursor/cancel < 1.5s) — never silent
 *  D. The result then streams in (text grows after the skeleton)
 *  E. Cancel removes the in-flight husk (no empty card left behind)
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
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
  return page;
}

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // ── A. First-run onboarding fires on a fresh install ────────────────────
  // Storage was cleared in addInitScript → genuine first run → dialog appears
  // after tldraw hydration (~400ms gate).
  await page.waitForSelector('.jz-boardentry', { timeout: 4000 }).catch(() => {});
  const onboarding = (await page.locator('.jz-boardentry').count()) > 0;
  record('First-run onboarding fires on fresh install', onboarding);
  await page.screenshot({ path: `${OUT}/jz-resp-onboarding.png` });
  if (onboarding) { await page.locator('.jz-boardentry-skip').click(); await sleep(400); }

  // ── B. Agent launcher is labelled ───────────────────────────────────────
  const label = await page.locator('.jz-promptbar-tools-label').innerText().catch(() => '');
  record('Agent launcher is labelled "Agents"', /agents/i.test(label), label);

  // Seed a small board with a real tension.
  await page.evaluate(() => {
    const mk = () => 'shape:' + Math.random().toString(36).slice(2);
    ['Ship in 2 weeks, speed over everything', 'Cover every edge case before launch', 'Enterprise wants a pilot first']
      .forEach((t, i) => window.editor.createShape({ id: mk(), type: 'note-card', x: 150 + i * 250, y: 220, props: { w: 230, h: 150, text: t, color: '#fbf6e9' } }));
    window.editor.zoomToFit();
  });
  await sleep(500);

  // ── C. Fast, never-silent feedback ──────────────────────────────────────
  await page.locator('.jz-promptbar-tools').click();
  await sleep(200);
  const t0 = Date.now();
  await page.locator('.jz-promptbar-menuitem', { hasText: 'tensions' }).click();
  let feedbackMs = -1;
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const skel = await page.locator('.jz-doc-skeleton').count();
    const task = await page.locator('.jz-task').count();
    const avatar = await page.locator('.jz-avatar').count();
    if (skel + task + avatar > 0) { feedbackMs = Date.now() - t0; break; }
  }
  record('Feedback appears fast (skeleton/cursor/cancel)', feedbackMs >= 0 && feedbackMs < 1500, `${feedbackMs}ms`);
  await page.screenshot({ path: `${OUT}/jz-resp-midflight.png` });

  // ── D. Result streams in (text grows) ───────────────────────────────────
  const docText = () => page.evaluate(() => {
    const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card' && s.props.title === 'Tensions');
    return d ? (d.props.text || '') : '';
  });
  let grew = false;
  let prev = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(700);
    const len = (await docText()).length;
    if (len > 0 && len > prev) grew = true;
    if (len > 40 && len === prev) break; // settled
    prev = len;
  }
  record('Result streams into the card', grew && prev > 40, `${prev} chars`);

  // ── E. Cancel removes the husk ──────────────────────────────────────────
  const beforeDocs = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);
  await page.locator('.jz-promptbar-tools').click();
  await sleep(200);
  await page.locator('.jz-promptbar-menuitem', { hasText: 'Devil' }).click();
  // Cancel as soon as the control appears (before content).
  await page.waitForSelector('.jz-task-cancel', { timeout: 3000 }).catch(() => {});
  await page.locator('.jz-task-cancel').click().catch(() => {});
  await sleep(800);
  const afterDocs = await page.evaluate(() => window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length);
  const taskGone = (await page.locator('.jz-task').count()) === 0;
  record('Cancel removes the in-flight husk', afterDocs === beforeDocs && taskGone, `docs ${beforeDocs}→${afterDocs} taskGone=${taskGone}`);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} responsiveness checks passed`);
  writeFileSync(`${OUT}/jz-resp-results.json`, JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
