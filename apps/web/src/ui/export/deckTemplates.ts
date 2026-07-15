/**
 * Deck templates — the "pick a look" library for the slideshow export.
 *
 * The model authors only slide *content* (a run of `<section class="slide">`
 * blocks built from a fixed toolkit: .display / .kicker / .split / .stats /
 * .cmp / .chart / .quote …). Because that contract is stable, the SAME slides
 * can be dressed in any number of visual themes — so switching template is
 * instant and never touches the content.
 *
 * `BASE_CSS` owns the structure (the 16:9 page, the grid, the toolkit classes,
 * the print rules, container-query sizing) and reads everything themeable from
 * CSS variables. Each template supplies only those variables (and the odd
 * personality override). Every template MUST define the full token set —
 * --ground/--panel/--ink/--muted/--hair/--solid + the type vars — so a model's
 * inline-SVG chart (drawn with var(--solid)/var(--ink)/var(--hair)) renders
 * correctly in every one.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Structure + toolkit, all themeable values as vars. Defaults = the Editorial
 * template, so that theme needs no overrides. */
const BASE_CSS = `
  :root {
    --font-sans: ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    --font-mono: ui-monospace,'SFMono-Regular',Menlo,monospace;
    --font-serif: 'Iowan Old Style','Palatino Linotype','Book Antiqua',Georgia,'Times New Roman',serif;
    --ground:#faf9f7; --panel:#f1efea; --ink:#17150f; --muted:#6b675d;
    --hair:rgba(23,21,15,.12); --solid:#17150f; --backdrop:#e7e5df;
    --font-display:var(--font-sans); --font-body:var(--font-sans);
    --display-weight:820; --display-tracking:-.03em; --rule-h:2px; --radius:8px;
    --kicker-spacing:.22em;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--backdrop); font-family:var(--font-body); color:var(--ink); -webkit-font-smoothing:antialiased; }
  .deck { display:flex; flex-direction:column; align-items:center; gap:26px; padding:26px; }
  .slide {
    container-type:size; position:relative;
    width:min(100%,1280px); aspect-ratio:16/9;
    background:var(--ground); color:var(--ink); overflow:hidden;
    border:1px solid var(--hair); border-radius:var(--radius);
    box-shadow:0 10px 34px rgba(0,0,0,.10);
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
    display:flex; flex-direction:column; justify-content:center;
    padding:13cqh 9.5cqw 13cqh;
  }
  .slide--cover { justify-content:flex-end; padding-bottom:15cqh; }
  .slide--panel, .slide--section { background:var(--panel); }
  .grid { width:100%; }
  .grid > * + * { margin-top:3cqh; }
  .col > * + * { margin-top:2.6cqh; }
  .kicker + * { margin-top:1.8cqh; }
  .slide::after {
    content:"Made with Jarwiz"; position:absolute; right:9.5cqw; bottom:5.5cqh;
    font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.2em;
    font-size:1.25cqh; color:var(--muted); opacity:.9;
  }
  .kicker { font-family:var(--font-mono); text-transform:uppercase; letter-spacing:var(--kicker-spacing); font-size:1.65cqh; color:var(--muted); }
  .display { font-family:var(--font-display); font-weight:var(--display-weight); letter-spacing:var(--display-tracking); line-height:1.0; text-wrap:balance; color:var(--ink); }
  h1.display { font-size:13cqh; }
  h2.display { font-size:6.6cqh; }
  .rule { width:8cqw; height:var(--rule-h); background:var(--solid); }
  .lede { font-size:3.1cqh; line-height:1.42; color:var(--muted); max-width:40ch; }
  .body { font-size:2.5cqh; line-height:1.55; color:var(--ink); max-width:52ch; }
  .body p { margin-bottom:2cqh; } .body p:last-child { margin-bottom:0; }
  .muted { color:var(--muted); }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:7cqw; align-items:start; }
  .steps { list-style:none; counter-reset:s; max-width:60ch; }
  .steps li { counter-increment:s; position:relative; padding:2.8cqh 0 2.8cqh 6.5ch; border-top:1px solid var(--hair); font-size:2.5cqh; line-height:1.4; }
  .steps li:last-child { border-bottom:1px solid var(--hair); }
  .steps li::before { content:counter(s,decimal-leading-zero); position:absolute; left:0; top:2.8cqh; font-family:var(--font-mono); font-size:1.65cqh; letter-spacing:.12em; color:var(--muted); }
  .stats { display:flex; flex-wrap:wrap; row-gap:5cqh; }
  .stat { padding:0 3.4cqw; } .stat:first-child { padding-left:0; } .stat + .stat { border-left:1px solid var(--hair); }
  .stat b { display:block; font-family:var(--font-display); font-weight:var(--display-weight); letter-spacing:-.035em; font-size:12cqh; font-variant-numeric:tabular-nums; line-height:.95; }
  .stat span { display:block; margin-top:2cqh; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.16em; font-size:1.55cqh; color:var(--muted); max-width:22ch; }
  .cmp { border-collapse:collapse; width:100%; font-size:2.45cqh; }
  .cmp th { text-align:left; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.14em; font-size:1.5cqh; font-weight:500; color:var(--muted); padding:0 2.6ch 2.6cqh 0; border-bottom:1px solid var(--hair); }
  .cmp td { text-align:left; padding:2.6cqh 2.6ch; border-bottom:1px solid var(--hair); font-variant-numeric:tabular-nums; color:var(--ink); }
  .cmp td:first-child, .cmp th:first-child { padding-left:0; }
  .cmp .hot { font-weight:750; color:var(--solid); }
  .chart { width:100%; } .chart svg { width:100%; max-width:100%; height:auto; overflow:visible; }
  .caption { font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.14em; font-size:1.55cqh; color:var(--muted); }
  .quote { font-family:var(--font-display); font-size:5.4cqh; font-weight:calc(var(--display-weight) - 60); letter-spacing:-.025em; line-height:1.14; text-wrap:balance; max-width:19ch; }
  .cite { font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.16em; font-size:1.65cqh; color:var(--muted); }
  @media print {
    @page { size:1280px 720px; margin:0; }
    body { background:#fff; }
    .deck { gap:0; padding:0; }
    .slide { width:1280px; height:720px; aspect-ratio:auto; border:none; border-radius:0; box-shadow:none; break-after:page; page-break-after:always; }
    .slide:last-child { break-after:auto; page-break-after:auto; }
  }
`;

export interface DeckTemplate {
  id: string;
  name: string;
  /** :root overrides (+ the odd personality rule). Empty = the base default. */
  css: string;
}

/**
 * The seeded library. Each is a deliberate visual identity — a distinct
 * palette + type personality — over the same structure. Kept to a tasteful,
 * non-generic set (warm editorial, bold dark, swiss minimal, cobalt accent,
 * serif classic).
 */
export const DECK_TEMPLATES: DeckTemplate[] = [
  {
    id: 'editorial',
    name: 'Editorial',
    css: '', // base defaults
  },
  {
    id: 'noir',
    name: 'Noir',
    css: `:root{
      --ground:#0c0c0e; --panel:#17171b; --ink:#f4f2ec; --muted:#9a978f;
      --hair:rgba(244,242,236,.14); --solid:#f4f2ec; --backdrop:#050506;
      --display-weight:840; --display-tracking:-.035em;
    }
    .slide{ box-shadow:0 12px 40px rgba(0,0,0,.5); }`,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    css: `:root{
      --ground:#ffffff; --panel:#f4f4f5; --ink:#161616; --muted:#9b9b9b;
      --hair:rgba(0,0,0,.09); --solid:#161616; --backdrop:#eaeaeb;
      --display-weight:660; --display-tracking:-.02em; --rule-h:1px; --radius:3px;
      --kicker-spacing:.28em;
    }
    .slide{ padding:14cqh 11cqw 14cqh; box-shadow:0 6px 22px rgba(0,0,0,.07); }`,
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    css: `:root{
      --ground:#f6f7fb; --panel:#e9ecf7; --ink:#111528; --muted:#5a6078;
      --hair:rgba(17,21,40,.12); --solid:#2f43d6; --backdrop:#e3e6f0;
      --display-weight:800; --display-tracking:-.03em; --rule-h:3px; --radius:12px;
    }
    .stat b{ color:var(--solid); }`,
  },
  {
    id: 'serif',
    name: 'Serif',
    css: `:root{
      --ground:#f7f4ee; --panel:#efe9dd; --ink:#211c15; --muted:#6b6255;
      --hair:rgba(33,28,21,.15); --solid:#211c15; --backdrop:#e8e1d4;
      --font-display:var(--font-serif); --display-weight:600; --display-tracking:-.005em; --radius:6px;
    }`,
  },
];

export function getTemplate(id: string): DeckTemplate {
  return DECK_TEMPLATES.find((t) => t.id === id) ?? DECK_TEMPLATES[0]!;
}

const HEAD = (title: string, css: string) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Jarwiz</title><style>${css}</style></head>`;

/** Wrap the model's slide sections in a full, self-contained deck document,
 *  styled by the chosen template. This is what gets printed / downloaded. */
export function buildDeck(sections: string, title: string, templateId: string): string {
  const t = getTemplate(templateId);
  return `${HEAD(title, BASE_CSS + t.css)}<body><div class="deck">${sections}</div></body></html>`;
}

/** A single-slide, full-bleed render of the FIRST section — the live thumbnail
 *  used in the template picker. No deck padding, no card chrome, no footer. */
export function buildThumb(sections: string, title: string, templateId: string): string {
  const first = /<section\b[\s\S]*?<\/section>/i.exec(sections)?.[0] ?? sections;
  const thumbCss =
    BASE_CSS +
    getTemplate(templateId).css +
    `.deck{padding:0;gap:0}.slide{width:100%;height:100vh;aspect-ratio:auto;border:none;border-radius:0;box-shadow:none;padding:11cqh 9cqw}.slide::after{display:none}`;
  return `${HEAD(title, thumbCss)}<body><div class="deck">${first}</div></body></html>`;
}
