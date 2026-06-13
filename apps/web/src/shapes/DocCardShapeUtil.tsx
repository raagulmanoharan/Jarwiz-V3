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
} from 'tldraw';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { useAutopilot } from '../agents/useAutopilot';
import { DocMarkdown } from '../ui/DocMarkdown';
import { DOC_RADIUS, roundedRectPath } from './cardGeometry';

export interface DocCardProps {
  w: number;
  h: number;
  text: string;
  title?: string;
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
  };

  override getDefaultProps(): DocCardShape['props'] {
    return { ...DOC_CARD_SIZE, text: '', title: '' };
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
          placeholder="Write something… (Tab to continue with an agent)"
          className="jz-doc-textarea"
          style={{ pointerEvents: 'all' }}
          onKeyDown={(e) => autopilot.onKeyDown(shape.id, e)}
          onChange={(e) =>
            editor.updateShape<DocCardShape>({
              id: shape.id,
              type: 'doc-card',
              props: { text: e.currentTarget.value },
            })
          }
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
        {text ? <DocMarkdown content={text} /> : 'Double-click to edit'}
        {isStreaming && <span className="jz-stream-caret" aria-hidden />}
      </div>
    </div>
  );
}
