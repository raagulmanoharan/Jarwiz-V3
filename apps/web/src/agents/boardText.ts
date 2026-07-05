/**
 * Gather the board's text-bearing shapes as compact cards for the AI — rich
 * cards AND native primitives (geo/text/note/connector labels/frame names). Used
 * by the analysis agents (tensions / gaps / critique). Mirrors the autopilot
 * context extractor, but returns the wire-shape the analyze endpoint wants.
 */

import { renderPlaintextFromRichText, type Editor, type TLRichText, type TLShapeId } from 'tldraw';
import type { AnalyzeCard } from '@jarwiz/shared';

const CARD_TYPES = new Set([
  'doc-card', 'note-card', 'table-card', 'diagram-card', 'link-card', 'pdf-card', 'youtube-card', 'sheet-card',
]);
const PRIMITIVE_TYPES = new Set(['geo', 'text', 'note', 'arrow', 'frame']);
const MAX_CARDS = 30;
const MAX_TEXT = 1500;

function plain(editor: Editor, richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  try {
    return renderPlaintextFromRichText(editor, richText as TLRichText).trim();
  } catch {
    return '';
  }
}

function extract(editor: Editor, shape: ReturnType<Editor['getShape']>): AnalyzeCard | null {
  if (!shape) return null;
  const p = shape.props as Record<string, unknown>;
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : undefined;
  switch (shape.type) {
    case 'doc-card':
    case 'note-card':
      return typeof p.text === 'string' && p.text.trim() ? { kind: shape.type.replace('-card', ''), title, text: p.text } : null;
    case 'diagram-card':
      return typeof p.code === 'string' && p.code.trim() ? { kind: 'diagram', title, text: p.code } : null;
    case 'table-card': {
      const cols = Array.isArray(p.columns) ? (p.columns as string[]) : [];
      const rows = Array.isArray(p.rows) ? (p.rows as string[][]) : [];
      const text = [cols.join(' | '), ...rows.map((r) => r.join(' | '))].filter(Boolean).join('\n');
      return text.trim() ? { kind: 'table', title, text } : null;
    }
    case 'link-card': {
      const t = [
        typeof p.title === 'string' ? p.title : '',
        typeof p.description === 'string' ? p.description : '',
        typeof p.text === 'string' ? p.text : '', // extracted page text (capped by MAX_TEXT)
      ].filter(Boolean).join('\n');
      return t ? { kind: 'link', title, text: t } : null;
    }
    case 'youtube-card': {
      // Transcript when captions were readable; otherwise the honest
      // title-only line stored at paste time (never invent what's said).
      const t = typeof p.text === 'string' && p.text.trim()
        ? p.text
        : title ? `YouTube video "${title}" (captions not readable — title only).` : '';
      return t ? { kind: 'video', title, text: t } : null;
    }
    case 'geo':
    case 'text':
    case 'note': {
      const t = plain(editor, p.richText);
      return t ? { kind: shape.type === 'geo' ? 'shape' : shape.type, text: t } : null;
    }
    case 'arrow': {
      const t = plain(editor, p.richText);
      return t ? { kind: 'connector', text: t } : null;
    }
    case 'frame':
      return typeof p.name === 'string' && p.name.trim() ? { kind: 'frame', text: `Section: ${p.name.trim()}` } : null;
    case 'pdf-card': {
      // Ready PDFs join the scan by reference — the server swaps the assetId
      // for the document's extracted text (capped there, so a 100-page
      // contract can't blow up a casual scan).
      const assetId = typeof p.assetId === 'string' ? p.assetId : '';
      if (p.status !== 'ready' || !assetId) return null;
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : undefined;
      return { kind: 'pdf', title: name, text: '', assetId };
    }
    case 'sheet-card': {
      // Ready spreadsheets join the scan by reference, same as PDFs — the
      // server swaps the assetId for the sheet's extracted cells (capped).
      const assetId = typeof p.assetId === 'string' ? p.assetId : '';
      if (p.status !== 'ready' || !assetId) return null;
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : undefined;
      return { kind: 'sheet', title: name, text: '', assetId };
    }
    default:
      return null;
  }
}

/** Collect cards from the board, or just the selection when `selectionOnly`. */
export function gatherBoardCards(editor: Editor, opts?: { selectionOnly?: boolean }): AnalyzeCard[] {
  const ids: TLShapeId[] = opts?.selectionOnly
    ? editor.getSelectedShapeIds()
    : editor.getCurrentPageShapes().map((s) => s.id);
  const out: AnalyzeCard[] = [];
  for (const id of ids) {
    if (out.length >= MAX_CARDS) break;
    const shape = editor.getShape(id);
    if (!shape || !(CARD_TYPES.has(shape.type) || PRIMITIVE_TYPES.has(shape.type))) continue;
    const card = extract(editor, shape);
    if (card) out.push({ ...card, text: card.text.slice(0, MAX_TEXT) });
  }
  return out;
}
