import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useIsEditing,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface PdfCardProps {
  w: number;
  h: number;
  /** Data URL of the dropped PDF (local-first, persists with the board). */
  src: string;
  name: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'pdf-card': PdfCardProps;
  }
}

export type PdfCardShape = TLShape<'pdf-card'>;

export const PDF_CARD_SIZE = { w: 380, h: 480 };

export class PdfCardShapeUtil extends ShapeUtil<PdfCardShape> {
  static override type = 'pdf-card' as const;

  static override props: RecordProps<PdfCardShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    name: T.string,
  };

  override getDefaultProps(): PdfCardShape['props'] {
    return { ...PDF_CARD_SIZE, src: '', name: '' };
  }

  override canResize() {
    return true;
  }

  /** Double-click enters editing — the only state where the preview scrolls. */
  override canEdit() {
    return true;
  }

  override onResize(shape: PdfCardShape, info: TLResizeInfo<PdfCardShape>) {
    return resizeBox(shape, info, { minWidth: 220, minHeight: 220 });
  }

  override getGeometry(shape: PdfCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: PdfCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: PdfCardShape) {
    return (
      <HTMLContainer>
        <PdfCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function PdfCardBody({ shape }: { shape: PdfCardShape }) {
  const isEditing = useIsEditing(shape.id);
  const { src, name } = shape.props;

  return (
    <div className="jz-card">
      <div className="jz-pdf-frame">
        {src ? (
          <object
            data={src}
            type="application/pdf"
            aria-label={name || 'PDF document'}
            style={{ pointerEvents: isEditing ? 'all' : 'none' }}
          >
            <PdfFallback name={name} src={src} />
          </object>
        ) : (
          <PdfFallback name={name} src="" />
        )}
      </div>
      <div className="jz-pdf-footer">
        <PdfGlyph />
        <span className="jz-pdf-name">{name || 'Document.pdf'}</span>
        <span className="jz-yt-hint" style={{ marginLeft: 'auto' }}>
          {isEditing ? 'scrolling' : 'double-click to scroll'}
        </span>
      </div>
    </div>
  );
}

function PdfFallback({ name, src }: { name: string; src: string }) {
  return (
    <div className="jz-pdf-fallback">
      <PdfGlyph size={26} />
      <span>{name || 'PDF document'}</span>
      {src ? (
        <a
          href={src}
          download={name || 'document.pdf'}
          style={{ pointerEvents: 'all', color: 'inherit' }}
          onPointerDown={stopEventPropagation}
        >
          No inline preview — download instead
        </a>
      ) : (
        <span>No preview available</span>
      )}
    </div>
  );
}

function PdfGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden style={{ flex: 'none' }}>
      <path
        d="M3.5 1.5h4.8L11.5 4.7v7.8a.8.8 0 0 1-.8.8H3.5a.8.8 0 0 1-.8-.8V2.3a.8.8 0 0 1 .8-.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M8.2 1.7v3.1h3.1" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
