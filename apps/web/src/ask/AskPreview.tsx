/**
 * The artefact preview — a generated answer streams in here as a floating panel
 * anchored where the card would land. Nothing touches the canvas until the user
 * clicks "Add to canvas"; "Discard" throws it away. This lets the user confirm
 * an artefact is actually useful before it clutters the board.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Box, stopEventPropagation, useEditor, useValue } from 'tldraw';
import { DocMarkdown } from '../ui/DocMarkdown';
import { setPdfPage } from '../pdf/pdfView';
import { clearPreview, getPreview, subscribePreview } from './askPreview';
import { commitPreview } from './useAsk';

export function AskPreview() {
  const editor = useEditor();
  const preview = useSyncExternalStore(subscribePreview, getPreview, getPreview);

  // Anchor next to the source(s), but always clamped fully on-screen — the
  // preview is a confirm step, so it must never render where you can't reach it.
  const anchor = useValue(
    'jarwiz ask preview anchor',
    () => {
      if (!preview) return null;
      const PW = 340;
      const PH = 360;
      const MARGIN = 16;
      const vp = editor.getViewportScreenBounds();
      const boxes = preview.sourceIds
        .map((id) => editor.getShapePageBounds(id))
        .filter((b): b is Box => Boolean(b));
      let x = vp.w / 2 - PW / 2;
      let y = vp.h / 2 - PH / 2;
      if (boxes.length) {
        const union = boxes.reduce((acc, b) => acc.union(b), boxes[0]!.clone());
        const tr = editor.pageToViewport({ x: union.maxX, y: union.minY });
        x = tr.x + 24;
        y = tr.y;
      }
      x = Math.max(MARGIN, Math.min(x, vp.w - PW - MARGIN));
      y = Math.max(MARGIN, Math.min(y, vp.h - PH - MARGIN));
      return { x, y };
    },
    [editor, preview],
  );

  if (!preview || !anchor) return null;

  const style = { left: anchor.x, top: anchor.y } as CSSProperties;
  const streaming = preview.status === 'streaming';
  const failed = preview.status === 'error';

  const onCite = (page: number) => {
    if (preview.pdfSourceId && editor.getShape(preview.pdfSourceId)) setPdfPage(preview.pdfSourceId, page);
  };

  const add = () => {
    const id = commitPreview(editor);
    if (!id) return;
    editor.select(id);
    // Stitch-style: smoothly pan + zoom to frame the new artefact (capped so a
    // small card doesn't blow up), with a little context around it.
    const b = editor.getShapePageBounds(id);
    if (b) {
      editor.zoomToBounds(b, {
        animation: { duration: 480, easing: (t) => 1 - Math.pow(1 - t, 3) },
        targetZoom: 0.9, // a touch of breathing room; neighbours peek in
      });
    }
  };

  return (
    <div className="jz-preview" style={style} onPointerDown={stopEventPropagation}>
      <div className="jz-preview-head">
        <span className="jz-preview-tag">
          {streaming ? 'Generating…' : failed ? 'Failed' : `Preview · ${preview.shape}`}
        </span>
        <button className="jz-preview-x" aria-label="Discard" onClick={() => clearPreview()}>
          ✕
        </button>
      </div>

      <div className="jz-preview-body">
        {failed ? (
          <div className="jz-preview-error">{preview.error ?? 'Something went wrong.'}</div>
        ) : preview.shape === 'table' ? (
          <PreviewTable columns={preview.columns ?? []} rows={preview.rows ?? []} />
        ) : (
          <>
            {preview.title ? <div className="jz-preview-title">{preview.title}</div> : null}
            <div className="jz-preview-doc">
              {preview.text ? <DocMarkdown content={preview.text} onCite={onCite} /> : null}
              {streaming ? <span className="jz-stream-caret" aria-hidden /> : null}
            </div>
          </>
        )}
      </div>

      <div className="jz-preview-foot">
        <button className="jz-preview-discard" onClick={() => clearPreview()}>
          Discard
        </button>
        <button className="jz-preview-add" disabled={streaming || failed} onClick={add}>
          {streaming ? 'Generating…' : 'Add to canvas'}
        </button>
      </div>
    </div>
  );
}

function PreviewTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <table className="jz-preview-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => (
              <td key={ci}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
