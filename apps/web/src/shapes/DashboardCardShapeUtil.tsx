/**
 * Dashboard card — an interactive, generative dashboard built from a card's
 * data (a spreadsheet or table). Claude emits an OpenUI Lang spec; OpenUI's
 * offline reconciler (`<Renderer>`) draws it through our own monochrome
 * component library — 100% client-side, no external service. While the spec
 * streams the card shows a building state; once done the dashboard is live and
 * interactive (filters/toggles run in-browser).
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { Renderer } from '@openuidev/react-lang';
import { BarChart3, Loader2 } from 'lucide-react';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { dashboardLibrary } from '../dashboard/library';

export interface DashboardCardProps {
  w: number;
  h: number;
  /** The OpenUI Lang spec the model produced (streamed in). */
  spec: string;
  title: string;
  /** 'running' (streaming the spec) | 'done' | 'error'. */
  status: string;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'dashboard-card': DashboardCardProps;
  }
}

export type DashboardCardShape = TLShape<'dashboard-card'>;

export const DASHBOARD_CARD_SIZE = { w: 780, h: 560 };

export class DashboardCardShapeUtil extends ShapeUtil<DashboardCardShape> {
  static override type = 'dashboard-card' as const;

  static override props: RecordProps<DashboardCardShape> = {
    w: T.number,
    h: T.number,
    spec: T.string,
    title: T.string,
    status: T.string,
  };

  override getDefaultProps(): DashboardCardShape['props'] {
    return { ...DASHBOARD_CARD_SIZE, spec: '', title: 'Dashboard', status: 'running' };
  }

  override canResize() {
    return true;
  }
  override onResize(shape: DashboardCardShape, info: TLResizeInfo<DashboardCardShape>) {
    return resizeBox(shape, info, { minWidth: 360, minHeight: 240 });
  }
  override getGeometry(shape: DashboardCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }
  override getIndicatorPath(shape: DashboardCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }
  override component(shape: DashboardCardShape) {
    return (
      <HTMLContainer>
        <DashboardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function DashboardBody({ shape }: { shape: DashboardCardShape }) {
  const { spec, status } = shape.props;
  // The runner streams the OpenUI Lang spec into props.spec token by token
  // (like the prototype card streams its html), so the shape re-renders as it
  // grows and the Renderer reveals the dashboard progressively.
  const streaming = status === 'running';
  const source = spec;

  return (
    <div className="jz-card jzd-root" data-status={status}>
      {streaming && !source.trim() ? (
        <div className="jzd-loading">
          <Loader2 size={18} className="jzd-spin" />
          <span>Building your dashboard…</span>
        </div>
      ) : (
        <div
          className="jzd-scroll"
          // Once live, let clicks reach the dashboard's own controls instead of
          // starting a canvas drag; while streaming it stays inert.
          onPointerDown={status === 'done' ? stopEventPropagation : undefined}
          onWheelCapture={status === 'done' ? stopEventPropagation : undefined}
        >
          <Renderer response={source} library={dashboardLibrary} isStreaming={streaming} />
        </div>
      )}
      {status === 'error' ? (
        <div className="jzd-error"><BarChart3 size={16} /> Couldn’t build the dashboard.</div>
      ) : null}
    </div>
  );
}
