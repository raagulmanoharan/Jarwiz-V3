/**
 * Drop / paste ingestion — turns external content into Jarwiz cards.
 *
 *   URL   → youtube-card (watch / shorts / youtu.be) or link-card
 *           (loading skeleton → POST /api/link/preview fills the props)
 *   files → image-card (data URL) / pdf-card
 *   text  → note-card (or URL handling when the text is a lone link)
 *
 * Dropped content lands at the drop point; pasted content lands at the
 * viewport center (tldraw only provides a point for drops).
 */

import {
  createShapeId,
  FileHelpers,
  MediaHelpers,
  type Editor,
  type TLShapeId,
  type VecLike,
} from 'tldraw';
import type { SuggestRequest } from '@jarwiz/shared';
import { domainOf, isHttpUrl } from '../lib/url';
import { hasOfferFor, setOffer } from '../agents/offers';
import { fetchTailoredSuggestions, suggestionsForDrop } from '../agents/suggestions';

type DropKind = 'youtube' | 'link' | 'pdf';

/** Show fast type-based pills now, then upgrade them to content-aware ones. */
function raiseOffer(id: TLShapeId, kind: DropKind, req: SuggestRequest): void {
  setOffer(id, suggestionsForDrop(kind), true);
  void fetchTailoredSuggestions(req).then((tailored) => {
    if (!hasOfferFor(id)) return; // dismissed, superseded, or accepted meanwhile
    setOffer(id, tailored.length > 0 ? tailored : suggestionsForDrop(kind), false);
  });
}
import {
  LINK_CARD_SIZE,
  NOTE_CARD_SIZE,
  PDF_CARD_SIZE,
  YOUTUBE_CARD_SIZE,
  type ImageCardShape,
  type LinkCardShape,
  type NoteCardShape,
  type PdfCardShape,
  type YouTubeCardShape,
} from '../shapes';
import { fetchLinkPreview } from './linkPreview';
import { parseYouTubeVideoId } from './youtube';

const MAX_IMAGE_EDGE = 420;
const IMAGE_CARD_PADDING = 10; // matches .jz-image-card padding
const IMAGE_CAPTION_HEIGHT = 18;
const MULTI_FILE_CASCADE = 28;

export function registerIngestion(editor: Editor): void {
  editor.registerExternalContentHandler('url', ({ url, point }) => {
    placeUrl(editor, url, resolvePoint(editor, point));
  });

  editor.registerExternalContentHandler('files', ({ files, point }) => {
    void placeFiles(editor, files, resolvePoint(editor, point));
  });

  editor.registerExternalContentHandler('text', ({ text, point }) => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    const target = resolvePoint(editor, point);
    if (isHttpUrl(trimmed)) {
      placeUrl(editor, trimmed, target);
    } else {
      placeNote(editor, trimmed, target);
    }
  });
}

/** Drops carry a page point; pastes do not — fall back to the viewport center. */
function resolvePoint(editor: Editor, point: VecLike | undefined): VecLike {
  if (point) return { x: point.x, y: point.y };
  const center = editor.getViewportPageBounds().center;
  return { x: center.x, y: center.y };
}

/* ─── URLs ──────────────────────────────────────────────────────────────── */

function placeUrl(editor: Editor, url: string, center: VecLike): void {
  const videoId = parseYouTubeVideoId(url);
  if (videoId) {
    placeYouTube(editor, url, videoId, center);
  } else {
    placeLink(editor, url, center);
  }
}

function placeYouTube(editor: Editor, url: string, videoId: string, center: VecLike): void {
  const { w, h } = YOUTUBE_CARD_SIZE;
  const id = createShapeId();
  editor.createShape<YouTubeCardShape>({
    id,
    type: 'youtube-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, videoId, url, title: 'YouTube' },
  });
  raiseOffer(id, 'youtube', { kind: 'youtube', url });
}

function placeLink(editor: Editor, url: string, center: VecLike): void {
  const id = createShapeId();
  const { w, h } = LINK_CARD_SIZE;

  // Skeleton first — the card is on the board immediately.
  editor.createShape<LinkCardShape>({
    id,
    type: 'link-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { ...LINK_CARD_SIZE, url, loading: true },
  });

  raiseOffer(id, 'link', { kind: 'link', url });

  void fetchLinkPreview(url)
    .then((preview) => {
      updateLinkCard(editor, id, {
        loading: false,
        url: preview.url || url,
        title: preview.title,
        description: preview.description,
        image: preview.image ?? '',
        favicon: preview.favicon ?? '',
        themeColor: preview.themeColor ?? '',
        siteName: preview.siteName ?? '',
      });
    })
    .catch(() => {
      // Graceful degradation: the card stays useful without a preview.
      updateLinkCard(editor, id, {
        loading: false,
        title: domainOf(url),
        description: 'No preview available — open the link to view it.',
      });
    });
}

function updateLinkCard(
  editor: Editor,
  id: TLShapeId,
  props: Partial<LinkCardShape['props']>,
): void {
  if (!editor.getShape(id)) return; // deleted (or undone) while the preview loaded
  editor.updateShape<LinkCardShape>({ id, type: 'link-card', props });
}

/* ─── Files ─────────────────────────────────────────────────────────────── */

async function placeFiles(editor: Editor, files: File[], center: VecLike): Promise<void> {
  let placed = 0;
  for (const file of files) {
    const offset = placed * MULTI_FILE_CASCADE;
    const target = { x: center.x + offset, y: center.y + offset };
    try {
      if (file.type.startsWith('image/')) {
        await placeImage(editor, file, target);
        placed += 1;
      } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        await placePdf(editor, file, target);
        placed += 1;
      }
      // Other file kinds are ignored in M0.
    } catch (error) {
      console.error('[jarwiz] could not ingest file', file.name, error);
    }
  }
}

async function placeImage(editor: Editor, file: File, center: VecLike): Promise<void> {
  const [src, size] = await Promise.all([
    FileHelpers.blobToDataUrl(file),
    MediaHelpers.getImageSize(file),
  ]);

  const scale = Math.min(1, MAX_IMAGE_EDGE / size.w, MAX_IMAGE_EDGE / size.h);
  const w = Math.max(120, Math.round(size.w * scale) + IMAGE_CARD_PADDING * 2);
  const h =
    Math.max(100, Math.round(size.h * scale) + IMAGE_CARD_PADDING * 2) +
    IMAGE_CAPTION_HEIGHT;

  editor.createShape<ImageCardShape>({
    id: createShapeId(),
    type: 'image-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, src, name: file.name },
  });
}

async function placePdf(editor: Editor, file: File, center: VecLike): Promise<void> {
  const src = await FileHelpers.blobToDataUrl(file);
  const { w, h } = PDF_CARD_SIZE;
  const id = createShapeId();

  editor.createShape<PdfCardShape>({
    id,
    type: 'pdf-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, src, name: file.name },
  });
  raiseOffer(id, 'pdf', { kind: 'pdf', title: file.name, pdfDataUrl: src });
}

/* ─── Text ──────────────────────────────────────────────────────────────── */

function placeNote(editor: Editor, text: string, center: VecLike): void {
  const { w, h } = NOTE_CARD_SIZE;
  editor.createShape<NoteCardShape>({
    id: createShapeId(),
    type: 'note-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, text },
  });
}
