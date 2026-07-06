/**
 * UI mockup card — a generative-UI answer (OpenUI-style: "describe a screen,
 * see it rendered"). The server streams ONE self-contained HTML document (inline
 * CSS/JS, no external resources); while it streams we show the markup forming,
 * then render it live in a sandboxed iframe once it settles.
 *
 * Safety: the HTML is authored by our own model, but we still render it in a
 * SANDBOXED iframe with `sandbox="allow-scripts"` and NO `allow-same-origin`.
 * That gives the framed document a unique opaque origin — its scripts run (so
 * animations/interactions look right) but can't reach our app's DOM, cookies,
 * or storage. The iframe is `pointer-events: none`: it's a live *preview*, so
 * the card still drags/selects on the canvas like every other card rather than
 * swallowing gestures. Fixed viewport with internal scroll (a mockup has a
 * size), so unlike the diagram card it does NOT grow to fit its content.
 */

import { useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface UiMockupCardProps {
  w: number;
  h: number;
  /** A self-contained HTML document (inline CSS/JS, no external resources). */
  html: string;
  title?: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'uimockup-card': UiMockupCardProps;
  }
}

export type UiMockupCardShape = TLShape<'uimockup-card'>;

export const UIMOCKUP_CARD_SIZE = { w: 520, h: 400 };

/** Strip any ``` fences the model might wrap the document in. */
function stripFences(html: string): string {
  return html.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/i, '');
}

export class UiMockupCardShapeUtil extends ShapeUtil<UiMockupCardShape> {
  static override type = 'uimockup-card' as const;

  static override props: RecordProps<UiMockupCardShape> = {
    w: T.number,
    h: T.number,
    html: T.string,
    title: T.string,
  };

  override getDefaultProps(): UiMockupCardShape['props'] {
    return { ...UIMOCKUP_CARD_SIZE, html: '', title: '' };
  }

  override canResize() {
    return true;
  }

  override onResize(shape: UiMockupCardShape, info: TLResizeInfo<UiMockupCardShape>) {
    return resizeBox(shape, info, { minWidth: 280, minHeight: 220 });
  }

  override getGeometry(shape: UiMockupCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: UiMockupCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: UiMockupCardShape) {
    return (
      <HTMLContainer>
        <UiMockupCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function UiMockupCardBody({ shape }: { shape: UiMockupCardShape }) {
  const { html, title } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isStreaming = streamingSet.has(shape.id);
  const doc = stripFences(html);
  const hasDoc = Boolean(doc.trim());

  return (
    <div className="jz-uimockup">
      <div className="jz-uimockup-head">
        <span className="jz-uimockup-kind" aria-hidden>
          ▢
        </span>
        <span className="jz-uimockup-title">{title || 'UI mockup'}</span>
      </div>
      <div className="jz-uimockup-body">
        {hasDoc && !isStreaming ? (
          // Opaque-origin sandbox: scripts run, but the frame can't touch our
          // app. A live preview, not an interactive surface (pointer-events off).
          <iframe
            className="jz-uimockup-frame"
            title={title || 'UI mockup'}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={doc}
          />
        ) : isStreaming ? (
          <pre className="jz-uimockup-code">
            {doc}
            <span className="jz-stream-caret" aria-hidden />
          </pre>
        ) : (
          <div className="jz-uimockup-empty">Generating UI…</div>
        )}
      </div>
    </div>
  );
}
