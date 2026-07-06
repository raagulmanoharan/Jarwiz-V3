/**
 * "Turn this into an interactive dashboard." A spreadsheet or table is data, not
 * prose — so instead of a written answer we hand its rows to the generative-UI
 * engine (the Prototype card) with a dashboard brief. The result is ONE
 * self-contained, interactive HTML dashboard — KPI tiles, charts, a working
 * filter — rendered live in the prototype card's sandboxed iframe, with a
 * provenance line back to the source data.
 *
 * Reuses the prototype pipeline wholesale: we just create a prototype card whose
 * `prompt` embeds the data + the dashboard brief, then fire its run.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type TLShapeId } from 'tldraw';
import { PROTOTYPE_CARD_SIZE } from '../shapes';
import { gridToCsv } from '../lib/dashboardable';
import { PROV_META_KEY } from '../ask/useAsk';
import { requestPrototypeRun } from './prototypeRun';

/** Dashboards want room to breathe — bigger than the default prototype card. */
const DASHBOARD_SIZE = { w: 780, h: 560 };

/** The dashboard brief prepended to the data — instructs the generative-UI
 *  engine to chart the ACTUAL rows and make it interactive. */
function dashboardPrompt(subject: string, csv: string): string {
  const named = subject.trim() ? ` for "${subject.trim()}"` : '';
  return [
    `Build an INTERACTIVE DATA DASHBOARD${named} from the dataset below.`,
    '',
    'Layout — a fixed dashboard scaffold, top to bottom: HEADER (title) → KPI ROW → CHART/TABLE GRID. Fill the slots; don\'t invent unrelated chrome.',
    '',
    'Requirements:',
    '- 3–5 KPI tiles for the headline figures (totals, averages, min/max) computed from the data — each with a label, a big value, and where possible a ± vs. another row/period.',
    '- 2–3 charts that reveal the real trends in THIS data (bar / line / pie as fits). Draw them with inline SVG or <canvas> sized to their container — never an external chart library or image. Use a restrained monochrome palette (greys and white on a dark surface).',
    '- At least one control that genuinely works via inline JS: a category filter (dropdown or segmented buttons) or a metric toggle that recomputes the KPIs and redraws the charts.',
    '- A compact, scrollable data table beneath the charts.',
    '- Derive every number from the provided data — never invent values. Treat non-numeric columns as categories/axes and numeric columns as measures. If the data is thin, show fewer, honest visuals rather than padding.',
    '- Clean, modern, dark, responsive; fill the whole card.',
    '',
    'DATA (CSV):',
    csv,
  ].join('\n');
}

export function useDashboard() {
  const editor = useEditor();
  const [isBuilding, setIsBuilding] = useState(false);
  const busy = useRef(false);

  const buildDashboard = useCallback(
    async (sourceId: TLShapeId, subject: string, getRows: () => string[][] | Promise<string[][]>) => {
      if (busy.current) return;
      busy.current = true;
      setIsBuilding(true);
      try {
        const rows = await getRows();
        if (!rows || rows.length === 0) return;
        const csv = gridToCsv(rows);

        // Land it to the right of the source, clear of it.
        const b = editor.getShapePageBounds(sourceId);
        const x = b ? b.maxX + 80 : editor.getViewportPageBounds().center.x;
        const y = b ? b.minY : editor.getViewportPageBounds().center.y;

        const id = createShapeId();
        editor.markHistoryStoppingPoint('build-dashboard');
        editor.createShape({
          id,
          type: 'prototype-card',
          x,
          y,
          props: {
            ...DASHBOARD_SIZE,
            html: '',
            title: 'Dashboard',
            prompt: dashboardPrompt(subject, csv),
            status: 'running',
          },
          // Provenance: the dashboard was built FROM the source data.
          meta: { [PROV_META_KEY]: [sourceId] },
        });
        editor.select(id);
        const nb = editor.getShapePageBounds(id);
        if (nb) editor.zoomToBounds(nb, { inset: 90, targetZoom: 1, animation: { duration: 300 } });
        // Fire the prototype engine — it streams the dashboard HTML into the card.
        requestPrototypeRun(id);
      } finally {
        busy.current = false;
        setIsBuilding(false);
      }
    },
    [editor],
  );

  return { buildDashboard, isBuilding };
}
