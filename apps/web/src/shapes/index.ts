/**
 * The Jarwiz card shapes — custom tldraw ShapeUtils, registered via the
 * Tldraw `shapeUtils` prop. All cards are first-class tldraw shapes:
 * selectable, movable, arrow-bindable, undo-able.
 *
 * Shape type ↔ CardKind mapping (packages/shared protocol):
 *   link-card → 'link', youtube-card → 'youtube', image-card → 'image',
 *   pdf-card → 'pdf', note-card → 'note', doc-card → 'doc'.
 */

import { DiagramCardShapeUtil } from './DiagramCardShapeUtil';
import { DocCardShapeUtil } from './DocCardShapeUtil';
import { ImageCardShapeUtil } from './ImageCardShapeUtil';
import { LinkCardShapeUtil } from './LinkCardShapeUtil';
import { NoteCardShapeUtil } from './NoteCardShapeUtil';
import { PdfCardShapeUtil } from './PdfCardShapeUtil';
import { SheetCardShapeUtil } from './SheetCardShapeUtil';
import { TableCardShapeUtil } from './TableCardShapeUtil';
import { YouTubeCardShapeUtil } from './YouTubeCardShapeUtil';
import { MachineCardShapeUtil } from './MachineCardShapeUtil';

export { DiagramCardShapeUtil, DIAGRAM_CARD_SIZE, type DiagramCardShape } from './DiagramCardShapeUtil';
export { DocCardShapeUtil, DOC_CARD_SIZE, type DocCardShape } from './DocCardShapeUtil';
export { ImageCardShapeUtil, type ImageCardShape } from './ImageCardShapeUtil';
export { LinkCardShapeUtil, LINK_CARD_SIZE, type LinkCardShape } from './LinkCardShapeUtil';
export {
  NoteCardShapeUtil,
  NOTE_CARD_SIZE,
  NOTE_PAPER,
  AFFINITY_COLORS,
  affinityColor,
  type NoteCardShape,
} from './NoteCardShapeUtil';
export { PdfCardShapeUtil, PDF_CARD_SIZE, type PdfCardShape } from './PdfCardShapeUtil';
export { SheetCardShapeUtil, SHEET_CARD_SIZE, type SheetCardShape } from './SheetCardShapeUtil';
export {
  TableCardShapeUtil,
  TABLE_CARD_SIZE,
  TABLE_HEADER_H,
  starterTableProps,
  type TableCardShape,
} from './TableCardShapeUtil';
export { YouTubeCardShapeUtil, YOUTUBE_CARD_SIZE, type YouTubeCardShape } from './YouTubeCardShapeUtil';
export { MachineCardShapeUtil, MACHINE_CARD_SIZE, type MachineCardShape } from './MachineCardShapeUtil';

export const cardShapeUtils = [
  LinkCardShapeUtil,
  YouTubeCardShapeUtil,
  ImageCardShapeUtil,
  PdfCardShapeUtil,
  SheetCardShapeUtil,
  NoteCardShapeUtil,
  DocCardShapeUtil,
  TableCardShapeUtil,
  DiagramCardShapeUtil,
  MachineCardShapeUtil,
] as const;
