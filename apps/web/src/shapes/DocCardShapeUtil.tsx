import { useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useIsEditing,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
} from 'tldraw';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { useAutopilot } from '../agents/useAutopilot';
import { useMention } from '../agents/useMention';
import { DocMarkdown } from '../ui/DocMarkdown';
import { getResponsePdfSource } from '../pdf/provenance';
import { setPdfPage } from '../pdf/pdfView';
import { DOC_RADIUS, roundedRectPath } from './cardGeometry';

export interface DocCardProps {
  w: number;
  h: number;
  text: string;
  title?: string;
  /** Source PDF shape id, so [p.N] citations survive reload (not a session map). */
  sourcePdfId: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'doc-card': DocCardProps;
  }
}

export type DocCardShape = TLShape<'doc-card'>;

export const DOC_CARD_SIZE = { w: 520, h: 360 };

export class DocCardShapeUtil extends ShapeUtil<DocCardShape> {
  static override type = 'doc-card' as const;

  static override props: RecordProps<DocCardShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
    title: T.string,
    sourcePdfId: T.string,
  };

  override getDefaultProps(): DocCardShape['props'] {
    return { ...DOC_CARD_SIZE, text: '', title: '', sourcePdfId: '' };
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override onResize(shape: DocCardShape, info: TLResizeInfo<DocCardShape>) {
    return resizeBox(shape, info, { minWidth: 280, minHeight: 200 });
  }

  override getGeometry(shape: DocCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: DocCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, DOC_RADIUS);
  }

  override component(shape: DocCardShape) {
    return (
      <HTMLContainer>
        <DocCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function DocCardBody({ shape }: { shape: DocCardShape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { text, title } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);
  const autopilot = useAutopilot();
  const mention = useMention();

  if (isEditing) {
    return (
      <div className="jz-doc">
        <div className="jz-doc-header">
          <input
            autoFocus
            type="text"
            value={title}
            placeholder="Document title"
            className="jz-doc-title-input"
            onChange={(e) =>
              editor.updateShape<DocCardShape>({
                id: shape.id,
                type: 'doc-card',
                props: { title: e.currentTarget.value },
              })
            }
            onPointerDown={stopEventPropagation}
            onPointerMove={stopEventPropagation}
            onPointerUp={stopEventPropagation}
          />
        </div>
        <textarea
          value={text}
          placeholder="Write something… (Tab to continue, @ to call an agent)"
          className="jz-doc-textarea"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => {
            if (mention.onKeyDown(shape.id, e)) return;
            autopilot.onKeyDown(shape.id, e);
          }}
          onChange={(e) => {
            const value = e.currentTarget.value;
            const caret = e.currentTarget.selectionStart ?? value.length;
            editor.updateShape<DocCardShape>({
              id: shape.id,
              type: 'doc-card',
              props: { text: value },
            });
            mention.sync(shape.id, value, caret);
          }}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
        />
      </div>
    );
  }

  return (
    <div className="jz-doc">
      <div className="jz-doc-header">
        <div className="jz-doc-title">{title || 'Document'}</div>
      </div>
      <div className={`jz-doc-content${text ? '' : ' jz-doc-placeholder'}`}>
        {text ? (
          <DocMarkdown
            content={text}
            onCite={(page) => {
              const pdfId = (shape.props.sourcePdfId as TLShapeId) || getResponsePdfSource(shape.id);
              if (!pdfId || !editor.getShape(pdfId)) return;
              setPdfPage(pdfId, page);
              editor.select(pdfId);
              const bounds = editor.getShapePageBounds(pdfId);
              if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 220 }, inset: 80 });
            }}
          />
        ) : (
          'Double-click to edit'
        )}
        {isStreaming && <span className="jz-stream-caret" aria-hidden />}
      </div>
    </div>
  );
}
