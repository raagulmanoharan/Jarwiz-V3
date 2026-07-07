/**
 * "Turn this into an interactive dashboard." A spreadsheet or table is data, not
 * prose — so instead of a written answer we hand its rows to the generative-UI
 * engine with a dashboard brief. The model emits an OpenUI Lang spec; the
 * dashboard card's offline renderer draws it live through our monochrome
 * component library (KPIs, charts, a table) — 100% client-side, no external
 * service — with a provenance line back to the source data.
 */

import { useCallback, useRef, useState } from 'react';
import { createShapeId, useEditor, type TLShapeId } from 'tldraw';
import { DASHBOARD_CARD_SIZE } from '../shapes';
import { gridToCsv } from '../lib/dashboardable';
import { PROV_META_KEY } from '../ask/useAsk';
import { requestDashboardRun } from './dashboardRun';

/** The dashboard brief prepended to the data — instructs the model to chart the
 *  ACTUAL rows. The full OpenUI Lang grammar lives in the server prompt; here we
 *  just frame the subject and hand over the data. */
function dashboardPrompt(subject: string, csv: string): string {
  const named = subject.trim() ? ` for "${subject.trim()}"` : '';
  return [
    `Build an interactive data dashboard${named} from the dataset below.`,
    'Derive every KPI and chart value from the actual rows — never invent numbers.',
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
          type: 'dashboard-card',
          x,
          y,
          props: {
            ...DASHBOARD_CARD_SIZE,
            spec: '',
            title: subject.trim() ? `${subject.trim()} dashboard` : 'Dashboard',
            status: 'running',
          },
          // Provenance: the dashboard was built FROM the source data.
          meta: { [PROV_META_KEY]: [sourceId] },
        });
        editor.select(id);
        const nb = editor.getShapePageBounds(id);
        if (nb) editor.zoomToBounds(nb, { inset: 90, targetZoom: 1, animation: { duration: 300 } });
        // Fire the dashboard engine — it streams the OpenUI Lang spec into the card.
        requestDashboardRun(id, dashboardPrompt(subject, csv));
      } finally {
        busy.current = false;
        setIsBuilding(false);
      }
    },
    [editor],
  );

  return { buildDashboard, isBuilding };
}
