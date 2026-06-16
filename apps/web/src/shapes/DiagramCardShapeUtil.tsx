/**
 * Diagram card — an Ask response rendered as a Mermaid diagram. The server picks
 * the Mermaid subtype (flowchart, sequence, mindmap, ER, gantt, …) from the
 * prompt and streams the Mermaid source; while it streams we show the source
 * forming, then render it to SVG once it settles. If the source doesn't parse,
 * we fall back to showing it as code rather than failing silently.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  useEditor,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { renderMermaid, stripFences } from '../lib/mermaid';
import { useFitHeight } from './useFitHeight';
import { MAX_CARD_H, isExpanded, subscribeExpand } from './cardExpand';
import { ExpandToggle } from './ExpandToggle';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface DiagramCardProps {
  w: number;
  h: number;
  /** Mermaid source. */
  code: string;
  title?: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'diagram-card': DiagramCardProps;
  }
}

export type DiagramCardShape = TLShape<'diagram-card'>;

export const DIAGRAM_CARD_SIZE = { w: 540, h: 360 };

export class DiagramCardShapeUtil extends ShapeUtil<DiagramCardShape> {
  static override type = 'diagram-card' as const;

  static override props: RecordProps<DiagramCardShape> = {
    w: T.number,
    h: T.number,
    code: T.string,
    title: T.string,
  };

  override getDefaultProps(): DiagramCardShape['props'] {
    return { ...DIAGRAM_CARD_SIZE, code: '', title: '' };
  }

  override canResize() {
    return true;
  }

  override onResize(shape: DiagramCardShape, info: TLResizeInfo<DiagramCardShape>) {
    return resizeBox(shape, info, { minWidth: 320, minHeight: 200 });
  }

  override getGeometry(shape: DiagramCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: DiagramCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: DiagramCardShape) {
    return (
      <HTMLContainer>
        <DiagramCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function DiagramCardBody({ shape }: { shape: DiagramCardShape }) {
  const { code, title } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);
  const expanded = useSyncExternalStore(subscribeExpand, () => isExpanded(shape.id), () => false);

  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Render once the source settles (Mermaid can't render partial source); while
  // streaming we show the forming source instead.
  useEffect(() => {
    if (isStreaming || !code.trim()) {
      setSvg(null);
      setFailed(false);
      return;
    }
    let alive = true;
    void renderMermaid(`jz-mmd-${shape.id.replace(/[^a-z0-9]/gi, '')}`, stripFences(code)).then((res) => {
      if (!alive) return;
      if (res.svg) {
        setSvg(res.svg);
        setFailed(false);
      } else {
        setSvg(null);
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [code, isStreaming, shape.id]);

  // Grow to fit the rendered diagram; clamp very tall diagrams behind Expand.
  const fitRef = useRef<HTMLDivElement | null>(null);
  const overflowing = useFitHeight(shape.id, fitRef, [svg, code, isStreaming, failed], {
    streaming: isStreaming,
    expanded,
    maxHeight: MAX_CARD_H,
  });
  const collapsed = overflowing && !expanded && !isStreaming;

  return (
    <div className={`jz-diagram${collapsed ? ' jz-card-collapsed' : ''}`} ref={fitRef}>
      <div className="jz-diagram-head">
        <span className="jz-diagram-kind" aria-hidden>
          ◆
        </span>
        <span className="jz-diagram-title">{title || 'Diagram'}</span>
      </div>
      <div className="jz-diagram-body">
        {svg && !isStreaming ? (
          <div className="jz-diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : isStreaming ? (
          <pre className="jz-diagram-code">
            {stripFences(code)}
            <span className="jz-stream-caret" aria-hidden />
          </pre>
        ) : failed ? (
          <pre className="jz-diagram-code jz-diagram-code-raw">{stripFences(code)}</pre>
        ) : (
          <div className="jz-diagram-empty">Generating diagram…</div>
        )}
      </div>
      {overflowing && !isStreaming ? <ExpandToggle shapeId={shape.id} expanded={expanded} /> : null}
    </div>
  );
}
