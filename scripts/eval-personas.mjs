/**
 * Synthetic-persona usability runs — drives REAL Ask calls through the UI (the
 * server uses the Claude CLI sidecar), capturing screenshots and timing each
 * flow the way three different users would actually work:
 *
 *   • Maya  — PM doing competitive analysis (asks for a comparison table)
 *   • Devin — engineer mapping a system (asks for a diagram, then refines it
 *             IN PLACE — "add a node" — to prove the same card updates)
 *   • Sam   — researcher ideating (asks for clustered sticky notes / affinity)
 *             and pulling action items (a checklist inside a card)
 *
 * Honest about the surface a real user touches: the Ask pill, the typed prompt,
 * the streaming draft, Keep, and follow-up refinement. Screenshots → /tmp.
 * Run with preview + server up:  node scripts/eval-personas.mjs
 */

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
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
    try { localStorage.removeItem('jz-onboarded'); } catch {}
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1500);
  return page;
}
const clear = (page) =>
  page.evaluate(() => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });
const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const seed = (page, spec) => page.evaluate((s) => { window.editor.createShape(s); }, spec);
const select = (page, id) => page.evaluate((i) => { window.editor.select(i); }, id);
const fit = (page) => page.evaluate(() => { window.editor.zoomToFit(); });
const countType = (page, t) => page.evaluate((tt) => window.editor.getCurrentPageShapes().filter((s) => s.type === tt).length, t);

/** Open the Ask pill on the current selection, type a prompt, submit. */
async function askType(page, prompt) {
  const pill = page.locator('.jz-ask-pill');
  await pill.first().click({ timeout: 8000 });
  await page.fill('.jz-ask-input', prompt);
  await page.press('.jz-ask-input', 'Enter');
}

/** Wait for the streaming draft to finish (Keep button appears) or error. */
async function waitDraftDone(page, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.locator('.jz-draft-keep').count().catch(() => 0)) return 'done';
    if (await page.locator('.jz-draft-err').count().catch(() => 0)) return 'error';
    await sleep(700);
  }
  return 'timeout';
}
async function keep(page) {
  const k = page.locator('.jz-draft-keep');
  if (await k.count()) await k.click().catch(() => {});
  await sleep(800);
}

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await open();

  // ── Maya — PM: competitive comparison → table ────────────────────────────
  log('\n▶ Maya (PM): compare three tools as a table');
  await clear(page);
  const mayaSrc = nid();
  await seed(page, {
    id: mayaSrc, type: 'doc-card', x: 200, y: 200,
    props: {
      w: 520, h: 360, title: 'Tool options', sourcePdfId: '',
      text: 'We are choosing a project tool.\n\nLinear: fast, keyboard-driven, opinionated, $8/user, great for engineering.\n\nAsana: flexible, good for cross-functional teams, $11/user, lots of views.\n\nNotion: all-in-one docs+tasks, $10/user, weaker for sprint tracking.',
    },
  });
  await sleep(600);
  await fit(page);
  await sleep(400);
  await select(page, mayaSrc);
  await sleep(800);
  let t0 = Date.now();
  await askType(page, 'Compare these three tools as a table');
  let st = await waitDraftDone(page);
  const tableCount = await countType(page, 'table-card');
  record('Maya: comparison renders as a table', st === 'done' && tableCount >= 1, `${st}, ${tableCount} table, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await fit(page); await sleep(500);
  await page.screenshot({ path: `${OUT}/jz-persona-maya-table.png` });
  await keep(page);

  // ── Devin — engineer: diagram, then in-place refine ──────────────────────
  log('\n▶ Devin (engineer): diagram a login flow, then add a node in place');
  await clear(page);
  const devinSrc = nid();
  await seed(page, {
    id: devinSrc, type: 'doc-card', x: 200, y: 200,
    props: {
      w: 520, h: 360, title: 'Login flow', sourcePdfId: '',
      text: 'User opens the app. If they have a valid session they go straight to the dashboard. Otherwise they see the login screen, enter credentials, which are validated. On success they reach the dashboard; on failure they see an error and can retry.',
    },
  });
  await sleep(600);
  await fit(page);
  await sleep(400);
  await select(page, devinSrc);
  await sleep(800);
  t0 = Date.now();
  await askType(page, 'Create a flowchart diagram of this login flow');
  st = await waitDraftDone(page);
  const diagCount1 = await countType(page, 'diagram-card');
  record('Devin: flow renders as a diagram', st === 'done' && diagCount1 >= 1, `${st}, ${diagCount1} diagram, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await fit(page); await sleep(800);
  await page.screenshot({ path: `${OUT}/jz-persona-devin-diagram.png` });
  await keep(page); // selects the diagram

  // In-place refine: the SAME diagram should update (count stays the same).
  const diagId = await page.evaluate(() => window.editor.getCurrentPageShapes().find((s) => s.type === 'diagram-card')?.id);
  const codeBefore = await page.evaluate((i) => window.editor.getShape(i)?.props?.code ?? '', diagId);
  await select(page, diagId);
  await sleep(800);
  t0 = Date.now();
  await askType(page, 'Add a node for password reset');
  // in-place has no draft — wait for code to change and the stream caret to clear
  let codeAfter = codeBefore;
  for (let i = 0; i < 160; i++) {
    await sleep(800);
    codeAfter = await page.evaluate((x) => window.editor.getShape(x)?.props?.code ?? '', diagId);
    const caret = await page.locator('.jz-stream-caret').count().catch(() => 0);
    if (codeAfter && codeAfter !== codeBefore && caret === 0) break;
  }
  const diagCount2 = await countType(page, 'diagram-card');
  record('Devin: refinement updates the SAME diagram (no new card)', diagCount2 === diagCount1 && codeAfter !== codeBefore, `${diagCount1}→${diagCount2} diagram, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await fit(page); await sleep(800);
  await page.screenshot({ path: `${OUT}/jz-persona-devin-refined.png` });

  // ── Sam — researcher: affinity brainstorm, then action items ─────────────
  log('\n▶ Sam (researcher): brainstorm ideas as clustered sticky notes');
  await clear(page);
  const samSrc = nid();
  await seed(page, {
    id: samSrc, type: 'note-card', x: 300, y: 260,
    props: { w: 260, h: 150, text: 'How might we reduce new-user churn in the first week?', color: '#fbf6e9' },
  });
  await sleep(600);
  await fit(page);
  await sleep(400);
  await select(page, samSrc);
  await sleep(800);
  t0 = Date.now();
  await askType(page, 'Brainstorm ideas to solve this as clustered sticky notes');
  st = await waitDraftDone(page);
  const notes = await countType(page, 'note-card');
  record('Sam: brainstorm renders clustered sticky notes (affinity)', st === 'done' && notes >= 4, `${st}, ${notes} notes, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await fit(page); await sleep(500);
  await page.screenshot({ path: `${OUT}/jz-persona-sam-affinity.png` });
  await keep(page);

  log('\n▶ Sam: pull action items as a checklist');
  await clear(page);
  const samNotes = nid();
  await seed(page, {
    id: samNotes, type: 'doc-card', x: 200, y: 200,
    props: {
      w: 520, h: 360, title: 'Kickoff notes', sourcePdfId: '',
      text: 'We agreed Dana will draft the onboarding email by Friday. The team needs to pick an analytics tool. Someone should interview five churned users. We also need to ship the welcome checklist and update the pricing page.',
    },
  });
  await sleep(600);
  await fit(page);
  await sleep(400);
  await select(page, samNotes);
  await sleep(800);
  t0 = Date.now();
  await askType(page, 'Extract the action items as a checklist');
  st = await waitDraftDone(page);
  await sleep(400);
  const checkboxes = await page.locator('.jz-md-checkbox').count().catch(() => 0);
  record('Sam: action items render as a live checklist', st === 'done' && checkboxes >= 3, `${st}, ${checkboxes} checkboxes, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await fit(page); await sleep(500);
  await page.screenshot({ path: `${OUT}/jz-persona-sam-checklist.png` });
  await keep(page);

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  log(`\n${passed}/${results.length} persona flows passed`);
  writeFileSync(`${OUT}/jz-persona-results.json`, JSON.stringify(results, null, 2));
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
