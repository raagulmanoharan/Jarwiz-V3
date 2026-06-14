import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
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

export const TABLE_CARD_SIZE = { w: 560, h: 220 };
/** Header band height — kept in sync with the avatar cell-hop math (autopilotStore). */
export const TABLE_HEADER_H = 44;
/** Each column keeps at least this much width; adding columns widens the card. */
const MIN_COL_W = 136;

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

  // Width is user-resizable (min = one readable column per column); height is
  // content-driven and re-fit by the body's ResizeObserver, so we don't fight it.
  override onResize(shape: TableCardShape, info: TLResizeInfo<TableCardShape>) {
    return resizeBox(shape, info, { minWidth: MIN_COL_W * Math.max(1, shape.props.columns.length) });
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
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-fit the card's height to its (wrapping, multi-line) content. The root
  // is height:auto, so its scrollHeight is the natural content height; push it
  // back onto the shape so geometry/selection match what's rendered.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      if (editor.isIn('select.resizing')) return; // don't fight an active resize
      const needed = Math.ceil(el.scrollHeight);
      const cur = editor.getShape<TableCardShape>(shape.id);
      if (cur && needed > 0 && Math.abs(needed - cur.props.h) > 1) {
        editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { h: needed } });
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [editor, shape.id]);

  const gridCols = `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`;

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
  const addRow = () => {
    editor.updateShape<TableCardShape>({
      id: shape.id,
      type: 'table-card',
      props: { rows: [...rows, columns.map(() => '')] },
    });
  };
  const addColumn = () => {
    const nextCols = columns.length + 1;
    editor.updateShape<TableCardShape>({
      id: shape.id,
      type: 'table-card',
      props: {
        columns: [...columns, ''],
        rows: rows.map((r) => [...r, '']),
        w: Math.max(shape.props.w, nextCols * MIN_COL_W),
      },
    });
  };

  const cellKeys = (e: React.KeyboardEvent) => autopilot.onKeyDown(shape.id, e);
  const isEmpty = rows.every((r) => r.every((c) => !c.trim())) && columns.every((c) => !c.trim());

  return (
    <div className={`jz-table${isFilling ? ' jz-table-filling' : ''}`} ref={rootRef}>
      <div className="jz-table-head" style={{ gridTemplateColumns: gridCols }}>
        {columns.map((label, col) =>
          isEditing ? (
            <textarea
              key={col}
              className="jz-table-headcell jz-table-input"
              value={label}
              rows={1}
              placeholder={`Column ${col + 1}`}
              style={{ pointerEvents: 'all' }}
              onChange={(e) => setHeader(col, e.currentTarget.value)}
              onKeyDown={cellKeys}
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
                <textarea
                  key={col}
                  className="jz-table-cell jz-table-input"
                  value={cell}
                  rows={1}
                  style={{ pointerEvents: 'all' }}
                  onChange={(e) => setCell(row, col, e.currentTarget.value)}
                  onKeyDown={cellKeys}
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

      {isEditing ? (
        <div className="jz-table-controls">
          <button
            className="jz-table-add"
            onClick={addRow}
            onPointerDown={stopEventPropagation}
            style={{ pointerEvents: 'all' }}
            title="Add a row"
          >
            + Row
          </button>
          <button
            className="jz-table-add"
            onClick={addColumn}
            onPointerDown={stopEventPropagation}
            style={{ pointerEvents: 'all' }}
            title="Add a column"
          >
            + Column
          </button>
        </div>
      ) : null}

      {!isEditing && isEmpty ? (
        <div className="jz-table-hint" aria-hidden>
          Double-click, then press Tab to fill
        </div>
      ) : null}
    </div>
  );
}
