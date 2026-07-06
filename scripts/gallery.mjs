/**
 * Feature gallery — one clean, labelled screenshot per feature, from seeded
 * shapes so it's fast and deterministic (no model calls). Output → /tmp/gal-*.png.
 * Run with preview up:  node scripts/gallery.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB = 'http://localhost:5173';
const OUT = '/tmp';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let browser, page;
async function fresh() {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (r) => /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(r.request().url()) ? r.abort() : r.continue());
  await page.addInitScript(() => { try { localStorage.removeItem('jz-onboarded'); } catch {} });
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
  await sleep(1400);
}
const clear = () => page.evaluate(() => { const ids = window.editor.getCurrentPageShapes().map((s) => s.id); if (ids.length) window.editor.deleteShapes(ids); });
const nid = () => 'shape:' + Math.random().toString(36).slice(2);
const seed = (spec) => page.evaluate((s) => { window.editor.createShape(s); }, spec);
const fit = () => page.evaluate(() => { window.editor.zoomToFit(); });
const shot = (name) => page.screenshot({ path: `${OUT}/gal-${name}.png` });

async function run() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // 01 — empty canvas
  await fresh(); await clear(); await sleep(400); await shot('01-empty');

  // 02 — sticky note primitive
  await fresh(); await clear();
  await seed({ id: nid(), type: 'note-card', x: 400, y: 300, props: { w: 260, h: 150, text: 'Drop a sticky anywhere — press “n” or use the dock.', color: '#fbf6e9' } });
  await sleep(400); await fit(); await sleep(300); await shot('02-sticky');

  // 03 — doc card (markdown)
  await fresh(); await clear();
  await seed({ id: nid(), type: 'doc-card', x: 200, y: 160, props: { w: 540, h: 360, title: 'Positioning brief', sourcePdfId: '', text: '## Summary\n\nJarwiz turns a canvas into a place where **live agents** build artifacts with you.\n\n- Zero to finished, on one surface\n- Every answer cites its source [p.3]\n- Combine cards to make new ones' } });
  await sleep(500); await fit(); await sleep(400); await shot('03-doc');

  // 04 — in-card checklist (live checkboxes)
  await fresh(); await clear();
  await seed({ id: nid(), type: 'doc-card', x: 200, y: 160, props: { w: 520, h: 320, title: 'Action items', sourcePdfId: '', text: '- [ ] Finalise pricing\n- [ ] Security review\n- [x] Draft announcement\n- [ ] Ship welcome checklist' } });
  await sleep(500); await fit(); await sleep(400); await shot('04-checklist');

  // 05 — table (read)
  await fresh(); await clear();
  await seed({ id: nid(), type: 'table-card', x: 200, y: 200, props: { w: 620, h: 220, columns: ['Tool', 'Style', 'Price/User', 'Best for'], rows: [['Linear', 'Fast, opinionated', '$8', 'Engineering'], ['Asana', 'Flexible', '$11', 'Cross-functional'], ['Notion', 'All-in-one', '$10', 'Docs + tasks']] } });
  await sleep(500); await fit(); await sleep(400); await shot('05-table');

  // 06 — table editing (add/delete row & column)
  const tid = nid();
  await seed({ id: tid, type: 'table-card', x: 200, y: 560, props: { w: 560, h: 200, columns: ['Option', 'Cost', 'Speed'], rows: [['A', '$10', 'Fast'], ['B', '$25', 'Faster']] } });
  await page.evaluate((i) => { window.editor.select(i); window.editor.setEditingShape(i); }, tid);
  await sleep(800);
  await page.evaluate((i) => { const b = window.editor.getShapePageBounds(i); window.editor.zoomToBounds(b, { inset: 120 }); }, tid);
  await sleep(500); await shot('06-table-edit');

  // 07 — diagram (renders whole, no expand)
  await fresh(); await clear();
  await seed({ id: nid(), type: 'diagram-card', x: 200, y: 160, props: { w: 560, h: 380, title: 'Login flow', code: 'flowchart TD\n A[Start] --> B{Logged in?}\n B -- No --> C[Login screen]\n C --> D[Enter credentials]\n D --> E{Valid?}\n E -- Yes --> F[Dashboard]\n E -- No --> G[Show error] --> C\n B -- Yes --> F' } });
  await sleep(3500); await fit(); await sleep(700); await shot('07-diagram');

  // 08 — affinity board (clustered, colour-coded)
  await fresh(); await clear();
  const cols = ['#e8f0ff', '#fdeaf1', '#eafaf0'];
  const labels = ['Onboarding', 'Trust', 'Activation'];
  const notes = [['Faster first run', 'Fewer steps', 'Templates'], ['Clear data policy', 'Visible security', 'No surprises'], ['Aha in 5 min', 'Sample project', 'Nudge emails']];
  for (let c = 0; c < 3; c++) {
    const x = 160 + c * 240;
    await seed({ id: nid(), type: 'note-card', x, y: 160, props: { w: 200, h: 40, text: labels[c], color: cols[c] } });
    for (let n = 0; n < 3; n++) await seed({ id: nid(), type: 'note-card', x, y: 212 + n * 104, props: { w: 200, h: 92, text: notes[c][n], color: cols[c] } });
  }
  await sleep(500); await fit(); await sleep(400); await shot('08-affinity');

  // 09 — Ask affordance + follow-up chips on a single answer card
  await fresh(); await clear();
  const did = nid();
  await seed({ id: did, type: 'doc-card', x: 200, y: 200, props: { w: 520, h: 300, title: 'Remote work policy', sourcePdfId: '', text: 'Up to three remote days a week. Managers approve quarterly. Stipend up to $500 annually.' } });
  await sleep(400); await fit(); await sleep(300);
  await page.evaluate((i) => { window.editor.select(i); }, did);
  await sleep(900); await shot('09-ask-chips');

  // 10 — multi-select: combine sources (pill shows what it fuses)
  await fresh(); await clear();
  const d2 = nid(), im = nid();
  await seed({ id: d2, type: 'doc-card', x: 120, y: 220, props: { w: 440, h: 280, title: 'Q3 notes', sourcePdfId: '', text: 'Revenue up 20% QoQ. Churn down to 3%. Two new enterprise logos.' } });
  await seed({ id: im, type: 'image-card', x: 640, y: 220, props: { w: 320, h: 240, src: PNG, name: 'chart.png' } });
  await sleep(400); await fit(); await sleep(300);
  await page.evaluate(([a, b]) => { window.editor.select(a, b); }, [d2, im]);
  await sleep(900); await shot('10-combine-pill');

  await browser.close();
  console.log('gallery captured');
}
run().catch((e) => { console.error(e); process.exit(1); });
