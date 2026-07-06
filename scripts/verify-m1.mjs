/**
 * M1 end-to-end verification (headless).
 *
 * Drives the actual golden path in a real browser against the running dev
 * server: drop a YouTube link → a "Summarize this?" offer appears → tap it →
 * the Summarizer's cursor walks over, a summary card streams in word by word,
 * and an edge connects it to the source.
 *
 * Runs in mock mode (no ANTHROPIC_API_KEY needed). Asserts the presence and
 * streaming behaviors that ARE Milestone 1.
 */

import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const log = (...a) => console.log(...a);
const fail = (msg) => {
  console.error('❌ FAIL:', msg);
  process.exitCode = 1;
};

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[jarwiz]') || m.type() === 'error') log('  [browser]', t);
  });

  // Fresh board each run (best-effort; ignore if storage is restricted).
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('TLDRAW_DOCUMENT_v2jarwiz-board');
    } catch {
      /* storage not available in this context */
    }
  });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.jz-wordmark', { timeout: 15000 });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 15000 });
  await page.evaluate(() => {
    const ids = window.editor.getCurrentPageShapes().map((s) => s.id);
    if (ids.length) window.editor.deleteShapes(ids);
  });
  log('✓ canvas mounted');

  // Capture every status shown during the run (now on the agent avatar badge,
  // since the dock was removed in C2), so a fast mock run can't slip between
  // assertions.
  const dockStatuses = new Set();
  const sampler = setInterval(async () => {
    try {
      const txt = await page.evaluate(
        () => document.querySelector('.jz-avatar-status')?.textContent ?? '',
      );
      if (txt) dockStatuses.add(txt);
    } catch {
      /* page closing */
    }
  }, 60);

  // Drop a YouTube link by feeding the editor's external-content handler the
  // same way a paste would (the ingestion path under test).
  await page.evaluate((url) => {
    const editor = window.editor;
    editor.putExternalContent({ type: 'url', url });
  }, YT_URL);

  // The YouTube card lands.
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().some((s) => s.type === 'youtube-card'),
    { timeout: 8000 },
  );
  log('✓ YouTube card ingested');

  // The proactive offer chip appears.
  const offer = page.locator('.jz-offer-accept');
  await offer.waitFor({ timeout: 5000 });
  const offerText = (await offer.textContent())?.trim();
  if (offerText?.includes('Summarize this?')) log('✓ proactive offer chip shown:', offerText);
  else fail(`offer chip text unexpected: ${offerText}`);

  // Sample the doc card's text length continuously to prove it streams in.
  const lengths = [];
  let sawCursor = false;
  const streamSampler = setInterval(async () => {
    try {
      const snap = await page.evaluate(() => {
        const doc = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
        return {
          len: doc ? doc.props.text.length : 0,
          cursor: !!document.querySelector('.jz-cursor'),
        };
      });
      if (snap.len > 0) lengths.push(snap.len);
      if (snap.cursor) sawCursor = true;
    } catch {
      /* page closing */
    }
  }, 80);

  // Tap to accept → the run starts.
  await offer.click();
  log('✓ offer accepted');

  // Wait for the run to finish (the provenance edge is the last event).
  await page.waitForFunction(
    () => window.editor.getCurrentPageShapes().some((s) => s.type === 'arrow'),
    { timeout: 20000 },
  );
  clearInterval(sampler);
  clearInterval(streamSampler);

  // The dock reflected Summarizer activity at some point.
  const sawActivity = [...dockStatuses].some((t) =>
    /demo|writing|looking|working|connecting|done/i.test(t),
  );
  if (sawActivity) log('✓ dock reflected Summarizer activity during the run');
  else fail(`dock never showed activity; saw: ${[...dockStatuses].join(' | ')}`);

  // The agent cursor overlay rendered.
  if (sawCursor) log('✓ agent cursor appeared on canvas');
  else fail('agent cursor never rendered');

  // The summary streamed in incrementally rather than landing all at once.
  const grew = lengths.some((l, i) => i > 0 && l > lengths[i - 1]);
  if (grew) log('✓ summary streamed in incrementally:', lengths.slice(0, 8).join(' → '), '…');
  else fail(`doc card did not stream; lengths: ${lengths.join(',')}`);

  // Assert the provenance edge: bound source → summary, in the agent's color.
  const edge = await page.evaluate(() => {
    const arrow = window.editor.getCurrentPageShapes().find((s) => s.type === 'arrow');
    const bindings = window.editor
      .getBindingsInvolvingShape(arrow.id)
      .filter((b) => b.type === 'arrow');
    return { color: arrow.props.color, bindings: bindings.length };
  });
  if (edge.bindings === 2) log('✓ provenance edge bound source → summary');
  else fail(`edge has ${edge.bindings} bindings, expected 2`);
  if (edge.color === 'orange') log('✓ edge carries the Summarizer amber (orange) color');
  else fail(`edge color is ${edge.color}, expected orange`);

  // Final card text sanity.
  const finalText = await page.evaluate(() => {
    const doc = window.editor.getCurrentPageShapes().find((s) => s.type === 'doc-card');
    return doc?.props.text ?? '';
  });
  if (finalText.length > 80) log(`✓ summary card has ${finalText.length} chars of content`);
  else fail(`summary too short: ${finalText.length} chars`);

  await browser.close();
  if (process.exitCode) log('\n=== M1 verification FAILED ===');
  else log('\n=== M1 verification PASSED ✅ ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
