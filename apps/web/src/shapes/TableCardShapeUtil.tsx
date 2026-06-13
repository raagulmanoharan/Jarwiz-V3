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
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export interface TableCardProps {
  w: number;
  h: number;
  columns: string[];
  rows: string[][];
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'table-card': TableCardProps;
  }
}

export type TableCardShape = TLShape<'table-card'>;

export const TABLE_CARD_SIZE = { w: 560, h: 260 };
/** Header band height — kept in sync with the avatar cell-hop math (autopilotStore). */
export const TABLE_HEADER_H = 40;

/** A starter comparison grid: headers filled, body empty and ready for Tab. */
export function starterTableProps(): TableCardProps {
  return {
    ...TABLE_CARD_SIZE,
    columns: ['Option', 'Cost', 'Strengths', 'Watch-outs'],
    rows: [
      ['', '', '', ''],
      ['', '', '', ''],
      ['', '', '', ''],
    ],
  };
}

export class TableCardShapeUtil extends ShapeUtil<TableCardShape> {
  static override type = 'table-card' as const;

  static override props: RecordProps<TableCardShape> = {
    w: T.number,
    h: T.number,
    columns: T.arrayOf(T.string),
    rows: T.arrayOf(T.arrayOf(T.string)),
  };

  override getDefaultProps(): TableCardShape['props'] {
    return starterTableProps();
  }

  override canResize() {
    return true;
  }

  override canEdit() {
    return true;
  }

  override onResize(shape: TableCardShape, info: TLResizeInfo<TableCardShape>) {
    return resizeBox(shape, info, { minWidth: 360, minHeight: 160 });
  }

  override getGeometry(shape: TableCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: TableCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: TableCardShape) {
    return (
      <HTMLContainer>
        <TableCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

function TableCardBody({ shape }: { shape: TableCardShape }) {
  const editor = useEditor();
  const isEditing = useIsEditing(shape.id);
  const { columns, rows } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isFilling = streamingSet.has(shape.id);
  const autopilot = useAutopilot();

  const gridCols = `repeat(${columns.length}, minmax(0, 1fr))`;

  const setHeader = (col: number, value: string) => {
    const next = [...columns];
    next[col] = value;
    editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { columns: next } });
  };
  const setCell = (row: number, col: number, value: string) => {
    const next = rows.map((r) => [...r]);
    if (!next[row]) return;
    next[row][col] = value;
    editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { rows: next } });
  };

  return (
    <div className={`jz-table${isFilling ? ' jz-table-filling' : ''}`}>
      <div className="jz-table-head" style={{ gridTemplateColumns: gridCols, height: TABLE_HEADER_H }}>
        {columns.map((label, col) =>
          isEditing ? (
            <input
              key={col}
              className="jz-table-headcell"
              value={label}
              placeholder={`Column ${col + 1}`}
              style={{ pointerEvents: 'all' }}
              onChange={(e) => setHeader(col, e.currentTarget.value)}
              onKeyDown={(e) => autopilot.onKeyDown(shape.id, e)}
              onPointerDown={stopEventPropagation}
              onPointerMove={stopEventPropagation}
              onPointerUp={stopEventPropagation}
            />
          ) : (
            <div key={col} className="jz-table-headcell jz-table-headcell-static">
              {label || `Column ${col + 1}`}
            </div>
          ),
        )}
      </div>
      <div className="jz-table-body">
        {rows.map((cells, row) => (
          <div key={row} className="jz-table-row" style={{ gridTemplateColumns: gridCols }}>
            {cells.map((cell, col) =>
              isEditing ? (
                <input
                  key={col}
                  className="jz-table-cell"
                  value={cell}
                  style={{ pointerEvents: 'all' }}
                  onChange={(e) => setCell(row, col, e.currentTarget.value)}
                  onKeyDown={(e) => autopilot.onKeyDown(shape.id, e)}
                  onPointerDown={stopEventPropagation}
                  onPointerMove={stopEventPropagation}
                  onPointerUp={stopEventPropagation}
                />
              ) : (
                <div key={col} className="jz-table-cell jz-table-cell-static">
                  {cell}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      {!isEditing && rows.every((r) => r.every((c) => !c.trim())) ? (
        <div className="jz-table-hint" aria-hidden>
          Double-click, then press Tab to fill
        </div>
      ) : null}
    </div>
  );
}
