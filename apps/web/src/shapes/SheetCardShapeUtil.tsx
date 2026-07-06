/**
 * The spreadsheet card — a dropped .xlsx/.xls/.csv, styled like the PDF card
 * (footer with a file glyph + name, a pager that switches SHEETS instead of
 * pages) but wider, because spreadsheets are wide. Bytes live in the blob
 * store; the card holds the asset id and fetches a capped JSON grid from the
 * server (SheetJS parses server-side, so it never bloats the web bundle).
 * The grid renders as a scrollable read-only table; asks ground on the cells.
 */

import { useEffect, useRef, useState } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  stopEventPropagation,
  useEditor,
  type RecordProps,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw';
import { CARD_RADIUS, roundedRectPath } from './cardGeometry';

export type SheetStatus = 'uploading' | 'ready' | 'error';

export interface SheetCardProps {
  w: number;
  h: number;
  /** GET URL of the stored file (unused for render, kept for parity/download). */
  src: string;
  /** Server asset id — the grid fetch and Ask grounding key. */
  assetId: string;
  name: string;
  status: SheetStatus;
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    'sheet-card': SheetCardProps;
  }
}

export type SheetCardShape = TLShape<'sheet-card'>;

/** Wider than the PDF card — a spreadsheet reads across, not down. */
export const SHEET_CARD_SIZE = { w: 620, h: 420 };
const FOOTER_H = 40;

interface Grid {
  name: string;
  rows: string[][];
  totalRows: number;
  totalCols: number;
}

export class SheetCardShapeUtil extends ShapeUtil<SheetCardShape> {
  static override type = 'sheet-card' as const;

  static override props: RecordProps<SheetCardShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    assetId: T.string,
    name: T.string,
    status: T.literalEnum('uploading', 'ready', 'error'),
  };

  override getDefaultProps(): SheetCardShape['props'] {
    return { ...SHEET_CARD_SIZE, src: '', assetId: '', name: '', status: 'uploading' };
  }

  override canResize() {
    return true;
  }

  override onResize(shape: SheetCardShape, info: TLResizeInfo<SheetCardShape>) {
    return resizeBox(shape, info, { minWidth: 320, minHeight: 220 });
  }

  override getGeometry(shape: SheetCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: SheetCardShape) {
    return roundedRectPath(shape.props.w, shape.props.h, CARD_RADIUS);
  }

  override component(shape: SheetCardShape) {
    return (
      <HTMLContainer>
        <SheetCardBody shape={shape} />
      </HTMLContainer>
    );
  }
}

/** Fit the card's height to the grid so a short sheet isn't a tall empty
 *  card — capped, and only ONCE per shape (a later user resize is respected). */
const MAX_FIT_H = 560;

function SheetCardBody({ shape }: { shape: SheetCardShape }) {
  const editor = useEditor();
  const { assetId, name, status } = shape.props;
  const [sheets, setSheets] = useState<Grid[] | null>(null);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (status !== 'ready' || !assetId) return;
    let cancelled = false;
    setFailed(false);
    fetch(`/api/sheet/${encodeURIComponent(assetId)}/grid`)
      .then((r) => (r.ok ? (r.json() as Promise<{ sheets: Grid[] }>) : null))
      .then((g) => {
        if (cancelled) return;
        if (g?.sheets?.length) setSheets(g.sheets);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [assetId, status]);

  const grid = sheets?.[Math.min(active, (sheets?.length ?? 1) - 1)];

  // Once the first grid renders, shrink the card's height to hug the content
  // (up to a cap) so a 7-row sheet isn't a tall, empty box.
  useEffect(() => {
    if (fittedRef.current || !grid || !scrollRef.current) return;
    const table = scrollRef.current.querySelector('.jz-sheet-table') as HTMLElement | null;
    if (!table) return;
    fittedRef.current = true;
    const target = Math.max(180, Math.min(Math.ceil(table.scrollHeight) + FOOTER_H + 8, MAX_FIT_H));
    const cur = editor.getShape(shape.id);
    if (cur && Math.abs((cur.props as SheetCardProps).h - target) > 4) {
      editor.updateShape<SheetCardShape>({ id: shape.id, type: 'sheet-card', props: { h: target } });
    }
  }, [grid, editor, shape.id]);

  return (
    <div className="jz-card jz-sheet-card">
      <div className="jz-sheet-stage" onPointerDown={status === 'ready' ? stopEventPropagation : undefined}>
        {status === 'uploading' ? (
          <SheetMessage label={`Uploading ${name || 'spreadsheet'}…`} spinner />
        ) : status === 'error' ? (
          <SheetMessage label={`Couldn't upload ${name || 'this file'}`} />
        ) : failed ? (
          <SheetMessage label="Couldn't read this spreadsheet" />
        ) : !grid ? (
          <SheetMessage label="Reading…" spinner />
        ) : (
          <div className="jz-sheet-scroll" ref={scrollRef}>
            <table className="jz-sheet-table">
              <tbody>
                {grid.rows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="jz-sheet-rownum">{ri + 1}</td>
                    {row.map((cell, ci) => (
                      <td key={ci} className={ri === 0 ? 'jz-sheet-th' : undefined}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {grid.totalRows > grid.rows.length ? (
              <div className="jz-sheet-more">+{grid.totalRows - grid.rows.length} more rows</div>
            ) : null}
          </div>
        )}
      </div>
      <div className="jz-sheet-footer" onPointerDown={stopEventPropagation}>
        <SheetGlyph />
        <span className="jz-sheet-name" title={name}>
          {name || 'Spreadsheet.xlsx'}
        </span>
        {status === 'ready' && sheets && sheets.length > 1 ? (
          <span className="jz-sheet-tabs">
            {sheets.map((s, i) => (
              <button
                key={i}
                className={`jz-sheet-tab${i === active ? ' jz-sheet-tab--on' : ''}`}
                title={s.name}
                onPointerDown={stopEventPropagation}
                onClick={() => setActive(i)}
              >
                {s.name}
              </button>
            ))}
          </span>
        ) : status === 'ready' && grid ? (
          <span className="jz-sheet-dims">
            {grid.totalRows}×{grid.totalCols}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SheetMessage({ label, spinner = false }: { label: string; spinner?: boolean }) {
  return (
    <div className="jz-sheet-message">
      {spinner ? <span className="jz-sheet-spinner" aria-hidden /> : <SheetGlyph size={26} />}
      <span>{label}</span>
    </div>
  );
}

function SheetGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden style={{ flex: 'none' }}>
      <rect x="2.2" y="2.2" width="9.6" height="9.6" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.2 5.6h9.6M2.2 8.6h9.6M5.4 2.2v9.6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
