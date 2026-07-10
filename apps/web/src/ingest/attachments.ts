/**
 * Composer attachments — content you attach to a prompt as CONTEXT before it's
 * on the board. Distinct from grounding on a selected card: an attachment is
 * the user's own "use this as context" that persists in the composer
 * regardless of canvas selection, on the intent screen and in normal use.
 *
 * Lifecycle: attach a file → it uploads in the background (the pill shows
 * "attaching…") → on send, each ready attachment is *materialized* into its
 * source card on the board and the ask grounds on it. Nothing lands on the
 * canvas until you actually send — so an attachment you remove never litters
 * the board.
 */

import { createShapeId, type Editor, type TLShapeId, type VecLike } from 'tldraw';
import { uploadAsset } from '../lib/uploadAsset';
import { logEvent } from '../log/eventLog';
import {
  PDF_CARD_SIZE,
  SHEET_CARD_SIZE,
  type ImageCardShape,
  type PdfCardShape,
  type SheetCardShape,
} from '../shapes';

export type AttachmentKind = 'pdf' | 'image' | 'sheet';

export interface Attachment {
  key: string;
  kind: AttachmentKind;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  assetId?: string;
  src?: string;
  w?: number;
  h?: number;
}

/** Which attachment kind (if any) a dropped/pasted file is. */
export function classifyFile(file: File): AttachmentKind | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return 'image';
  if (/\.(xlsx|xls|csv|tsv)$/i.test(file.name) || /spreadsheet|excel|ms-excel|csv/i.test(file.type)) return 'sheet';
  return null;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 480, h: img.naturalHeight || 320 });
    img.onerror = () => resolve({ w: 480, h: 320 });
    img.src = src;
  });
}

/** Upload/read an attachment's bytes. Images are local (data URL, no server);
 *  PDFs and sheets go to the blob store so their card holds only a URL. */
export async function uploadAttachment(file: File, kind: AttachmentKind): Promise<Partial<Attachment>> {
  if (kind === 'image') {
    const src = await readDataUrl(file);
    if (!src) throw new Error('read failed');
    const dims = await imageDims(src);
    return { status: 'ready', src, w: dims.w, h: dims.h };
  }
  const { assetId, url } = await uploadAsset(file, kind);
  return { status: 'ready', assetId, src: url };
}

/** Turn a ready attachment into its source card on the board and return the id
 *  (null if not ready). Used on send so the ask can ground on it. */
export function materializeAttachment(editor: Editor, att: Attachment, at: VecLike): TLShapeId | null {
  if (att.status !== 'ready') return null;
  const id = createShapeId();
  if (att.kind === 'pdf') {
    const { w, h } = PDF_CARD_SIZE;
    editor.createShape<PdfCardShape>({
      id, type: 'pdf-card', x: at.x - w / 2, y: at.y - h / 2,
      props: { w, h, src: att.src ?? '', assetId: att.assetId ?? '', name: att.name, pages: 0, status: 'ready' },
    });
    logEvent(editor, { kind: 'pdf', label: `Added ${att.name}`, shapeIds: [id] });
  } else if (att.kind === 'sheet') {
    const { w, h } = SHEET_CARD_SIZE;
    editor.createShape<SheetCardShape>({
      id, type: 'sheet-card', x: at.x - w / 2, y: at.y - h / 2,
      props: { w, h, src: att.src ?? '', assetId: att.assetId ?? '', name: att.name, status: 'ready' },
    });
    logEvent(editor, { kind: 'artefact', label: `Added ${att.name}`, detail: 'Spreadsheet', shapeIds: [id] });
  } else {
    const scale = Math.min(1, 480 / (att.w ?? 480), 480 / (att.h ?? 320));
    const w = Math.max(120, Math.round((att.w ?? 480) * scale));
    const h = Math.max(90, Math.round((att.h ?? 320) * scale));
    editor.createShape<ImageCardShape>({
      id, type: 'image-card', x: at.x - w / 2, y: at.y - h / 2,
      props: { w, h, src: att.src ?? '', name: att.name },
    });
    logEvent(editor, { kind: 'artefact', label: `Added ${att.name}`, detail: 'Image', shapeIds: [id] });
  }
  return id;
}
