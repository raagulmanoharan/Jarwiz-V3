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
// Real assets used by the reel (regenerate if the location/style changes):
//   scripts/hero-reel-assets/map-dark.png  — a 3×3 grid of CARTO dark @2x tiles
//     (OSM data) stitched with pngjs, centred on the Goa coast (z12).
//   scripts/hero-reel-assets/yt-attention.jpg — the real 3Blue1Brown thumbnail
//     (i.ytimg.com/vi/eMlx5fFNoYc/maxresdefault.jpg), the video the app's
//     use-case boards reference.
//   The image/link cards reuse the product's own photos in apps/web/public/uc/.
//
// Tunables (env): FRAMES (default 96), DELAY ms per frame (default 55),
//   SIZE px square (default 1080), OUT (default site/assets/hero-reel.gif),
//   PALETTE = 'perframe' (default — best colour for the real photos/map) or
//   'global' (one shared table — smaller, but bands photos).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
const OUT_WEBM = OUT.replace(/\.gif$/i, '') + '.webm';
const SIZE = parseInt(process.env.SIZE || '1080', 10);
const FRAMES = parseInt(process.env.FRAMES || '120', 10); // ~7.2s loop — fits the 4 cycling prompts
const DELAY = parseInt(process.env.DELAY || '60', 10);
const PALETTE = process.env.PALETTE || 'perframe';
// Ordered (Bayer) dithering breaks up 256-colour banding. Position-based, so it
// is stable frame-to-frame (no shimmer) — unlike error-diffusion. 'none' to skip.
const DITHER = (process.env.DITHER || 'ordered').toLowerCase();
const DITHER_AMP = parseFloat(process.env.DITHER_AMP || '10'); // ± levels of nudge

// 8×8 Bayer threshold matrix, normalised to roughly [-0.5, 0.5].
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => v / 64 - 0.5);

// Return a dithered copy of an RGBA frame (nudge each channel by a Bayer offset
// before palette mapping, so smooth ramps dissolve across adjacent entries).
// Gated: leave near-black flats (the background + card blacks) untouched — they
// don't band and dithering them only adds noise that bloats the GIF. Only the
// mid-tones (card gradients, map, photos) — where banding shows — get dithered.
function ditherFrame(src, w, h, amp) {
  const out = new Uint8Array(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const luma = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      if (luma < 13) continue; // flat black — keep it flat (compresses to ~nothing)
      const t = BAYER8[(y & 7) * 8 + (x & 7)] * amp;
      out[i] = Math.max(0, Math.min(255, src[i] + t));
      out[i + 1] = Math.max(0, Math.min(255, src[i + 1] + t));
      out[i + 2] = Math.max(0, Math.min(255, src[i + 2] + t));
    }
  }
  return out;
}
// Which artifacts to emit. The WebM is tiny + crisp (recommended for the web);
// the GIF is the requested format but heavy at 1080². 'both' by default.
const FORMAT = (process.env.FORMAT || 'both').toLowerCase();
const WANT_GIF = FORMAT === 'both' || FORMAT === 'gif';
const WANT_WEBM = FORMAT === 'both' || FORMAT === 'webm';
const FFMPEG = process.env.FFMPEG || '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

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
  await sleep(900); // let the prototype iframe, photos, map + flow.svg paint

  const clip = { x: 0, y: 0, width: SIZE, height: SIZE };
  const rgba = [];    // decoded frames for the GIF (per-frame palette needs RGBA)
  const jpegs = [];   // jpeg frames for the WebM (fed to ffmpeg's mjpeg decoder)
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((u) => window.setReel(u), i / FRAMES);
    if (WANT_GIF) {
      const png = PNG.sync.read(await page.screenshot({ clip, type: 'png' }));
      rgba.push(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength));
    }
    if (WANT_WEBM) jpegs.push(await page.screenshot({ clip, type: 'jpeg', quality: 94 }));
    if ((i + 1) % 12 === 0) console.log(`  captured ${i + 1}/${FRAMES}`);
  }
  await browser.close();

  const loopS = (FRAMES * DELAY / 1000).toFixed(1);

  if (WANT_GIF) {
    console.log(`Encoding GIF (${PALETTE} palette)…`);
    const gif = GIFEncoder();
    // A shared global palette only when asked (smaller file; bands the photos).
    let globalPalette = null;
    if (PALETTE === 'global') {
      const nSamp = Math.min(10, FRAMES);
      const sample = new Uint8Array(nSamp * SIZE * SIZE * 4);
      for (let s = 0; s < nSamp; s++) sample.set(rgba[Math.round((s / nSamp) * FRAMES) % FRAMES], s * SIZE * SIZE * 4);
      globalPalette = quantize(sample, 256, { format: 'rgb565' });
    }
    for (let i = 0; i < FRAMES; i++) {
      // Palette from the clean frame; map the dithered frame to it so smooth
      // dark ramps de-band instead of stepping. Per-frame palette keeps the real
      // map + photos crisp; global reuses one.
      const palette = globalPalette || quantize(rgba[i], 256, { format: 'rgb565' });
      const src = DITHER === 'ordered' ? ditherFrame(rgba[i], SIZE, SIZE, DITHER_AMP) : rgba[i];
      const index = applyPalette(src, palette, 'rgb565');
      gif.writeFrame(index, SIZE, SIZE, { palette: globalPalette ? (i === 0 ? globalPalette : undefined) : palette, delay: DELAY, repeat: 0 });
      if ((i + 1) % 24 === 0) console.log(`  encoded ${i + 1}/${FRAMES}`);
    }
    gif.finish();
    writeFileSync(OUT, Buffer.from(gif.bytes()));
    console.log(`Done → ${OUT} (${(gif.bytes().length / 1024).toFixed(0)} KB, ${FRAMES} frames, ${loopS}s loop)`);
  }

  if (WANT_WEBM) {
    console.log('Encoding WebM (VP8)…');
    const fps = (1000 / DELAY).toFixed(3);
    const r = spawnSync(FFMPEG, [
      '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', fps, '-i', 'pipe:0',
      '-c:v', 'libvpx', '-b:v', '0', '-crf', '10', '-pix_fmt', 'yuv420p', '-auto-alt-ref', '0', '-an', OUT_WEBM,
    ], { input: Buffer.concat(jpegs), maxBuffer: 1 << 30 });
    if (r.status !== 0) { console.error((r.stderr || '').toString().split('\n').slice(-5).join('\n')); throw new Error('ffmpeg failed'); }
    const { statSync } = await import('node:fs');
    console.log(`Done → ${OUT_WEBM} (${(statSync(OUT_WEBM).size / 1024).toFixed(0)} KB, ${FRAMES} frames, ${loopS}s loop)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
