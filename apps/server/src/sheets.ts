/**
 * Spreadsheet parsing — the sheet card's server half (mirrors assets.ts's PDF
 * text extraction). SheetJS reads .xlsx/.xls/.csv bytes from the blob store
 * into (a) a capped JSON grid the card renders as a table, and (b) CSV-ish
 * text per sheet that asks ground on, the way PDF page text does. Kept
 * server-side so SheetJS never bloats the web bundle.
 */

import { createRequire } from 'node:module';
import { getAsset } from './assets.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX = require('xlsx') as any;

/** A sheet card never renders a whole workbook — bound the preview. */
const MAX_SHEETS = 8;
const MAX_ROWS = 200;
const MAX_COLS = 40;
/** Grounding text budget per workbook. */
const MAX_TEXT_CHARS = 16_000;

export interface SheetGrid {
  name: string;
  rows: string[][];
  /** True rows/cols before the preview cap, so the card can say "+N more". */
  totalRows: number;
  totalCols: number;
}

function readWorkbook(buf: Buffer) {
  return XLSX.read(buf, { type: 'buffer', cellDates: true, cellText: false });
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** Capped JSON grid the card renders — first MAX_SHEETS sheets, each clipped. */
export async function parseSheetGrid(assetId: string): Promise<{ sheets: SheetGrid[] } | null> {
  const buf = await getAsset(assetId);
  if (!buf) return null;
  let wb;
  try {
    wb = readWorkbook(buf);
  } catch {
    return null;
  }
  const sheets: SheetGrid[] = [];
  for (const name of (wb.SheetNames as string[]).slice(0, MAX_SHEETS)) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as unknown[][];
    const totalRows = aoa.length;
    const totalCols = aoa.reduce((m, r) => Math.max(m, r.length), 0);
    const rows = aoa.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map(cellText));
    sheets.push({ name, rows, totalRows, totalCols });
  }
  return { sheets };
}

/** CSV-ish text per sheet for grounding — every asked cell, capped by chars. */
export async function extractSheetText(assetId: string, maxChars = MAX_TEXT_CHARS): Promise<string> {
  const buf = await getAsset(assetId);
  if (!buf) return '';
  let wb;
  try {
    wb = readWorkbook(buf);
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const name of (wb.SheetNames as string[]).slice(0, MAX_SHEETS)) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false, forceQuotes: false }) as string;
    if (csv.trim()) parts.push(`# Sheet: ${name}\n${csv.trim()}`);
    if (parts.join('\n\n').length > maxChars) break;
  }
  return parts.join('\n\n').slice(0, maxChars);
}

/** Bytes that look like a spreadsheet (xlsx=zip, xls=OLE, or a .csv name). */
export function looksLikeSpreadsheet(buf: Buffer, name = ''): boolean {
  if (/\.(xlsx|xls|csv|tsv)$/i.test(name)) return true;
  // xlsx is a zip (PK\x03\x04); xls is an OLE compound file (D0 CF 11 E0).
  if (buf[0] === 0x50 && buf[1] === 0x4b) return true;
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return true;
  return false;
}
