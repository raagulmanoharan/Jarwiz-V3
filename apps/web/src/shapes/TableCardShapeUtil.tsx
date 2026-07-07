import { useRef, useState, useSyncExternalStore } from 'react';
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
import { fillTable } from '../agents/autopilotStore';
import { formatControlledTextarea, shortcutMarker, toggleInline } from '../ask/textFormat';
import { uploadAsset } from '../lib/uploadAsset';
import { useAutopilot } from '../agents/useAutopilot';
import { useFitHeight } from './useFitHeight';
import { isExpanded, subscribeExpand } from './cardExpand';
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

/** A starter comparison grid: headers filled, body empty and ready to type. */
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
  // A generated table lands SELECTED, not editing — the add affordance must
  // already be there (the owner's flow: pill → comparison table → "+" adds a
  // column → its header offers "✦ Fill"). Adding also enters edit mode.
  const isSelected = useValue(
    'table-selected',
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );
  const { columns, rows } = shape.props;
  // Optional [row, col] to visually highlight (e.g. the hero showreel flags the
  // stale cell while its value regenerates). Drawn on the real cell, so it's
  // always pixel-aligned — no floating overlay.
  const flashCell = Array.isArray((shape.meta as Record<string, unknown>).jzFlashCell)
    ? ((shape.meta as Record<string, unknown>).jzFlashCell as number[])
    : null;
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
    // Tables grow to hold all their rows — no clamp, no Expand (owner call).
    maxHeight: Infinity,
  });
  const collapsed = overflowing && !expanded && !isFilling;

  const gridCols = `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`;

  // Media-aware width: a table that holds images grows to give every column
  // real room (photos at 140px-wide columns read as thumbnails of nothing).
  // Grow-only — a manual widen is never fought.
  const hasImages = rows.some((r) => r.some((c) => typeof c === 'string' && c.includes('![')));
  const MEDIA_COL_W = 220;
  if (hasImages && shape.props.w < columns.length * MEDIA_COL_W) {
    queueMicrotask(() => {
      const cur = editor.getShape(shape.id) as TableCardShape | undefined;
      if (cur && cur.props.w < cur.props.columns.length * MEDIA_COL_W) {
        editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { w: cur.props.columns.length * MEDIA_COL_W } });
      }
    });
  }

  // ── Column types (text / link / photo) ────────────────────────────────────
  const colType = (i: number): ColumnType => {
    const t = (shape.props.columnTypes ?? [])[i];
    return t === 'link' || t === 'photo' ? t : 'text';
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
  /** Insert an empty row at `at` and put the caret in its first cell —
   *  Shift+Enter's landing spot (rows have no add/delete chrome at all). */
  const insertRow = (at: number) => {
    const next = rows.map((r) => [...r]);
    next.splice(at, 0, columns.map(() => ''));
    editor.updateShape<TableCardShape>({ id: shape.id, type: 'table-card', props: { rows: next } });
    requestAnimationFrame(() => {
      const cells = document.querySelectorAll<HTMLTextAreaElement>('.jz-table-cell.jz-table-input');
      cells[at * columns.length]?.focus();
    });
  };
  const addColumn = () => {
    editor.updateShape<TableCardShape>({
      id: shape.id,
      type: 'table-card',
      props: {
        columns: [...columns, ''],
        rows: rows.map((r) => [...r, '']),
        columnTypes: [...columns.map((_, i) => colType(i)), 'text'],
        // WIDEN by one column's worth — existing columns keep their exact
        // width (squeezing them read as "fill changed my table").
        w: Math.round(shape.props.w * (columns.length + 1) / Math.max(1, columns.length)),
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

  const hasEmptyCells = rows.some((r) => r.some((c) => !c.trim()));

  const cellKeys = (e: React.KeyboardEvent, row?: number) => {
    // ⌘/Ctrl B·I·U — same operations as the format bar, on this cell.
    const marker = shortcutMarker(e);
    if (marker && e.currentTarget instanceof HTMLTextAreaElement) {
      e.preventDefault();
      formatControlledTextarea(e.currentTarget, (t, s, en) => toggleInline(t, s, en, marker));
      return;
    }
    // Shift+Enter inserts a row below the current one (below the header →
    // a first row). Rows need no chrome: this is the whole row model.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      insertRow(row === undefined ? 0 : row + 1);
      return;
    }
    // Backspace on a fully empty row removes the row (Notion-list style).
    if (
      e.key === 'Backspace' &&
      row !== undefined &&
      rows.length > 1 &&
      (e.currentTarget as HTMLTextAreaElement).value === '' &&
      rows[row]!.every((c) => !c.trim())
    ) {
      e.preventDefault();
      removeRow(row);
      return;
    }
    autopilot.onKeyDown(shape.id, e);
  };
  const isEmpty = rows.every((r) => r.every((c) => !c.trim())) && columns.every((c) => !c.trim());

  // Edit chrome shows on selection too, not just in edit mode.
  const chrome = isEditing || isSelected;
  // The column just added via "+" — its header offers "✦ Fill" (click hands
  // the column to Jarwiz) until it's used, dismissed by typing elsewhere, or
  // the column gains content.
  const [freshCol, setFreshCol] = useState<number | null>(null);
  const addColumnAndEdit = () => {
    addColumn();
    setFreshCol(columns.length); // index of the column being added
    if (!isEditing) editor.setEditingShape(shape.id);
  };
  const runFill = () => {
    setFreshCol(null);
    void fillTable(editor, shape.id);
  };

  return (
    <>
    {/* The column "+" hovers OUTSIDE the frame beside the header band — a
        sibling of .jz-table because the card clips (overflow: hidden). */}
    {chrome ? (
      <button
        className="jz-table-rail jz-table-rail-col"
        onClick={addColumnAndEdit}
        onPointerDown={stopEventPropagation}
        style={{ pointerEvents: 'all' }}
        title="Add a column"
        aria-label="Add a column"
      >
        +
      </button>
    ) : null}
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
              {freshCol === col && hasEmptyCells && !isFilling ? (
                <button
                  className="jz-fillnudge"
                  title="Let Jarwiz fill this column from the other cells"
                  style={{ pointerEvents: 'all' }}
                  onPointerDown={stopEventPropagation}
                  onClick={runFill}
                >
                  ✦ Fill
                </button>
              ) : null}
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
                  onKeyDown={(e) => cellKeys(e, row)}
                  onPointerDown={stopEventPropagation}
                  onPointerMove={stopEventPropagation}
                  onPointerUp={stopEventPropagation}
                />
              ) : (
                <div
                  key={col}
                  className={`jz-table-cell jz-table-cell-static${flashCell && flashCell[0] === row && flashCell[1] === col ? ' jz-table-cell--flash' : ''}`}
                >
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
          </div>
        ))}
      </div>

      {/* Rows have NO chrome (owner call): Shift+Enter inserts a row below
          the caret, Backspace on an empty row removes it. Column ops: the
          "+" outside the frame (above) and a × per header. */}
      {!isEditing && isEmpty ? (
        <div className="jz-table-hint" aria-hidden>
          Double-click to type
        </div>
      ) : null}
      </div>
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
    </>
  );
}
