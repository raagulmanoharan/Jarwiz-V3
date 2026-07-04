/**
 * Backup/restore eval — drives the REAL flow in a browser against the preview
 * build: seed a board with content, back it up to a file (a real download),
 * wreck the workspace, restore from the file, and assert the content is back.
 *
 * Follows the eval-ui.mjs canon: editor-mutating evaluates use `{ … }` bodies
 * (never return the Editor), servers run as background tasks, CDN requests are
 * blocked. Run with preview (:5173) + server (:3001) up:
 *
 *   node scripts/eval-backup.mjs
 */

import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');

const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

let browser;
async function open(url = WEB) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) =>
    /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(route.request().url())
      ? route.abort()
      : route.continue(),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(600);
  return page;
}

async function run() {
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const dir = mkdtempSync(join(tmpdir(), 'jz-backup-eval-'));

  // ── Seed: one note on the default board ──────────────────────────────────
  let page = await open();
  await page.evaluate(() => {
    const dialog = document.querySelector('.jz-boardentry');
    if (dialog) dialog.querySelector('.jz-boardentry-skip, button')?.click();
  });
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'note-card',
      x: 200,
      y: 200,
      props: { text: 'BACKUP-CANARY note survives the round trip' },
    });
  });
  await sleep(1200); // let tldraw's throttled persister flush to IndexedDB
  const seeded = await page.evaluate(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'note-card').length,
  );
  record('seed: canary note on the board', seeded === 1, `${seeded} note(s)`);

  // ── Export: side panel → Back up to file → real download ────────────────
  await page.click('.jz-logo-btn');
  await page.waitForSelector('.jz-side');
  const backupVisible = await page.isVisible('text=Back up to file');
  record('side panel shows the Backup section', backupVisible);
  await page.screenshot({ path: '/tmp/jz-backup-panel.png' });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.click('text=Back up to file'),
  ]);
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  record(
    'backup file downloads with the board + canary inside',
    backup.app === 'jarwiz' &&
      backup.version === 1 &&
      backup.boards.length >= 1 &&
      JSON.stringify(backup.boards).includes('BACKUP-CANARY'),
    `${backup.boards.length} board(s), ${backup.serverAssets.length} server asset(s)`,
  );
  const statusNote = await page.textContent('.jz-side-note').catch(() => null);
  record('honest status note after backup', /Backed up 1 board/.test(statusNote ?? ''), statusNote ?? 'none');

  // ── Wreck the workspace: delete the canary, add an impostor ─────────────
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const ids = window.editor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'note-card')
      .map((s) => s.id);
    window.editor.deleteShapes(ids);
  });
  await page.evaluate(() => {
    window.editor.createShape({
      type: 'note-card',
      x: 400,
      y: 400,
      props: { text: 'IMPOSTOR — must vanish after restore' },
    });
  });
  await sleep(1200);

  // ── Restore: pick the file, confirm, wait for the reload ────────────────
  await page.click('.jz-logo-btn');
  await page.waitForSelector('.jz-side');
  await page.setInputFiles('.jz-side input[type=file]', file);
  await page.waitForSelector('.jz-side-restore');
  const confirmText = await page.textContent('.jz-side-restore-text');
  record(
    'restore asks before replacing anything',
    /Replace everything with 1 board/.test(confirmText ?? ''),
    confirmText?.trim(),
  );
  await page.screenshot({ path: '/tmp/jz-restore-confirm.png' });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    page.click('.jz-side-restore-go'),
  ]);
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(1500);

  const after = await page.evaluate(() =>
    window.editor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'note-card')
      .map((s) => s.props.text),
  );
  record(
    'canary is back, impostor is gone',
    after.length === 1 && /BACKUP-CANARY/.test(after[0] ?? ''),
    JSON.stringify(after),
  );
  await page.screenshot({ path: '/tmp/jz-after-restore.png' });

  // ── PDF bytes round-trip a wiped server ─────────────────────────────────
  // The blob store is a temp dir; the backup embeds the bytes and restore
  // re-uploads them under the original id, so cards keep working URLs.
  const pdfB64 = readFileSync('scripts/eval-pdfs/long-contract.pdf').toString('base64');
  const assetUrl = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const presign = await (await fetch('/api/assets/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'pdf' }),
    })).json();
    await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Blob([bytes], { type: 'application/pdf' }),
    });
    return presign.getUrl;
  }, pdfB64);
  await page.evaluate((src) => {
    window.editor.createShape({
      type: 'pdf-card',
      x: 700,
      y: 200,
      props: { src, assetId: src.split('/').pop(), name: 'contract.pdf', status: 'ready' },
    });
  }, assetUrl);
  await sleep(1500);

  const [download2] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    (async () => {
      await page.click('.jz-logo-btn');
      await page.waitForSelector('.jz-side');
      await page.click('text=Back up to file');
    })(),
  ]);
  const file2 = join(dir, 'with-pdf.json');
  await download2.saveAs(file2);
  const backup2 = JSON.parse(readFileSync(file2, 'utf8'));
  record(
    'backup embeds the PDF bytes from the server blob store',
    backup2.serverAssets.length === 1 && backup2.serverAssets[0].b64.length > 100_000,
    `${backup2.serverAssets.length} asset(s), ${Math.round((backup2.serverAssets[0]?.b64.length ?? 0) / 1024)}kB b64`,
  );

  // Simulate a fresh server: wipe the blob store, confirm the URL is dead.
  const { rmSync } = await import('node:fs');
  rmSync('/tmp/jarwiz-assets', { recursive: true, force: true });
  const deadStatus = await page.evaluate(async (u) => (await fetch(u)).status, assetUrl);
  record('asset URL is dead after the server wipe', deadStatus === 404, `GET → ${deadStatus}`);

  await page.setInputFiles('.jz-side input[type=file]', file2);
  await page.waitForSelector('.jz-side-restore');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    page.click('.jz-side-restore-go'),
  ]);
  await page.waitForFunction(() => Boolean(window.editor), null, { timeout: 20_000 });
  await sleep(1500);
  const revived = await page.evaluate(async (u) => {
    const res = await fetch(u);
    return { status: res.status, bytes: (await res.arrayBuffer()).byteLength };
  }, assetUrl);
  const pdfCards = await page.evaluate(
    () => window.editor.getCurrentPageShapes().filter((s) => s.type === 'pdf-card').length,
  );
  record(
    'restore re-uploads the PDF — card URL works on the wiped server',
    revived.status === 200 && revived.bytes === 222880 && pdfCards === 1,
    `GET → ${revived.status}, ${revived.bytes} bytes, ${pdfCards} pdf card(s)`,
  );

  // ── Reject junk: a non-backup file shows an error, touches nothing ──────
  const junk = join(dir, 'junk.json');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(junk, JSON.stringify({ hello: 'world' }));
  await page.click('.jz-logo-btn');
  await page.waitForSelector('.jz-side');
  await page.setInputFiles('.jz-side input[type=file]', junk);
  await page.waitForSelector('.jz-side-note--danger');
  const err = await page.textContent('.jz-side-note--danger');
  record('junk file is rejected with a clear error', /not a Jarwiz backup/.test(err ?? ''), err ?? '');

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
