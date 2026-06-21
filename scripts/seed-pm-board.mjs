/**
 * Seed a realistic, dense PM board — a seasoned PM's multi-hour discovery +
 * planning session for a B2B SaaS onboarding revamp. Rich docs (not 2-liners),
 * an affinity cluster, a competitive table, a proposed-flow flowchart, AI
 * synthesis cards, section labels, and provenance connectors. Then screenshot.
 *
 *   node scripts/seed-pm-board.mjs
 */

import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/playwright/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '/tmp';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
await page.route('**/*', (r) =>
  /cdn\.tldraw\.com|fonts\.googleapis|fonts\.gstatic/.test(r.request().url()) ? r.abort() : r.continue());
await page.addInitScript(() => {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('jz-') || k.startsWith('jarwiz') || k.includes('tldraw')) localStorage.removeItem(k); } catch {}
});
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.editor), { timeout: 20000 });
await sleep(1400);
const skip = page.locator('.jz-boardentry-skip');
if (await skip.count()) { await skip.click(); await sleep(300); }

await page.evaluate(() => {
  const E = window.editor;
  const mk = () => 'shape:' + Math.random().toString(36).slice(2);
  const rich = (t) => ({ type: 'doc', content: t.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) });
  const ids = [];
  const doc = (x, y, w, h, title, text) => { const id = mk(); ids.push(id); E.createShape({ id, type: 'doc-card', x, y, props: { w, h, title, text, sourcePdfId: '' } }); return id; };
  const note = (x, y, text, color, w = 230, h = 150) => { const id = mk(); ids.push(id); E.createShape({ id, type: 'note-card', x, y, props: { w, h, text, color } }); return id; };
  const table = (x, y, w, h, columns, rows) => { const id = mk(); ids.push(id); E.createShape({ id, type: 'table-card', x, y, props: { w, h, columns, rows } }); return id; };
  const label = (x, y, text, size = 'l', w = 340) => { const id = mk(); ids.push(id); E.createShape({ id, type: 'text', x, y, props: { richText: rich(text), size, color: 'black', w, autoSize: false, scale: 1 } }); return id; };
  const geo = (x, y, w, h, text, shape, color) => { const id = mk(); ids.push(id); E.createShape({ id, type: 'geo', x, y, props: { geo: shape, w, h, color, fill: 'solid', size: 's', richText: rich(text) } }); return id; };
  const link = (from, to, lbl, color = 'grey') => {
    const a = mk();
    E.createShape({ id: a, type: 'arrow', props: { color, size: 's', dash: 'solid', arrowheadEnd: 'triangle', ...(lbl ? { richText: rich(lbl) } : {}) } });
    E.createBindings([
      { id: 'binding:' + Math.random().toString(36).slice(2), type: 'arrow', fromId: a, toId: from, props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
      { id: 'binding:' + Math.random().toString(36).slice(2), type: 'arrow', fromId: a, toId: to, props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } },
    ]);
  };

  // ── Title ───────────────────────────────────────────────────────────────
  label(-1600, -1180, 'Onboarding Revamp — Discovery & Planning', 'xl', 1200);
  label(-1600, -1110, 'B2B SaaS · activation working group · live Jarwiz session', 'm', 1200);

  // ── LANE 1 · RESEARCH ─────────────────────────────────────────────────────
  label(-1600, -980, '1 · Research & evidence', 'l', 600);

  const research = doc(-1600, -900, 620, 560, 'User research synthesis',
`## What we did

12 onboarding interviews (7 admins, 5 end-users), session replays for the last 300 signups, and a read of 90 days of support tickets tagged \`onboarding\`.

## The headline

**Activation isn't a motivation problem — it's a "first useful outcome" problem.** Teams that reach their first shared workspace in week one retain at 3.4× the rate of those who don't. Most never get there.

## Where it breaks

- **The empty workspace.** New admins land on a blank board with no sense of the first move. 41% bounce before inviting anyone.
- **Invite friction.** Getting a teammate in requires leaving the product, copying a link, and waiting. The "aha" needs two people, but the flow is built for one.
- **Setup theatre.** We ask for company size, role, and use-case up front; none of it changes the first-run experience, so it reads as a tax.

## What good looks like

A new admin should produce one real, shareable artifact and pull in one teammate inside the first session — before any configuration.`);

  // Affinity cluster — pain points grouped into 3 named themes.
  label(-900, -980, 'Pain points (clustered live)', 'm', 420);
  const clusters = [
    { name: 'Empty-state paralysis', color: '#fef0c7', notes: [
      'New admins stare at a blank board and close the tab — no obvious first move',
      'No template or example to react to; cold-start is intimidating',
      '"I did not know what I was supposed to make first" — Admin, 40-person co.' ] },
    { name: 'Invite & collaboration friction', color: '#dde7fb', notes: [
      'The magic needs a second person but invites force you to leave the product',
      'Seats/permissions decision blocks the invite — admins stall on it',
      'No way to show a teammate what you made without a full account' ] },
    { name: 'Setup tax', color: '#dcefe1', notes: [
      'Up-front role/size/use-case questions change nothing in first run',
      'SSO config surfaced too early — only ~15% need it on day one',
      'Notification defaults are noisy; new users mute everything and miss value' ] },
  ];
  clusters.forEach((c, ci) => {
    const x = -900 + ci * 250;
    label(x, -900, c.name, 's', 230);
    c.notes.forEach((n, ni) => note(x, -850 + ni * 165, n, c.color));
  });

  const quotes = doc(-900, -360, 760, 300, 'Interview highlights',
`> "The product clicked the second a colleague commented on my board. Before that I assumed it was just-for-me." — **PM, 120-person company**

> "I bounced the first time. Came back a month later because a teammate sent me a link — that link did more than the whole signup flow." — **Ops lead**

> "I spent ten minutes answering setup questions and the app looked exactly the same after. Felt like paperwork." — **Founder, 8-person startup**`);

  // ── LANE 2 · PROBLEM & BETS ───────────────────────────────────────────────
  label(-60, -980, '2 · Problem & bets', 'l', 600);

  const problem = doc(-60, -900, 600, 360, 'Problem statement',
`## The problem

New teams don't reach a **first shared outcome** fast enough, so the collaborative value of the product never lands and they churn before week two.

## Why it matters now

Activation (workspace shared + 2nd member active in 7 days) sits at **23%**. Self-serve revenue is flat quarter-over-quarter and CAC payback has slipped to 14 months. Activation is the single biggest lever on both.

## Scope

First-run for **self-serve B2B signups**. Out of scope: sales-led onboarding, mobile, and migration from competitors (own tracks).`);

  const bets = doc(-60, -510, 600, 470, 'Our bets',
`## Bets (each is a testable hypothesis)

**Bet 1 — Start from a real artifact, not a blank canvas.**
Seed the first workspace from a template chosen by inferred use-case. *If* admins begin from a structured starting point, *then* time-to-first-artifact drops below 3 minutes.

**Bet 2 — Make sharing the first action, not the last.**
Replace the invite wall with a one-tap "share a view" link that needs no account to open. *If* the second person can engage in one tap, *then* 2nd-member activation roughly doubles.

**Bet 3 — Defer all setup until value is felt.**
Move SSO, roles, and notification config behind first value. *If* we cut setup to zero up-front fields, *then* first-run completion rises and support load falls.

Confidence: Bet 2 highest (strong qual + quant signal); Bet 1 medium; Bet 3 low-risk, do regardless.`);

  const competitive = table(-60, 0, 600, 230,
    ['Competitor', 'First-run approach', 'Strength', 'Our wedge'],
    [
      ['Notion', 'Template gallery, solo-first', 'Breadth of starting points', 'Collaboration in first session'],
      ['Figma', 'Empty file, invite-driven', 'Multiplayer is the default', 'Guided first artifact'],
      ['Linear', 'Opinionated setup wizard', 'Fast for the ICP', 'Less rigid, broader teams'],
      ['Miro', 'Template + workshop flow', 'Facilitation features', 'AI does the synthesis'],
    ]);

  // ── LANE 3 · PROPOSED FLOW ────────────────────────────────────────────────
  label(600, -980, '3 · Proposed first-run flow', 'l', 600);

  const nStart = geo(700, -880, 200, 90, 'Signup', 'ellipse', 'green');
  const nTemplate = geo(700, -740, 200, 90, 'Pick a starting template', 'rectangle', 'blue');
  const nArtifact = geo(700, -600, 200, 90, 'Co-create first artifact', 'rectangle', 'blue');
  const nShare = geo(700, -460, 200, 90, 'Share a view (1 tap)', 'rectangle', 'blue');
  const nSecond = geo(640, -320, 320, 100, '2nd member engaged?', 'diamond', 'orange');
  const nActivated = geo(560, -150, 200, 90, 'Activated', 'ellipse', 'green');
  const nNudge = geo(860, -150, 220, 90, 'Nudge + assist', 'rectangle', 'blue');
  link(nStart, nTemplate);
  link(nTemplate, nArtifact);
  link(nArtifact, nShare);
  link(nShare, nSecond);
  link(nSecond, nActivated, 'yes', 'green');
  link(nSecond, nNudge, 'no', 'red');
  link(nNudge, nShare, 'retry');

  const brief = doc(600, 10, 560, 360, 'Feature brief — guided first run',
`## Why

Activation is gated on a first shared outcome; today's blank-canvas, invite-last flow actively prevents it (see research synthesis).

## What we're building

A first-run that (1) seeds a workspace from an inferred template, (2) guides the admin to one real artifact, and (3) offers a one-tap shareable view that opens without an account.

## Not in scope

SSO/role config (deferred behind first value), mobile first-run, sales-led motion.

## Open questions

- What's the default template when use-case is ambiguous?
- Does the no-account "view" allow comments, or read-only first?`);

  // ── LANE 4 · METRICS, RISKS, AI SYNTHESIS ────────────────────────────────
  label(1300, -980, '4 · Metrics, risks & AI synthesis', 'l', 640);

  const metrics = table(1300, -900, 640, 200,
    ['Metric', 'Baseline', 'Target (Q3)', 'Guardrail'],
    [
      ['Time to first artifact', '11 min', '< 3 min', 'No drop in artifact quality'],
      ['2nd-member active / 7d', '23%', '45%', 'Invite spam reports < 1%'],
      ['First-run completion', '58%', '80%', 'Support tickets flat or down'],
      ['Week-2 retention', '31%', '40%', 'No paywall complaints'],
    ]);

  const risks = doc(1300, -660, 640, 300, 'Risks & mitigations',
`## Risks

- **No-account views leak data.** Mitigation: view-only, scoped tokens, admin can revoke; no workspace-wide exposure.
- **Template feels wrong for the team.** Mitigation: one-tap "start blank" escape hatch; learn from which templates get kept.
- **Deferring SSO annoys IT-led buyers.** Mitigation: detect enterprise email domains → offer setup, don't force it.
- **Doubling invites risks spam perception.** Mitigation: rate-limit, clear sender identity, easy opt-out.`);

  const tensions = doc(1300, -330, 640, 230, 'Tensions (AI scan)',
`*Surfaced by "Scan for tensions" across the board:*

- **Bet 3 (defer all setup)** vs **Risk (IT-led buyers expect SSO)** — "zero up-front fields" can't be universal; needs an enterprise-domain branch.
- **"Make sharing the first action"** vs **"No-account views leak data"** — speed of sharing trades against the data-exposure guardrail; resolve the token scope before build.`);

  const missing = doc(1300, -60, 640, 250, "What's missing (AI scan)",
`*Surfaced by "What am I missing?":*

- **No rollback / kill-criteria** for the experiment — what reading makes us revert?
- **No instrumentation plan** — which events fire for "first artifact" and "2nd member active"? Define before build.
- **Pricing interaction** — does the no-account view affect seat-based pricing? Unowned.
- **Accessibility** of the guided flow — not mentioned anywhere.`);

  // ── Provenance / flow connectors between lanes ────────────────────────────
  link(research, problem, 'evidence', 'blue');
  link(problem, bets, 'so we bet', 'blue');
  link(bets, nTemplate, 'realised as', 'blue');
  link(brief, metrics, 'measured by', 'blue');
  link(research, quotes, '', 'grey');

  E.selectNone();
});

await sleep(600);
await page.evaluate(() => { window.editor.zoomToFit(); });
await sleep(800);
await page.screenshot({ path: `${OUT}/jz-pm-board-full.png` });

// Detail shots of each lane.
const lanes = [
  ['research', -1620, -1000, 920, 1180],
  ['solution-flow', 580, -1000, 640, 1180],
  ['synthesis', 1280, -1000, 700, 1180],
];
for (const [name, x, y, w, h] of lanes) {
  await page.evaluate(({ x, y, w, h }) => {
    window.editor.zoomToBounds({ x, y, w, h }, { inset: 40 });
  }, { x, y, w, h });
  await sleep(700);
  await page.screenshot({ path: `${OUT}/jz-pm-board-${name}.png` });
}

const counts = await page.evaluate(() => {
  const all = window.editor.getCurrentPageShapes();
  const by = (t) => all.filter((s) => s.type === t).length;
  return { docs: by('doc-card'), notes: by('note-card'), tables: by('table-card'), geo: by('geo'), text: by('text'), arrows: by('arrow'), total: all.length };
});
console.log('Board seeded:', JSON.stringify(counts));
await browser.close();
