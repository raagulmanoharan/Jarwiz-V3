/**
 * The Jarwiz deck theme — the single, brand-native look the slideshow ships in.
 *
 * The model authors only slide *content* (a run of `<section class="slide">`
 * blocks built from a fixed toolkit: .display / .kicker / .split / .stats /
 * .cmp / .chart / .quote …). This module owns the presentation: the warm-paper,
 * mono-utility ↔ heavy-display editorial identity, the 16:9 page, the print
 * rules, and container-query sizing (so a slide reads identically scaled-down
 * in a preview and at full 1280×720 in the printed PDF).
 *
 * Layout consistency is deliberate: every content slide anchors its header
 * (kicker → title) to the SAME top baseline and carries the "Made with Jarwiz"
 * mark at the SAME bottom-right spot, so titles and footer line up slide to
 * slide. The cover is the one intentional exception (its title sinks low).
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const THEME_CSS = `
  :root {
    --font-sans: ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    --font-mono: ui-monospace,'SFMono-Regular',Menlo,monospace;
    --ground:#faf9f7; --panel:#f1efea; --ink:#17150f; --muted:#6b675d;
    --hair:rgba(23,21,15,.12); --solid:#17150f; --backdrop:#e7e5df;
    --font-display:var(--font-sans); --font-body:var(--font-sans);
    --display-weight:820; --display-tracking:-.03em; --rule-h:2px; --radius:8px;
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
    display:flex; flex-direction:column;
    /* Consistent frame: header anchored to a fixed top baseline; the footer band
       is reserved at the bottom so content never collides with the brand mark. */
    justify-content:flex-start;
    padding:12cqh 9.5cqw 11cqh;
  }
  /* The cover is the one deliberate exception — its title sinks to the lower-left. */
  .slide--cover { justify-content:flex-end; padding-bottom:14cqh; }
  .slide--panel, .slide--section { background:var(--panel); }
  .grid { width:100%; }
  .grid > * + * { margin-top:3cqh; }
  .col > * + * { margin-top:2.6cqh; }
  .kicker + * { margin-top:1.8cqh; }
  /* One fixed footer position on every slide. */
  .slide::after {
    content:"Made with Jarwiz"; position:absolute; right:9.5cqw; bottom:5.5cqh;
    font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.2em;
    font-size:1.25cqh; color:var(--muted); opacity:.9;
  }
  .kicker { font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.22em; font-size:1.65cqh; color:var(--muted); }
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

/** Wrap the model's slide sections in a full, self-contained, brand-native deck
 *  document — what gets printed / downloaded. */
export function buildDeck(sections: string, title: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Jarwiz</title><style>${THEME_CSS}</style></head><body><div class="deck">${sections}</div></body></html>`;
}
