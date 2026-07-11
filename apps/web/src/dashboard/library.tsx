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
import { createShapeId } from 'tldraw';
import { DocMarkdown } from '../ui/DocMarkdown';
import { Extractable, type MakeCard } from './extract';
// Sizes come from the specific shape files, NOT the '../shapes' barrel — the
// barrel exports DashboardCardShapeUtil, which imports this library (cycle).
import { TABLE_CARD_SIZE } from '../shapes/TableCardShapeUtil';
import { DOC_CARD_SIZE } from '../shapes/DocCardShapeUtil';

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
// A chart's natural width comes from its DATA (a fixed slot per bar/point),
// and the inline max-width caps rendering at that natural size — so CSS's
// width:100% can shrink a dense chart to fit the card but never stretch a
// sparse one into slabs (owner call, 2026-07-10: two bars must not fill the
// card). No per-chart knobs; density is the control.
const CHART_H = 190;
const CHART_PAD = 28;

function BarSvg({ labels, values }: { labels: string[]; values: number[] }) {
  const n = Math.max(1, values.length);
  const SLOT = 84, BW = 48;
  const W = CHART_PAD * 2 + n * SLOT, H = CHART_H, PAD = CHART_PAD;
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="jzd-chart" style={{ maxWidth: W }} preserveAspectRatio="xMidYMid meet">
      {values.map((v, i) => {
        const h = (Math.abs(v) / max) * (H - PAD * 2);
        const x = PAD + i * SLOT + (SLOT - BW) / 2;
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
  const n = Math.max(2, values.length);
  const W = CHART_PAD * 2 + (n - 1) * 72, H = CHART_H, PAD = CHART_PAD;
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
    <svg viewBox={`0 0 ${W} ${H}`} className="jzd-chart" style={{ maxWidth: W }} preserveAspectRatio="xMidYMid meet">
      <path d={d} className="jzd-line" fill="none" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5} className="jzd-dot" />)}
      {labels.map((l, i) => pts[i] ? <text key={i} x={pts[i]![0]} y={H - PAD + 14} textAnchor="middle" className="jzd-axis">{l}</text> : null)}
    </svg>
  );
}

/** Drag a chart out as a small self-contained chart card — a dashboard-card
 *  whose spec is just this one statement, rebuilt from the rendered props. */
function chartMakeCard(kind: 'BarChart' | 'LineChart', title: string, labels: string[], values: number[]): MakeCard {
  return (editor, at) => {
    if (values.length === 0) return null;
    const spec = `root = ${kind}(${JSON.stringify(title)}, ${JSON.stringify(labels)}, ${JSON.stringify(values)})`;
    const w = Math.min(820, Math.max(380, CHART_PAD * 2 + labels.length * 84 + 64));
    const h = 300;
    const id = createShapeId();
    editor.createShape({
      id, type: 'dashboard-card', x: at.x - w / 2, y: at.y - 24,
      props: { w, h, spec, title: title || 'Chart', status: 'done' },
    });
    return id;
  };
}

const BarChart = defineComponent({
  name: 'BarChart',
  description: 'A bar chart. Args: title (string), labels (list of strings), values (list of numbers).',
  props: z.object({ title: z.string().default(''), labels: z.array(z.any()).default([]), values: z.array(z.any()).default([]) }),
  component: (({ props }: ComponentRenderProps<{ title: string; labels: unknown[]; values: unknown[] }>) => {
    const labels = (props.labels ?? []).map(String);
    const values = (props.values ?? []).map(num);
    return (
      <Extractable label="Chart" makeCard={chartMakeCard('BarChart', props.title ?? '', labels, values)}>
        <div className="jzd-chartcard">
          {props.title ? <div className="jzd-card-title">{props.title}</div> : null}
          <BarSvg labels={labels} values={values} />
        </div>
      </Extractable>
    );
  }) as never,
});

const LineChart = defineComponent({
  name: 'LineChart',
  description: 'A line chart. Args: title (string), labels (list of strings), values (list of numbers).',
  props: z.object({ title: z.string().default(''), labels: z.array(z.any()).default([]), values: z.array(z.any()).default([]) }),
  component: (({ props }: ComponentRenderProps<{ title: string; labels: unknown[]; values: unknown[] }>) => {
    const labels = (props.labels ?? []).map(String);
    const values = (props.values ?? []).map(num);
    return (
      <Extractable label="Chart" makeCard={chartMakeCard('LineChart', props.title ?? '', labels, values)}>
        <div className="jzd-chartcard">
          {props.title ? <div className="jzd-card-title">{props.title}</div> : null}
          <LineSvg labels={labels} values={values} />
        </div>
      </Extractable>
    );
  }) as never,
});

// ─── Rich content (research answers) ─────────────────────────────────────────

/** Route a remote image through the server's SSRF-guarded cache-proxy so
 *  hotlink protection / CORS / dead URLs can't leave a broken frame. Local
 *  (`/api/assets`) and data: URLs pass through untouched. */
function proxied(src: string): string {
  return /^https?:\/\//i.test(src) ? `/api/image?src=${encodeURIComponent(src)}` : src;
}

/** Same routing for `![alt](https://…)` images inside a Markdown block. */
function proxyMarkdownImages(text: string): string {
  return text.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, alt: string, url: string) => `![${alt}](${proxied(url)})`,
  );
}

function MarkdownBody({ props }: ComponentRenderProps<{ text: string }>) {
  const text = props.text ?? '';
  // Drag out as a text card. The RAW markdown travels (not the proxied form) —
  // the doc card routes remote images through the cache-proxy at render time.
  const makeCard: MakeCard = (editor, at) => {
    if (!text.trim()) return null;
    const id = createShapeId();
    editor.createShape({
      id, type: 'doc-card', x: at.x - DOC_CARD_SIZE.w / 2, y: at.y - 24,
      props: { ...DOC_CARD_SIZE, title: '', text, sourcePdfId: '' },
    });
    return id;
  };
  return (
    <Extractable label="Text" makeCard={makeCard}>
      <div className="jzd-md">
        <DocMarkdown content={proxyMarkdownImages(text)} />
      </div>
    </Extractable>
  );
}

const Markdown = defineComponent({
  name: 'Markdown',
  description:
    'A rich text block. Args: text (string of markdown — headings, **bold**, links, "- " bullets, images; escape newlines as \\n).',
  props: z.object({ text: z.string().default('') }),
  component: MarkdownBody as never,
});

function ImageBody({ props }: ComponentRenderProps<{ src: string; caption: string }>) {
  // A dead URL hides the whole figure rather than showing a broken frame —
  // rich cards degrade to "no image", never to visible breakage.
  const [failed, setFailed] = React.useState(false);
  if (!props.src || failed) return null;
  // Drag out as an image card; the proxied URL travels so the extracted card
  // loads from the same same-origin cache the rich card does.
  const makeCard: MakeCard = (editor, at) => {
    const id = createShapeId();
    editor.createShape({
      id, type: 'image-card', x: at.x - 180, y: at.y - 24,
      props: { w: 360, h: 300, src: proxied(props.src), name: props.caption || 'Image' },
    });
    return id;
  };
  return (
    <Extractable label="Image" makeCard={makeCard}>
      <figure className="jzd-figure">
        <img className="jzd-img" src={proxied(props.src)} alt={props.caption || ''} onError={() => setFailed(true)} />
        {props.caption ? <figcaption className="jzd-img-caption">{props.caption}</figcaption> : null}
      </figure>
    </Extractable>
  );
}

const Image = defineComponent({
  name: 'Image',
  description: 'An image. Args: src (string — a real image URL), caption (string, "" for none).',
  props: z.object({ src: z.string().default(''), caption: z.string().default('') }),
  component: ImageBody as never,
});

function TabsBody({
  props,
  renderNode,
}: ComponentRenderProps<{ labels: unknown[]; panels: unknown[] }>) {
  const labels = (props.labels ?? []).map(String);
  const panels = props.panels ?? [];
  const count = Math.max(labels.length, panels.length);
  const [active, setActive] = React.useState(0);
  if (count === 0) return null;
  const idx = Math.min(active, count - 1);
  return (
    <div className="jzd-tabs">
      <div className="jzd-tabbar" role="tablist">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === idx}
            className={`jzd-tab${i === idx ? ' jzd-tab--active' : ''}`}
            onClick={() => setActive(i)}
          >
            {labels[i] ?? `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div className="jzd-tabpanel" role="tabpanel">
        {panels[idx] != null ? renderNode(panels[idx]) : null}
      </div>
    </div>
  );
}

const Tabs = defineComponent({
  name: 'Tabs',
  description:
    'Tabbed sections. Args: labels (list of strings), panels (list of components, one per label).',
  props: z.object({ labels: z.array(z.any()).default([]), panels: z.array(z.any()).default([]) }),
  component: TabsBody as never,
});

// ─── Table ───────────────────────────────────────────────────────────────────
const Table = defineComponent({
  name: 'Table',
  description: 'A data table. Args: columns (list of strings), rows (list of rows, each a list of cell strings).',
  props: z.object({ columns: z.array(z.any()).default([]), rows: z.array(z.any()).default([]) }),
  component: (({ props }: ComponentRenderProps<{ columns: unknown[]; rows: unknown[] }>) => {
    const columns = (props.columns ?? []).map(String);
    const rows = (props.rows ?? []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r ?? '')]));
    // Drag out as a REAL editable table card — same column-count sizing the
    // Ask pipeline uses for generated comparisons.
    const makeCard: MakeCard = (editor, at) => {
      if (columns.length === 0) return null;
      const w = Math.min(940, Math.max(TABLE_CARD_SIZE.w, columns.length * 190));
      const id = createShapeId();
      editor.createShape({
        id, type: 'table-card', x: at.x - w / 2, y: at.y - 24,
        props: { w, h: TABLE_CARD_SIZE.h, columns, rows },
      });
      return id;
    };
    return (
      <Extractable label="Table" makeCard={makeCard}>
        <div className="jzd-tablewrap">
          <table className="jzd-table">
            <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Extractable>
    );
  }) as never,
});

// No `root` here: `createLibrary`'s optional `root` names a *component* used as
// a prompt hint, not the spec's entry statement. The renderer's parser already
// treats the statement id `root` (DEFAULT_ROOT_STATEMENT_ID) as the entry, so
// our specs open with `root = Stack(...)`. Passing a non-component root name
// throws at module load and takes the whole app down with it.
export const dashboardLibrary = createLibrary({
  components: [Stack, Grid, Card, Text, Kpi, BarChart, LineChart, Table, Markdown, Image, Tabs],
});

/** The component names, echoed in the server prompt so Claude emits matching
 *  OpenUI Lang. Keep in sync with the components above. */
export const DASHBOARD_VOCAB = ['Stack', 'Grid', 'Card', 'Text', 'Kpi', 'BarChart', 'LineChart', 'Table', 'Markdown', 'Image', 'Tabs'] as const;
