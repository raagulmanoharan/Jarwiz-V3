/**
 * The Jarwiz card shapes — custom tldraw ShapeUtils, registered via the
 * Tldraw `shapeUtils` prop. All cards are first-class tldraw shapes:
 * selectable, movable, arrow-bindable, undo-able.
 *
 * Shape type ↔ CardKind mapping (packages/shared protocol):
 *   link-card → 'link', youtube-card → 'youtube', image-card → 'image',
 *   pdf-card → 'pdf', note-card → 'note', doc-card → 'doc'.
 */

import { DocCardShapeUtil } from './DocCardShapeUtil';
import { ImageCardShapeUtil } from './ImageCardShapeUtil';
import { LinkCardShapeUtil } from './LinkCardShapeUtil';
import { NoteCardShapeUtil } from './NoteCardShapeUtil';
import { PdfCardShapeUtil } from './PdfCardShapeUtil';
import { YouTubeCardShapeUtil } from './YouTubeCardShapeUtil';

export { DocCardShapeUtil, DOC_CARD_SIZE, type DocCardShape } from './DocCardShapeUtil';
export { ImageCardShapeUtil, type ImageCardShape } from './ImageCardShapeUtil';
export { LinkCardShapeUtil, LINK_CARD_SIZE, type LinkCardShape } from './LinkCardShapeUtil';
export { NoteCardShapeUtil, NOTE_CARD_SIZE, type NoteCardShape } from './NoteCardShapeUtil';
export { PdfCardShapeUtil, PDF_CARD_SIZE, type PdfCardShape } from './PdfCardShapeUtil';
export { YouTubeCardShapeUtil, YOUTUBE_CARD_SIZE, type YouTubeCardShape } from './YouTubeCardShapeUtil';

export const cardShapeUtils = [
  LinkCardShapeUtil,
  YouTubeCardShapeUtil,
  ImageCardShapeUtil,
  PdfCardShapeUtil,
  NoteCardShapeUtil,
  DocCardShapeUtil,
] as const;
