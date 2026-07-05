/**
 * Dogfood-fixes + owner-directives eval (2026-07-05): empty-source gating,
 * truly-blank onboarding, "/" mode selector forcing a shape, the sticky tool,
 * image drop ingestion, and grouped+muted generated flowcharts.
 * Needs a model for the forced-table and flowchart phases.
 *
 * Run with preview (:5173) + server (:3001) up:  node scripts/eval-fixes.mjs
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGP8z4AATAxIgGocOAMAQaYBD1CBM60AAAAASUVORK5CYII=',
  'base64',
);

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(1000);

  // ── 1. Blank onboarding leaves a blank canvas ────────────────────────────
  if (await page.isVisible('.jz-boardentry')) {
    await page.fill('.jz-boardentry-input', 'Fix-check board');
    await page.keyboard.press('Enter');
    await sleep(800);
    const shapes = await page.evaluate(() => window.editor.getCurrentPageShapeIds().size);
    record('"Start blank" creates nothing', shapes === 0, `${shapes} shapes`);
  } else record('"Start blank" creates nothing', false, 'no onboarding dialog');

  // ── 2. Asking about an EMPTY card refuses with an honest pill ────────────
  await page.evaluate(() => {
    window.editor.createShape({ type: 'doc-card', x: 200, y: 160, props: { title: 'Empty starter', text: '' } });
    const d = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
    window.editor.select(d.id);
  });
  await sleep(400);
  await page.fill('.jz-promptbar-input', 'Brainstorm the concerns as sticky notes.');
  await page.focus('.jz-promptbar-input');
  await page.keyboard.press('Enter');
  const gateErr = await page
    .waitForSelector('.jz-task--error', { timeout: 5000 })
    .then((el) => el.textContent())
    .catch(() => null);
  const noteCards = await page.evaluate(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length,
  );
  record(
    'empty-card ask refuses honestly, creates nothing',
    Boolean(gateErr && /empty/i.test(gateErr)) && noteCards === 0,
    gateErr ?? 'no pill',
  );
  await page.screenshot({ path: '/tmp/jz-fix-empty-gate.png' });

  // ── 3. Sticky tool spawns ONE editable sticky ────────────────────────────
  await page.keyboard.press('Escape');
  await page.click('.jz-rail-tool[aria-label="Sticky note"]');
  await sleep(600);
  const stickies = await page.evaluate(() => {
    const notes = window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card');
    return { count: notes.length, editing: window.editor.getEditingShapeId() === notes[0]?.id, color: notes[0]?.props.color };
  });
  record('rail sticky tool: one sticky, open for typing', stickies.count === 1 && stickies.editing, `color ${stickies.color}`);
  await page.keyboard.type('Check the guard-cost claim against our workload');
  await page.keyboard.press('Escape');

  // ── 4. Image drop lands as an image card ─────────────────────────────────
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'sketch.png', { type: 'image/png' }));
    const target = document.querySelector('.tl-container');
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2 + 200, clientY: r.top + r.height / 2 + 100, dataTransfer: dt };
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  }, PNG.toString('base64'));
  await sleep(1200);
  const imgCard = await page.evaluate(() => {
    const img = window.editor.getCurrentPageShapes().find((s) => s.type === 'image-card');
    return img ? { name: img.props.name, isData: img.props.src.startsWith('data:image/png') } : null;
  });
  record('dropped PNG lands as an image card', Boolean(imgCard?.isData), imgCard?.name ?? 'none');

  // ── 5. "/" opens the mode menu; picking Table forces a table answer ─────
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'doc-card', x: 900, y: 160,
      props: {
        title: 'Migration notes',
        text: 'The migration has three phases. Phase one moves read traffic behind the proxy in week one. Phase two moves writes with dual-writing in weeks two and three. Phase three decommissions the old cluster in week four.',
      },
    });
    const docs = window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card');
    window.editor.select(docs[docs.length - 1].id);
  });
  await sleep(400);
  await page.click('.jz-promptbar-input');
  await page.keyboard.type('/');
  const menuOpen = await page.waitForSelector('.jz-mode-menu', { timeout: 3000 }).then(() => true).catch(() => false);
  record('typing "/" opens the mode menu', menuOpen);
  await page.screenshot({ path: '/tmp/jz-fix-mode-menu.png' });
  await page.click('.jz-mode-item:has-text("Table")');
  const chip = await page.textContent('.jz-pb-mode').catch(() => null);
  record('picking a mode pins the chip', Boolean(chip && /table/i.test(chip)), chip ?? 'none');
  await page.keyboard.type('Summarize the migration phases.'); // NO table wording — the mode must force it
  await page.keyboard.press('Enter');
  await page.waitForSelector('.jz-draft-keep', { timeout: 180_000 });
  const forced = await page.evaluate(() => {
    const t = window.editor.getCurrentPageShapes().filter((s) => s.type === 'table-card');
    return t.length ? `${t[t.length - 1].props.columns.length} cols` : null;
  });
  record('the mode FORCES the answer shape (table without table wording)', Boolean(forced), forced ?? 'no table');
  await page.click('.jz-draft-keep');
  await sleep(400);

  // ── 6. Generated flowchart: grouped, muted, askable as one unit ─────────
  await page.evaluate(() => {
    const docs = window.editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card');
    window.editor.select(docs[docs.length - 1].id);
  });
  await sleep(300);
  await page.click('.jz-cardbar-btn:has-text("Refine")');
  await page.click('.jz-cardbar-item:has-text("flowchart")');
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().some((s) => s.type === 'group'),
    null,
    { timeout: 240_000 },
  );
  await sleep(800);
  const flow = await page.evaluate(() => {
    const group = window.editor.getCurrentPageShapes().find((s) => s.type === 'group');
    const kids = window.editor.getSortedChildIdsForParent(group.id).map((id) => window.editor.getShape(id));
    const geos = kids.filter((k) => k.type === 'geo');
    return {
      selectedIsGroup: window.editor.getOnlySelectedShapeId() === group.id,
      kidCount: kids.length,
      allGrey: geos.every((g) => g.props.color === 'grey' && g.props.fill === 'semi'),
    };
  });
  record(
    'flowchart lands as ONE group, selected, muted grey',
    flow.selectedIsGroup && flow.kidCount >= 3 && flow.allGrey,
    `${flow.kidCount} children, grey=${flow.allGrey}`,
  );
  const groundChip = await page.textContent('.jz-pb-ground').catch(() => null);
  record('the group grounds an ask as one unit', Boolean(groundChip), `chip: ${groundChip ?? 'none'}`);
  await page.screenshot({ path: '/tmp/jz-fix-flowchart-group.png' });

  await page.close();
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
