/**
 * Blob storage for uploaded assets (PDFs, later images). Bytes live here on the
 * server — never in the synced tldraw document, which only holds a reference
 * (the GET URL). This is the grain tldraw/Figma/Miro all follow: keep large
 * binaries out of the realtime store. See docs/PDF-JOURNEY.md §6.
 *
 * Dev backing is the local filesystem (a temp dir); swapping to S3/R2 in prod
 * means reimplementing put/get/extractText against the same tiny interface.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// pdf-parse's index has a debug self-run guard; import the lib entry directly.
type PdfParseOptions = { pagerender?: (pageData: PdfPageData) => Promise<string> };
interface PdfTextItem {
  str: string;
}
interface PdfPageData {
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{
    items: PdfTextItem[];
  }>;
}
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  b: Buffer,
  opts?: PdfParseOptions,
) => Promise<{ text: string; numpages: number }>;

import { ocrPdfPages } from './ocr.js';

const ASSET_DIR = process.env.JARWIZ_ASSET_DIR || join(tmpdir(), 'jarwiz-assets');
/** Asset ids are client-generated; keep them to a safe, path-injection-proof set. */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MiB

export function isValidAssetId(id: string): boolean {
  return ID_RE.test(id);
}

let ready: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!ready) ready = mkdir(ASSET_DIR, { recursive: true }).then(() => undefined);
  return ready;
}

export async function putAsset(id: string, bytes: Buffer): Promise<void> {
  if (!isValidAssetId(id)) throw new Error('invalid asset id');
  // mkdir unconditionally (idempotent) rather than via the memoized ensureDir:
  // if the temp dir vanishes mid-run, a memoized "already created" would make
  // every write fail with ENOENT forever — restore's re-uploads depend on this.
  await mkdir(ASSET_DIR, { recursive: true });
  await writeFile(join(ASSET_DIR, id), bytes);
}

export async function getAsset(id: string): Promise<Buffer | null> {
  if (!isValidAssetId(id)) return null;
  await ensureDir();
  try {
    return await readFile(join(ASSET_DIR, id));
  } catch {
    return null;
  }
}

/** Extract the text + page count from a stored PDF, for the content pass / Ask. */
export async function extractAssetText(
  id: string,
  maxChars = 12_000,
): Promise<{ text: string; pages: number } | null> {
  const buf = await getAsset(id);
  if (!buf) return null;
  try {
    const parsed = await pdfParse(buf);
    const text = (parsed.text || '').replace(/\s+/g, ' ').trim();
    if (text) return { text: text.slice(0, maxChars), pages: parsed.numpages || 0 };
    // No text layer — likely scanned. Fall back to OCR.
    const ocr = await ocrPdfPages(buf);
    return { text: ocr.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars), pages: parsed.numpages || ocr.length };
  } catch {
    return null;
  }
}

/**
 * Extract text page-by-page, so Ask can cite pages. Returns one trimmed string
 * per page (index 0 = page 1). Empty array if nothing is readable.
 */
export async function extractAssetPages(id: string, maxCharsPerPage = 4_000): Promise<string[]> {
  const buf = await getAsset(id);
  if (!buf) return [];
  const pages: string[] = [];
  const pagerender = async (pageData: PdfPageData): Promise<string> => {
    const content = await pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const text = content.items
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxCharsPerPage);
    pages.push(text);
    return text;
  };
  try {
    await pdfParse(buf, { pagerender });
    if (pages.some((p) => p.trim())) return pages;
    // No text layer on any page — likely scanned. Fall back to OCR.
    return await ocrPdfPages(buf, undefined, maxCharsPerPage);
  } catch {
    return [];
  }
}
