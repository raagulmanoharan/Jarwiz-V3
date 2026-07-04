import { useRef, useSyncExternalStore } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  useIsEditing,
  useValue,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { getStreamingSnapshot, subscribeStreaming } from '../agents/streaming';
import { uploadAsset } from '../lib/uploadAsset';
import { useAutopilot } from '../agents/useAutopilot';
import { useTypingPause } from '../agents/useTypingPause';
import { useFitHeight } from './useFitHeight';
import { MAX_CARD_H, isExpanded, subscribeExpand } from './cardExpand';
import { ExpandToggle } from './ExpandToggle';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';
import { renderRichCell } from './tableRich';

export type ColumnType = 'text' | 'link' | 'photo';

export interface TableCardProps {
  w: number;
  h: number;
  columns: string[];
  rows: string[][];
  /** Per-column type, aligned with `columns` by index. Optional so every
   *  table persisted before types existed stays valid; missing → 'text'. */
  columnTypes?: string[];
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
const MIN_COL_W = 150;

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
    columnTypes: T.arrayOf(T.string).optional(),
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
  // A generated table lands SELECTED, not editing — the add affordances must
  // already be there (the owner's flow: pill → comparison table → "+ column
  // for another aspect" → Tab to let Jarwiz fill it). Clicking one from the
  // selected state performs the add AND enters edit mode, so the very next
  // keystroke can be Tab.
  const isSelected = useValue(
    'table-selected',
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );
  const { columns, rows } = shape.props;
  const streamingSet = useSyncExternalStore(subscribeStreaming, getStreamingSnapshot, getStreamingSnapshot);
  const isFilling = streamingSet.has(shape.id);
  const autopilot = useAutopilot();
  const expanded = useSyncExternalStore(subscribeExpand, () => isExpanded(shape.id), () => false);
  // Grow to fit all rows; clamp past the threshold once settled (collapsible).
  const fitRef = useRef<HTMLDivElement | null>(null);
  // Fit stays on while editing: edit mode adds chrome (the +Row/+Column bar,
  // delete gutters) that the card must grow to hold — and a shrunk-to-fit
  // card would otherwise clip it. The wrapper's ResizeObserver also grows the
  // card live as a cell's textarea wraps to more lines.
  const overflowing = useFitHeight(shape.id, fitRef, [columns, rows, isEditing], {
    streaming: isFilling,
    expanded,
    maxHeight: MAX_CARD_H,
  });
  const collapsed = overflowing && !expanded && !isFilling;

  const gridCols = `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`;

  // ── Column types (text / link / photo) ────────────────────────────────────
  const colType = (i: number): ColumnType => {
    const t = (shape.props.columnTypes ?? [])[i];
    return t === 'link' || t === 'photo' ? t : 'text';
  };
  const cycleType = (i: number) => {
    const order: ColumnType[] = ['text', 'link', 'photo'];
    const next = order[(order.indexOf(colType(i)) + 1) % order.length]!;
    const types = columns.map((_, c) => (c === i ? next : colType(c)));
    editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { columnTypes: types } });
  };

  /** Write one cell on the LATEST shape — async completions (an upload, a
   *  fetched link title) must never stomp edits made while they were away. */
  const setCellIfUnchanged = (row: number, col: number, expected: string, value: string) => {
    const cur = editor.getShape(shape.id) as TableCardShape | undefined;
    if (!cur) return;
    if ((cur.props.rows[row]?.[col] ?? '').trim() !== expected.trim()) return;
    const next = cur.props.rows.map((r) => [...r]);
    next[row]![col] = value;
    editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { rows: next } });
  };

  // Link column: a bare URL left in a cell fetches the page title (the same
  // SSRF-guarded preview the link card uses) and becomes a [Title](url) chip.
  const enrichLinkCell = (row: number, col: number, value: string) => {
    if (colType(col) !== 'link') return;
    const v = value.trim();
    if (!/^https?:\/\/\S+$/.test(v)) return;
    void fetch('/api/link/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: v }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ title?: string }>) : null))
      .then((p) => {
        if (p?.title) setCellIfUnchanged(row, col, v, `[${p.title}](${v})`);
      })
      .catch(() => {
        /* preview is enrichment — the bare URL already renders as a link */
      });
  };

  // Photo column: an empty cell offers an upload straight into the blob store.
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoTargetRef = useRef<{ row: number; col: number } | null>(null);
  const pickPhoto = (row: number, col: number) => {
    photoTargetRef.current = { row, col };
    photoInputRef.current?.click();
  };
  const onPhotoPicked = (file: File | undefined) => {
    const target = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!file || !target) return;
    void uploadAsset(file, 'img')
      .then(({ url }) => setCellIfUnchanged(target.row, target.col, '', `![${file.name}](${url})`))
      .catch(() => {
        /* upload failed — the cell stays empty and offers again */
      });
  };

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
        columnTypes: [...columns.map((_, i) => colType(i)), 'text'],
        w: Math.max(shape.props.w, nextCols * MIN_COL_W),
      },
    });
  };
  const removeRow = (row: number) => {
    if (rows.length <= 1) return; // keep at least one row
    editor.updateShape<TableCardShape>({
      id: shape.id,
      type: 'table-card',
      props: { rows: rows.filter((_, i) => i !== row) },
    });
  };
  const removeColumn = (col: number) => {
    if (columns.length <= 1) return; // keep at least one column
    const nextCount = columns.length - 1;
    editor.updateShape<TableCardShape>({
      id: shape.id,
      type: 'table-card',
      props: {
        columns: columns.filter((_, i) => i !== col),
        rows: rows.map((r) => r.filter((_, i) => i !== col)),
        columnTypes: columns.map((_, i) => colType(i)).filter((_, i) => i !== col),
        // Reclaim the removed column's width so the rest don't stretch oddly.
        w: Math.max(nextCount * MIN_COL_W, Math.round((shape.props.w * nextCount) / columns.length)),
      },
    });
  };

  const [paused, resetPause] = useTypingPause(
    isEditing ? rows.map((r) => r.join('|')).join('\n') + '\n' + columns.join('|') : '',
    1800,
  );
  const hasEmptyCells = rows.some((r) => r.some((c) => !c.trim()));
  const showNudge = isEditing && paused && hasEmptyCells && !isFilling;

  const cellKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') resetPause();
    autopilot.onKeyDown(shape.id, e);
  };
  const isEmpty = rows.every((r) => r.every((c) => !c.trim())) && columns.every((c) => !c.trim());

  // Edit chrome shows on selection too, not just in edit mode.
  const chrome = isEditing || isSelected;
  const addRowAndEdit = () => {
    addRow();
    if (!isEditing) editor.setEditingShape(shape.id);
  };
  const addColumnAndEdit = () => {
    addColumn();
    if (!isEditing) editor.setEditingShape(shape.id);
  };

  return (
    <div
      className={`jz-table${isFilling ? ' jz-table-filling' : ''}${collapsed ? ' jz-card-collapsed' : ''}${chrome ? ' jz-table--chrome' : ''}`}
    >
      {/* Measured wrapper: the frame is height:100% (its scrollHeight always
          equals the CURRENT shape height — the fit-height ratchet), so the
          hook measures this auto-height child instead, which reports true
          content height and lets the card shrink to fit as well as grow. */}
      <div className="jz-table-fit" ref={fitRef}>
      <div className="jz-table-head" style={{ gridTemplateColumns: gridCols }}>
        {columns.map((label, col) =>
          isEditing ? (
            <div key={col} className="jz-table-headcell jz-table-headcell-edit">
              <textarea
                className="jz-table-input"
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
              <button
                className="jz-table-coltype"
                title={`Column type: ${colType(col)} — click to change`}
                aria-label={`Column type: ${colType(col)}`}
                tabIndex={-1}
                style={{ pointerEvents: 'all' }}
                onPointerDown={stopEventPropagation}
                onClick={() => cycleType(col)}
              >
                <ColTypeGlyph type={colType(col)} />
              </button>
              {columns.length > 1 ? (
                <button
                  className="jz-table-del jz-table-del-col"
                  title="Delete column"
                  aria-label="Delete column"
                  tabIndex={-1}
                  style={{ pointerEvents: 'all' }}
                  onPointerDown={stopEventPropagation}
                  onClick={() => removeColumn(col)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : (
            <div key={col} className="jz-table-headcell jz-table-headcell-static">
              {colType(col) !== 'text' ? (
                <span className="jz-table-coltype-static" aria-hidden>
                  <ColTypeGlyph type={colType(col)} />
                </span>
              ) : null}
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
                  onBlur={(e) => enrichLinkCell(row, col, e.currentTarget.value)}
                  onKeyDown={cellKeys}
                  onPointerDown={stopEventPropagation}
                  onPointerMove={stopEventPropagation}
                  onPointerUp={stopEventPropagation}
                />
              ) : (
                <div key={col} className="jz-table-cell jz-table-cell-static">
                  {colType(col) === 'photo' && !cell.trim() ? (
                    <button
                      className="jz-table-cellupload"
                      title="Add a photo"
                      style={{ pointerEvents: 'all' }}
                      onPointerDown={stopEventPropagation}
                      onClick={() => pickPhoto(row, col)}
                    >
                      + Photo
                    </button>
                  ) : (
                    renderRichCell(cell)
                  )}
                </div>
              ),
            )}
            {/* Row delete floats at the row's right edge, hover-revealed. */}
            {isEditing && rows.length > 1 ? (
              <button
                className="jz-table-del jz-table-del-row"
                title="Delete row"
                aria-label="Delete row"
                tabIndex={-1}
                style={{ pointerEvents: 'all' }}
                onPointerDown={stopEventPropagation}
                onClick={() => removeRow(row)}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {/* Cove-style edge affordances instead of a button bar: a slim + strip
          along the bottom adds a row; its twin on the right edge adds a column.
          Available from the SELECTED state — adding also enters edit mode so
          Tab-to-fill is one keystroke away. */}
      {chrome ? (
        <button
          className="jz-table-edgeadd jz-table-edgeadd-row"
          onClick={addRowAndEdit}
          onPointerDown={stopEventPropagation}
          style={{ pointerEvents: 'all' }}
          title="Add a row"
          aria-label="Add a row"
        >
          +
        </button>
      ) : null}
      {chrome ? (
        <button
          className="jz-table-edgeadd jz-table-edgeadd-col"
          onClick={addColumnAndEdit}
          onPointerDown={stopEventPropagation}
          style={{ pointerEvents: 'all' }}
          title="Add a column"
          aria-label="Add a column"
        >
          +
        </button>
      ) : null}
      {showNudge && (
        <div className="jz-autopilot-nudge jz-autopilot-nudge--table" aria-hidden>
          <span className="jz-autopilot-nudge-spark">✦</span>Tab to fill
        </div>
      )}

      {!isEditing && isEmpty ? (
        <div className="jz-table-hint" aria-hidden>
          Double-click, then press Tab to fill
        </div>
      ) : null}
      </div>
      {overflowing && !isFilling ? <ExpandToggle shapeId={shape.id} expanded={expanded} /> : null}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          onPhotoPicked(file);
        }}
      />
    </div>
  );
}

function ColTypeGlyph({ type }: { type: ColumnType }) {
  if (type === 'photo') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-4.5-4.5L5 22" />
      </svg>
    );
  }
  if (type === 'link') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7V5h16v2M12 5v14M9 19h6" />
    </svg>
  );
}
