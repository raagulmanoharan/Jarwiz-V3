/**
 * Visual + behavioral check for formatted (WYSIWYG) doc editing.
 * Creates a doc card with headings/bold/list/table, enters edit mode, and
 * asserts the editor renders FORMATTED (a .ProseMirror with <h1>/<strong>/
 * <table>) rather than raw markdown — then screenshots read vs edit.
 * Needs preview (:5173) + server (:3001) up. Run: node scripts/shot-docedit.mjs
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const WEB = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pe = (page, fn, arg) => page.evaluate(fn, arg); // callers use void bodies

const DOC = [
  '# Weekly Report',
  '',
  'Momentum comes from **shipping**, not __meetings__.',
  '',
  '- First point',
  '- Second point',
  '',
  '| Tool | Price |',
  '| --- | --- |',
  '| Figma | Free |',
].join('\n');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Block unreachable CDNs/fonts so the console stays clean.
await page.route('**/*', (route) =>
  /cdn\.tldraw\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(route.request().url()) ? route.abort() : route.continue(),
);
await page.goto(WEB, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
await pe(page, () => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });

// Create the doc card + frame it.
await pe(page, (text) => { window.editor.createShape({ type: 'doc-card', x: 200, y: 140, props: { w: 560, h: 420, title: 'Weekly Report', text } }); window.editor.zoomToFit(); }, DOC);
await sleep(600);
await page.screenshot({ path: '/tmp/jz-docedit-read.png' });

// Enter edit mode.
await pe(page, () => { const s = window.editor.getCurrentPageShapes().find((x) => x.type === 'doc-card'); window.editor.select(s.id); window.editor.setEditingShape(s.id); window.editor.setCurrentTool('select.editing_shape'); });
await sleep(700);
await page.screenshot({ path: '/tmp/jz-docedit-edit.png' });

// Assertions: the editor is formatted, not raw markdown.
const probe = await page.evaluate(() => {
  const pm = document.querySelector('.jz-doc-rich .ProseMirror');
  if (!pm) return { hasEditor: false };
  return {
    hasEditor: true,
    h1: Boolean(pm.querySelector('h1')),
    strong: Boolean(pm.querySelector('strong')),
    underline: Boolean(pm.querySelector('u')),
    list: Boolean(pm.querySelector('ul li')),
    table: Boolean(pm.querySelector('table')),
    // The raw markdown markers must NOT be visible as text.
    showsRawStars: pm.textContent.includes('**'),
    showsRawPipes: pm.textContent.includes('|'),
    showsRawHash: pm.textContent.trimStart().startsWith('#'),
  };
});
console.log('EDIT-MODE PROBE:', JSON.stringify(probe, null, 2));

// Behavioral: the format bar (CardActionBar) must DRIVE the rich editor now,
// not be dead chrome. Select all, click Bold, and confirm the doc text changes.
await page.evaluate(() => { const pm = document.querySelector('.jz-doc-rich .ProseMirror'); if (pm) pm.focus(); });
await page.keyboard.press('Control+a');
const before = await page.evaluate(() => window.editor.getCurrentPageShapes().find((x) => x.type === 'doc-card').props.text);
const boldBtn = await page.$('.jz-cardbar-iconbtn[title^="Bold"]');
let barWired = false;
if (boldBtn) {
  await boldBtn.click();
  await sleep(400);
  const after = await page.evaluate(() => window.editor.getCurrentPageShapes().find((x) => x.type === 'doc-card').props.text);
  barWired = after !== before;
  console.log('FORMAT-BAR bold → text changed:', barWired);
} else {
  console.log('FORMAT-BAR bold button not found');
}

const pass =
  probe.hasEditor && probe.h1 && probe.strong && probe.underline && probe.list && probe.table &&
  !probe.showsRawStars && !probe.showsRawPipes && !probe.showsRawHash && barWired;
console.log(pass ? '\n✓ Formatted editor renders, no raw markdown, format bar drives it' : '\n✗ Something is off — see probe above');

await browser.close();
process.exit(pass ? 0 : 1);
