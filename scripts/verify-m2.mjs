/**
 * M2 end-to-end verification (headless).
 *
 * Drives the new agents against the running dev server (mock mode):
 *   1. Type an idea note → summon the Researcher → a fan of link cards
 *      streams in, each connected to the idea with a blue edge.
 *   2. Select the idea + a source (multi-select) → summon the Brainstormer →
 *      sticky notes fan out, each connected with a pink edge.
 *
 * Asserts the M2 behaviors: link-card creation, note fan-out, multi-select
 * summoning, incremental placement, and agent-colored provenance edges.
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error('❌ FAIL:', m);
  process.exitCode = 1;
};

const countByType = (page) =>
  page.evaluate(() => {
    const byType = {};
    for (const s of window.editor.getCurrentPageShapes()) byType[s.type] = (byType[s.type] ?? 0) + 1;
    return byType;
  });

async function summon(page, agentName) {
  // Open the "Ask an agent" menu and pick the named agent.
  await page.locator('.jz-ask-button').click();
  await page.locator('.jz-ask-item-name', { hasText: agentName }).click();
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', (m) => {
    if (m.text().includes('[jarwiz]') && m.type() === 'error') log('  [browser]', m.text());
  });

  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="agent-dock"]', { timeout: 15000 });
  await page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });
  log('✓ canvas + dock mounted');

  // 1. Create an idea note and select it.
  const ideaId = await page.evaluate(() => {
    const id = 'shape:idea1';
    window.editor.createShape({
      id,
      type: 'note-card',
      x: 100,
      y: 300,
      props: { w: 220, h: 220, text: 'Video: why everyone is wrong about spaced repetition' },
    });
    window.editor.select(id);
    return id;
  });
  log('✓ idea note created and selected');

  // Summon the Researcher.
  await summon(page, 'Researcher');
  log('✓ Researcher summoned');

  // Link cards fan in (at least 3).
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'link-card').length >= 3,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').length >= 3,
    { timeout: 20000 },
  );
  const afterResearch = await countByType(page);
  log('✓ Researcher placed link cards + edges:', JSON.stringify(afterResearch));

  // The research edges are the Researcher's blue.
  const blueEdges = await page.evaluate(() =>
    window.editor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'arrow' && s.props.color === 'blue').length,
  );
  if (blueEdges >= 3) log(`✓ ${blueEdges} provenance edges in Researcher blue`);
  else fail(`expected ≥3 blue edges, got ${blueEdges}`);

  // 2. Multi-select the idea + first link card, summon the Brainstormer.
  await page.evaluate((idea) => {
    const link = window.editor.getCurrentPageShapes().find((s) => s.type === 'link-card');
    window.editor.setSelectedShapes([idea, link.id]);
  }, ideaId);
  const selCount = await page.evaluate(() => window.editor.getSelectedShapeIds().length);
  if (selCount === 2) log('✓ multi-selection of 2 cards');
  else fail(`expected 2 selected, got ${selCount}`);

  await summon(page, 'Brainstormer');
  log('✓ Brainstormer summoned on the cluster');

  // Sticky notes fan out (idea note + at least 5 new notes = ≥6).
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length >= 6,
    { timeout: 20000 },
  );
  // Wait for the run to settle (all idea edges drawn).
  await page.waitForFunction(
    () =>
      window.editor.getCurrentPageShapes().filter((s) => s.type === 'arrow' && s.props.color === 'light-red')
        .length >= 5,
    { timeout: 20000 },
  );
  const afterBrainstorm = await countByType(page);
  log('✓ Brainstormer fanned out notes + edges:', JSON.stringify(afterBrainstorm));

  // Notes carry real idea text (not empty).
  const noteText = await page.evaluate(() => {
    const notes = window.editor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'note-card' && s.props.text.includes('demo'));
    return notes.map((n) => n.props.text.length);
  });
  if (noteText.length >= 5 && noteText.every((l) => l > 5))
    log(`✓ ${noteText.length} idea notes have content`);
  else fail(`brainstormer notes look empty: ${JSON.stringify(noteText)}`);

  // Edges are bound (provenance is real, not floating arrows).
  const boundEdges = await page.evaluate(() => {
    const arrows = window.editor.getCurrentPageShapes().filter((s) => s.type === 'arrow');
    return arrows.filter(
      (a) => window.editor.getBindingsInvolvingShape(a.id, 'arrow').length === 2,
    ).length;
  });
  if (boundEdges === afterBrainstorm.arrow) log(`✓ all ${boundEdges} edges are bound source → artifact`);
  else fail(`only ${boundEdges}/${afterBrainstorm.arrow} edges are bound`);

  await browser.close();
  if (process.exitCode) log('\n=== M2 verification FAILED ===');
  else log('\n=== M2 verification PASSED ✅ ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
