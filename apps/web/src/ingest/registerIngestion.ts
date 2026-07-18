/**
 * Drop / paste ingestion. A dropped PDF uploads to the server blob store and
 * lands as a pdf-card holding just the asset URL; a dropped/pasted IMAGE lands
 * as an image-card holding a data URL (local-first — it persists with the
 * board and needs no server); a pasted/dropped URL lands as a link-card that
 * enriches itself with the server's SSRF-guarded preview (title, description,
 * og:image, favicon). Drops land at the drop point; pastes at the viewport
 * center.
 */

import { createShapeId, type Editor, type TLShapeId, type VecLike } from 'tldraw';
import { startTldr } from './tldr';
import { domainOf } from '../lib/url';
import { uploadAsset } from '../lib/uploadAsset';
import { logEvent } from '../log/eventLog';
import {
  LINK_CARD_SIZE,
  PDF_CARD_SIZE,
  SHEET_CARD_SIZE,
  YOUTUBE_CARD_SIZE,
  type ImageCardShape,
  type LinkCardShape,
  type PdfCardShape,
  type SheetCardShape,
  type YouTubeCardShape,
} from '../shapes';

const MULTI_FILE_CASCADE = 28;

export function registerIngestion(editor: Editor): void {
  editor.registerExternalContentHandler('files', ({ files, point }) => {
    void placeFiles(editor, files, resolvePoint(editor, point));
  });
  // tldraw routes pasted text that parses as a URL (and links dragged from
  // another tab) through the 'url' handler.
  editor.registerExternalContentHandler('url', ({ url, point }) => {
    placeLink(editor, url, resolvePoint(editor, point));
  });
}

/** What the server's link-preview endpoint returns (apps/server linkPreview.ts). */
interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  themeColor?: string;
  siteName?: string;
  text?: string;
}

/** Extract a YouTube video id from any of the URL shapes people paste. */
function youTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
      if (m) return m[2] ?? null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** A pasted YouTube URL lands as a playable video card, then reads what it
 *  honestly can: caption transcript when one exists (asks ground on it), a
 *  metadata-only state otherwise — the header badge tells the user which. */
function placeYouTube(editor: Editor, url: string, videoId: string, center: VecLike): void {
  const { w, h } = YOUTUBE_CARD_SIZE;
  const id = createShapeId();
  editor.createShape<YouTubeCardShape>({
    id,
    type: 'youtube-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, videoId, url, title: '' },
  });
  editor.select(id);
  logEvent(editor, { kind: 'artefact', label: 'Added a YouTube video', detail: 'Video', shapeIds: [id] });

  void fetch('/api/youtube/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
    .then((r) =>
      r.ok
        ? (r.json() as Promise<{
            title?: string;
            text?: string;
            hasTranscript?: boolean;
            frames?: Array<{ assetId?: string }>;
          }>)
        : null,
    )
    .then((t) => {
      if (!editor.getShape(id)) return; // deleted or undone while fetching
      editor.updateShape<YouTubeCardShape>({
        id,
        type: 'youtube-card',
        props: {
          title: t?.title ?? '',
          text: t?.text ?? '',
          hasTranscript: t?.hasTranscript ?? false,
          frames: (t?.frames ?? []).map((f) => String(f?.assetId ?? '')).filter(Boolean),
        },
      });
      // A TL;DR needs something to read — only a video with a real transcript
      // gets one; a metadata-only video wears its "processing/no captions"
      // badge instead of a summary of nothing.
      if (t?.text?.trim()) {
        startTldr(editor, id, 'youtube-card', { kind: 'youtube', title: t.title, text: t.text });
      }
    })
    .catch(() => {
      if (!editor.getShape(id)) return;
      editor.updateShape<YouTubeCardShape>({ id, type: 'youtube-card', props: { hasTranscript: false } });
    });
}

/** A pasted URL lands as a link-card immediately (skeleton state) and fills
 *  itself in when the preview arrives — the bare URL is already a working
 *  card, so a failed enrichment just leaves the domain fallback. */
function placeLink(editor: Editor, url: string, center: VecLike): void {
  const videoId = youTubeVideoId(url);
  if (videoId) {
    placeYouTube(editor, url, videoId, center);
    return;
  }
  // A direct media URL is also a video card — native <video> player, poster
  // from the first watched frame, same ingest (captions rarely; frames yes).
  if (/\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i.test(url)) {
    placeYouTube(editor, url, '', center);
    return;
  }
  const { w, h } = LINK_CARD_SIZE;
  const id = createShapeId();
  editor.createShape<LinkCardShape>({
    id,
    type: 'link-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, url, title: '', description: '', image: '', favicon: '', themeColor: '', siteName: '', loading: true },
  });
  editor.select(id);
  logEvent(editor, { kind: 'artefact', label: `Added ${domainOf(url)}`, detail: 'Link', shapeIds: [id] });

  void fetch('/api/link/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<LinkPreview>) : null))
    .then((p) => {
      if (!editor.getShape(id)) return; // deleted or undone while fetching
      editor.updateShape<LinkCardShape>({
        id,
        type: 'link-card',
        props: {
          loading: false,
          title: p?.title ?? '',
          description: p?.description ?? '',
          image: p?.image ?? '',
          favicon: p?.favicon ?? '',
          themeColor: p?.themeColor ?? '',
          siteName: p?.siteName ?? '',
          text: p?.text ?? '',
        },
      });
      // Summarize the page onto the card the moment we have its text — a bare
      // preview with no readable body just stays a preview (no strip).
      if (p?.text?.trim()) {
        startTldr(editor, id, 'link-card', { kind: 'link', title: p.title, text: p.text });
      }
    })
    .catch(() => {
      if (!editor.getShape(id)) return;
      editor.updateShape<LinkCardShape>({ id, type: 'link-card', props: { loading: false } });
    });
}

/** Drops carry a page point; pastes do not — fall back to the viewport center. */
function resolvePoint(editor: Editor, point: VecLike | undefined): VecLike {
  if (point) return { x: point.x, y: point.y };
  const center = editor.getViewportPageBounds().center;
  return { x: center.x, y: center.y };
}

async function placeFiles(editor: Editor, files: File[], center: VecLike): Promise<TLShapeId[]> {
  const ids: TLShapeId[] = [];
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImage = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
    const isSheet =
      /\.(xlsx|xls|csv|tsv)$/i.test(file.name) ||
      /spreadsheet|excel|ms-excel|csv/i.test(file.type);
    if (!isPdf && !isImage && !isSheet) continue;
    const offset = ids.length * MULTI_FILE_CASCADE;
    const at = { x: center.x + offset, y: center.y + offset };
    if (isPdf) ids.push(placePdf(editor, file, at));
    else if (isSheet) ids.push(placeSheet(editor, file, at));
    else { const id = await placeImage(editor, file, at); if (id) ids.push(id); }
  }
  return ids;
}

/** Are any of these files a kind the composer can attach? Gates the paste
 *  affordance so a stray paste of unsupported content isn't captured. */
export function hasIngestibleFile(items: FileList | File[] | null | undefined): boolean {
  if (!items) return false;
  return Array.from(items).some(
    (f) =>
      f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ||
      /^image\/(png|jpeg|gif|webp)$/.test(f.type) ||
      /\.(xlsx|xls|csv|tsv)$/i.test(f.name) || /spreadsheet|excel|ms-excel|csv/i.test(f.type),
  );
}

/** An image lands as an image-card: data URL in props, sized to the image's
 *  own aspect (clamped) — the canvas finally accepts a screenshot. */
async function placeImage(editor: Editor, file: File, center: VecLike): Promise<TLShapeId | null> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  }).catch(() => '');
  if (!src) return null;
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 480, h: img.naturalHeight || 320 });
    img.onerror = () => resolve({ w: 480, h: 320 });
    img.src = src;
  });
  const scale = Math.min(1, 480 / dims.w, 480 / dims.h);
  const w = Math.max(120, Math.round(dims.w * scale));
  const h = Math.max(90, Math.round(dims.h * scale));
  const id = createShapeId();
  editor.createShape<ImageCardShape>({
    id,
    type: 'image-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, src, name: file.name },
  });
  editor.select(id);
  logEvent(editor, { kind: 'artefact', label: `Added ${file.name}`, detail: 'Image', shapeIds: [id] });
  return id;
}

function placePdf(editor: Editor, file: File, center: VecLike): TLShapeId {
  const { w, h } = PDF_CARD_SIZE;
  const id = createShapeId();

  // Card appears immediately in an uploading state; the URL fills in when the
  // blob upload completes (or flips to an error state if it fails).
  editor.createShape<PdfCardShape>({
    id,
    type: 'pdf-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, src: '', assetId: '', name: file.name, pages: 0, status: 'uploading' },
  });

  void uploadAsset(file, 'pdf')
    .then(({ assetId, url }) => {
      updatePdf(editor, id, { src: url, assetId, status: 'ready' });
      // Select the card so its Ask affordance + content pills surface at once.
      // Select the card: its action bar (with the fixed "✦ Profile" — the
      // drop-moment offer) and content pills surface at once.
      if (editor.getShape(id)) {
        editor.select(id);
        logEvent(editor, { kind: 'pdf', label: `Added ${file.name}`, shapeIds: [id] });
        // The server extracts the PDF's text from the asset for the gist.
        startTldr(editor, id, 'pdf-card', { kind: 'pdf', title: file.name, assetId });
      }
    })
    .catch(() => updatePdf(editor, id, { status: 'error' }));
  return id;
}

function updatePdf(editor: Editor, id: TLShapeId, props: Partial<PdfCardShape['props']>): void {
  if (!editor.getShape(id)) return; // deleted or undone while uploading
  editor.updateShape<PdfCardShape>({ id, type: 'pdf-card', props });
}

/** A dropped .xlsx/.xls/.csv lands as a sheet card (PDF's spreadsheet twin):
 *  uploads to the blob store, then the card fetches its parsed grid. */
function placeSheet(editor: Editor, file: File, center: VecLike): TLShapeId {
  const { w, h } = SHEET_CARD_SIZE;
  const id = createShapeId();
  editor.createShape<SheetCardShape>({
    id,
    type: 'sheet-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, src: '', assetId: '', name: file.name, status: 'uploading' },
  });
  void uploadAsset(file, 'sheet')
    .then(({ assetId, url }) => {
      if (!editor.getShape(id)) return;
      editor.updateShape<SheetCardShape>({ id, type: 'sheet-card', props: { src: url, assetId, status: 'ready' } });
      editor.select(id);
      logEvent(editor, { kind: 'artefact', label: `Added ${file.name}`, detail: 'Spreadsheet', shapeIds: [id] });
      // The server flattens the grid to text for the gist.
      startTldr(editor, id, 'sheet-card', { kind: 'sheet', title: file.name, assetId });
    })
    .catch(() => {
      if (editor.getShape(id)) editor.updateShape<SheetCardShape>({ id, type: 'sheet-card', props: { status: 'error' } });
    });
  return id;
}
