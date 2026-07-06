/**
 * OCR fallback for scanned / image-only PDFs (no text layer). Renders each page
 * to a PNG with pdf.js + a native canvas, then reads it with tesseract.js. Slow
 * (seconds per page), so it's capped and only runs when text extraction finds
 * nothing. The tesseract language model is fetched from TESSERACT_LANG_PATH
 * (a tessdata host); the worker is kept warm across calls.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const LANG_PATH =
  process.env.TESSERACT_LANG_PATH || 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0';
const DEFAULT_MAX_PAGES = 6;
const RENDER_SCALE = 2;

interface PdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
interface TessWorker {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<void>;
}

let pdfjsPromise: Promise<{ getDocument: (opts: unknown) => { promise: Promise<PdfDoc> } }> | null = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const napi = (await import('@napi-rs/canvas')) as unknown as Record<string, unknown>;
      for (const k of ['DOMMatrix', 'Path2D', 'ImageData', 'DOMPoint']) {
        const g = globalThis as Record<string, unknown>;
        if (napi[k] && !g[k]) g[k] = napi[k];
      }
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (opts: unknown) => { promise: Promise<PdfDoc> };
      };
      pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

let workerPromise: Promise<TessWorker> | null = null;
async function getWorker(): Promise<TessWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = (await import('tesseract.js')) as unknown as {
        createWorker: (lang: string, oem: number, opts: { langPath: string; gzip: boolean }) => Promise<TessWorker>;
      };
      return createWorker('eng', 1, { langPath: LANG_PATH, gzip: true });
    })();
  }
  return workerPromise;
}

/** OCR the first pages of a PDF buffer. Returns per-page text (best effort). */
export async function ocrPdfPages(
  buf: Buffer,
  maxPages = DEFAULT_MAX_PAGES,
  maxCharsPerPage = 4_000,
): Promise<string[]> {
  try {
    const pdfjs = await getPdfjs();
    const { createCanvas } = (await import('@napi-rs/canvas')) as unknown as {
      createCanvas: (w: number, h: number) => { getContext: (t: '2d') => unknown; toBuffer: (t: 'image/png') => Buffer };
    };
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false })
      .promise;
    const worker = await getWorker();
    const pages: string[] = [];
    const count = Math.min(doc.numPages, maxPages);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const png = canvas.toBuffer('image/png');
      const {
        data: { text },
      } = await worker.recognize(png);
      pages.push(text.replace(/\s+/g, ' ').trim().slice(0, maxCharsPerPage));
    }
    return pages;
  } catch {
    return [];
  }
}
