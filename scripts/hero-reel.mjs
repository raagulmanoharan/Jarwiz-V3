// hero-reel.mjs — render scripts/hero-reel.html frame by frame and encode the
// marketing "cards fly in" GIF at site/assets/hero-reel.gif.
//
// The reel page exposes a deterministic clock, window.setReel(u) with u in
// [0,1). We step that clock across N frames, screenshot each, and encode the
// frames into a seamless looping GIF (one global palette — the design is
// near-monochrome, so 256 colours is plenty and keeps the file small).
//
// Deps: playwright (global) + gifenc + pngjs. gifenc/pngjs are resolved from
//   GIF_NODE_MODULES (a node_modules dir with both installed):
//     npm i --prefix "$TMP" gifenc pngjs && GIF_NODE_MODULES="$TMP/node_modules" \
//       node scripts/hero-reel.mjs
//
// Tunables (env): FRAMES (default 96), DELAY ms per frame (default 55),
//   SIZE px square (default 1080), OUT (default site/assets/hero-reel.gif).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const pwRequire = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = pwRequire('playwright');

const gifModules = process.env.GIF_NODE_MODULES;
if (!gifModules) throw new Error('Set GIF_NODE_MODULES to a node_modules dir with gifenc + pngjs installed.');
const gifRequire = createRequire(resolve(gifModules) + '/');
const { GIFEncoder, quantize, applyPalette } = gifRequire('gifenc');
const { PNG } = gifRequire('pngjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REEL = resolve(__dirname, 'hero-reel.html');
const OUT = resolve(process.env.OUT || resolve(__dirname, '../site/assets/hero-reel.gif'));
const SIZE = parseInt(process.env.SIZE || '1080', 10);
const FRAMES = parseInt(process.env.FRAMES || '96', 10);
const DELAY = parseInt(process.env.DELAY || '55', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Rendering ${FRAMES} frames @ ${SIZE}px, ${DELAY}ms/frame → ${OUT}`);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  // Block webfonts/CDN (unreachable in the sandbox) so nothing hangs the load.
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (/fonts\.(googleapis|gstatic)\.com|cdn\.tldraw\.com/.test(u)) return route.abort();
    return route.continue();
  });

  await page.goto('file://' + REEL, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.reelReady === true', { timeout: 15000 });
  await sleep(500); // let the prototype iframe + flow.svg paint

  const clip = { x: 0, y: 0, width: SIZE, height: SIZE };
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((u) => window.setReel(u), i / FRAMES);
    const buf = await page.screenshot({ clip, type: 'png' });
    const png = PNG.sync.read(buf);
    frames.push(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength));
    if ((i + 1) % 12 === 0) console.log(`  captured ${i + 1}/${FRAMES}`);
  }
  await browser.close();

  // One global palette, sampled from frames spread across the loop (the fully
  // zoomed-out frames carry the most colour). Avoids per-frame flicker + shrinks
  // the file (single global colour table instead of one per frame).
  console.log('Building global palette…');
  const nSamp = Math.min(10, FRAMES);
  const sample = new Uint8Array(nSamp * SIZE * SIZE * 4);
  for (let s = 0; s < nSamp; s++) {
    const fi = Math.round((s / nSamp) * FRAMES) % FRAMES;
    sample.set(frames[fi], s * SIZE * SIZE * 4);
  }
  const palette = quantize(sample, 256, { format: 'rgb444' });

  console.log('Encoding GIF…');
  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const index = applyPalette(frames[i], palette, 'rgb444');
    gif.writeFrame(index, SIZE, SIZE, {
      palette: i === 0 ? palette : undefined,
      delay: DELAY,
      repeat: 0, // loop forever
    });
    if ((i + 1) % 24 === 0) console.log(`  encoded ${i + 1}/${FRAMES}`);
  }
  gif.finish();
  writeFileSync(OUT, Buffer.from(gif.bytes()));
  const kb = (Buffer.byteLength(gif.bytes()) / 1024).toFixed(0);
  console.log(`Done → ${OUT} (${kb} KB, ${FRAMES} frames, ${(FRAMES * DELAY / 1000).toFixed(1)}s loop)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
