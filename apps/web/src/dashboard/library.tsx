/**
 * The generative-UI component library — our own monochrome vocabulary rendered
 * by OpenUI's offline reconciler (@openuidev/react-lang). Claude emits an
 * OpenUI Lang spec over these component names (the server prompt describes the
 * exact same grammar); `<Renderer library={dashboardLibrary}>` draws it live in
 * a card, 100% client-side — no Thesys, no key, no network.
 *
 * Kept deliberately generic (Stack/Card/Kpi/charts/Table) so it can grow into a
 * shared vocabulary the prototype card could also render through later.
 */

import React from 'react';
import { z } from 'zod/v4';
import { createLibrary, defineComponent, type ComponentRenderProps } from '@openuidev/react-lang';

/** Render an array of child node values (OpenUI passes raw values; renderNode
 *  turns each into a ReactNode). */
function kids(children: unknown, renderNode: (v: unknown) => React.ReactNode): React.ReactNode {
  const arr = Array.isArray(children) ? children : children == null ? [] : [children];
  return arr.map((c, i) => <React.Fragment key={i}>{renderNode(c)}</React.Fragment>);
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$€£¥,%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// ─── Layout ──────────────────────────────────────────────────────────────────
const Stack = defineComponent({
  name: 'Stack',
  description: 'A flex container. Args: children (list of components), direction ("row" | "column", default "column").',
  props: z.object({ children: z.array(z.any()).default([]), direction: z.enum(['row', 'column']).default('column') }),
  component: (({ props, renderNode }: ComponentRenderProps<{ children: unknown[]; direction: 'row' | 'column' }>) => (
    <div className="jzd-stack" data-dir={props.direction}>{kids(props.children, renderNode)}</div>
  )) as never,
});

const Grid = defineComponent({
  name: 'Grid',
  description: 'A responsive grid of cards. Args: children (list of components), columns (number, default 2).',
  props: z.object({ children: z.array(z.any()).default([]), columns: z.number().default(2) }),
  component: (({ props, renderNode }: ComponentRenderProps<{ children: unknown[]; columns: number }>) => (
    <div className="jzd-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, props.columns)}, minmax(0,1fr))` }}>
      {kids(props.children, renderNode)}
    </div>
  )) as never,
});

const Card = defineComponent({
  name: 'Card',
  description: 'A titled panel. Args: title (string), children (list of components).',
  props: z.object({ title: z.string().default(''), children: z.array(z.any()).default([]) }),
  component: (({ props, renderNode }: ComponentRenderProps<{ title: string; children: unknown[] }>) => (
    <div className="jzd-card">
      {props.title ? <div className="jzd-card-title">{props.title}</div> : null}
      {kids(props.children, renderNode)}
    </div>
  )) as never,
});

const Text = defineComponent({
  name: 'Text',
  description: 'A line of text. Args: value (string), size ("sm" | "md" | "lg", default "md").',
  props: z.object({ value: z.string().default(''), size: z.enum(['sm', 'md', 'lg']).default('md') }),
  component: (({ props }: ComponentRenderProps<{ value: string; size: string }>) => (
    <div className={`jzd-text jzd-text--${props.size}`}>{props.value}</div>
  )) as never,
});

// ─── KPI ─────────────────────────────────────────────────────────────────────
const Kpi = defineComponent({
  name: 'Kpi',
  description: 'A headline metric tile. Args: label (string), value (string), delta (string, optional, e.g. "+12%").',
  props: z.object({ label: z.string().default(''), value: z.string().default(''), delta: z.string().default('') }),
  component: (({ props }: ComponentRenderProps<{ label: string; value: string; delta: string }>) => (
    <div className="jzd-kpi">
      <div className="jzd-kpi-label">{props.label}</div>
      <div className="jzd-kpi-value">{props.value}</div>
      {props.delta ? <div className="jzd-kpi-delta">{props.delta}</div> : null}
    </div>
  )) as never,
});

// ─── Charts (inline monochrome SVG, offline) ─────────────────────────────────
function BarSvg({ labels, values }: { labels: string[]; values: number[] }) {
  const W = 520, H = 200, PAD = 28, BW = Math.max(6, (W - PAD * 2) / Math.max(1, values.length) - 10);
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="jzd-chart" preserveAspectRatio="xMidYMid meet">
      {values.map((v, i) => {
        const h = (Math.abs(v) / max) * (H - PAD * 2);
        const x = PAD + i * ((W - PAD * 2) / Math.max(1, values.length)) + 5;
        return (
          <g key={i}>
            <rect x={x} y={H - PAD - h} width={BW} height={h} rx={2} className="jzd-bar" />
            <text x={x + BW / 2} y={H - PAD + 14} textAnchor="middle" className="jzd-axis">{labels[i] ?? ''}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineSvg({ labels, values }: { labels: string[]; values: number[] }) {
  const W = 520, H = 200, PAD = 28;
  // Frame to the data's own range (not a forced zero baseline) so a trend that
  // rides a high floor — e.g. 274k → 324k — still uses the vertical space and
  // reads as movement. A little headroom keeps the peaks off the edges.
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.12 || 1;
  const min = lo - pad, max = hi + pad;
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = PAD + i * ((W - PAD * 2) / Math.max(1, values.length - 1));
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="jzd-chart" preserveAspectRatio="xMidYMid meet">
      <path d={d} className="jzd-line" fill="none" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5} className="jzd-dot" />)}
      {labels.map((l, i) => pts[i] ? <text key={i} x={pts[i]![0]} y={H - PAD + 14} textAnchor="middle" className="jzd-axis">{l}</text> : null)}
    </svg>
  );
}

const BarChart = defineComponent({
  name: 'BarChart',
  description: 'A bar chart. Args: title (string), labels (list of strings), values (list of numbers).',
  props: z.object({ title: z.string().default(''), labels: z.array(z.any()).default([]), values: z.array(z.any()).default([]) }),
  component: (({ props }: ComponentRenderProps<{ title: string; labels: unknown[]; values: unknown[] }>) => (
    <div className="jzd-chartcard">
      {props.title ? <div className="jzd-card-title">{props.title}</div> : null}
      <BarSvg labels={(props.labels ?? []).map(String)} values={(props.values ?? []).map(num)} />
    </div>
  )) as never,
});

const LineChart = defineComponent({
  name: 'LineChart',
  description: 'A line chart. Args: title (string), labels (list of strings), values (list of numbers).',
  props: z.object({ title: z.string().default(''), labels: z.array(z.any()).default([]), values: z.array(z.any()).default([]) }),
  component: (({ props }: ComponentRenderProps<{ title: string; labels: unknown[]; values: unknown[] }>) => (
    <div className="jzd-chartcard">
      {props.title ? <div className="jzd-card-title">{props.title}</div> : null}
      <LineSvg labels={(props.labels ?? []).map(String)} values={(props.values ?? []).map(num)} />
    </div>
  )) as never,
});

// ─── Table ───────────────────────────────────────────────────────────────────
const Table = defineComponent({
  name: 'Table',
  description: 'A data table. Args: columns (list of strings), rows (list of rows, each a list of cell strings).',
  props: z.object({ columns: z.array(z.any()).default([]), rows: z.array(z.any()).default([]) }),
  component: (({ props }: ComponentRenderProps<{ columns: unknown[]; rows: unknown[] }>) => (
    <div className="jzd-tablewrap">
      <table className="jzd-table">
        <thead><tr>{(props.columns ?? []).map((c, i) => <th key={i}>{String(c)}</th>)}</tr></thead>
        <tbody>
          {(props.rows ?? []).map((r, ri) => (
            <tr key={ri}>{(Array.isArray(r) ? r : [r]).map((c, ci) => <td key={ci}>{String(c ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )) as never,
});

// No `root` here: `createLibrary`'s optional `root` names a *component* used as
// a prompt hint, not the spec's entry statement. The renderer's parser already
// treats the statement id `root` (DEFAULT_ROOT_STATEMENT_ID) as the entry, so
// our specs open with `root = Stack(...)`. Passing a non-component root name
// throws at module load and takes the whole app down with it.
export const dashboardLibrary = createLibrary({
  components: [Stack, Grid, Card, Text, Kpi, BarChart, LineChart, Table],
});

/** The component names, echoed in the server prompt so Claude emits matching
 *  OpenUI Lang. Keep in sync with the components above. */
export const DASHBOARD_VOCAB = ['Stack', 'Grid', 'Card', 'Text', 'Kpi', 'BarChart', 'LineChart', 'Table'] as const;
