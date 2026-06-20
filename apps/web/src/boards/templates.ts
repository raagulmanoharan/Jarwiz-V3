/**
 * Starter templates — pre-seeded shape sets centred near page origin.
 * Applied via editor.createShapes() then zoomToFit. Each template receives
 * the user's project name so the first doc's title reflects it.
 */

import type { Editor } from 'tldraw';

export interface Template {
  id: string;
  emoji: string;
  label: string;
  description: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'problem-bets',
    emoji: '🎯',
    label: 'Problem → Bets → Metrics',
    description: "Three columns: the problem space, your bets, and how you'll know if you won.",
  },
  {
    id: 'jtbd',
    emoji: '🔍',
    label: 'JTBD Canvas',
    description: 'Situation · Motivation · Outcome — map the job your user is hiring this for.',
  },
  {
    id: 'feature-brief',
    emoji: '📄',
    label: 'Feature Brief',
    description: "Why / Who / What we're building / Not in scope — one structured doc.",
  },
  {
    id: 'competitive',
    emoji: '⚖️',
    label: 'Competitive Landscape',
    description: 'A comparison table seeded with key dimensions — Tab to fill the cells.',
  },
  {
    id: 'retro',
    emoji: '🔁',
    label: 'Retrospective',
    description: "What worked / What didn't / What we'll try — three columns of stickies.",
  },
];

const nid = () => 'shape:' + Math.random().toString(36).slice(2, 14);

/** Apply template shapes to the canvas, centred, with the board name in the primary card title. */
export function applyTemplate(editor: Editor, templateId: string, boardName: string): void {
  const shapes = buildShapes(templateId, boardName);
  if (!shapes.length) return;
  editor.createShapes(shapes);
  editor.selectAll();
  const bounds = editor.getSelectionPageBounds();
  if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 80 });
  editor.selectNone();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildShapes(id: string, name: string): any[] {
  switch (id) {
    case 'problem-bets':
      return problemBetsShapes(name);
    case 'jtbd':
      return jtbdShapes(name);
    case 'feature-brief':
      return featureBriefShapes(name);
    case 'competitive':
      return competitiveShapes(name);
    case 'retro':
      return retroShapes(name);
    default:
      return [];
  }
}

/* ─── Problem → Bets → Metrics ─────────────────────────────────────────────── */

function problemBetsShapes(name: string) {
  const W = 400, H = 340, GAP = 28;
  const totalW = W * 3 + GAP * 2;
  const x0 = -totalW / 2;
  const y = -H / 2;

  const problem = `## Problem space\n\n*What is the user struggling with today? What's broken or missing?*\n\n— ${name || 'Define the problem here'}`;
  const bets = `## Our bets\n\n*What do we believe will solve it? Each bet is a testable hypothesis.*\n\n- Bet 1: ...\n- Bet 2: ...\n- Bet 3: ...`;
  const metrics = `## Success metrics\n\n*How will we know if we won?*\n\n- **Primary metric:** … (baseline → target)\n- **Guardrail:** … (must not regress)\n- **Signal we're wrong:** …`;

  return [
    { id: nid(), type: 'doc-card', x: x0, y, props: { w: W, h: H, title: 'Problem space', text: problem, sourcePdfId: '' } },
    { id: nid(), type: 'doc-card', x: x0 + W + GAP, y, props: { w: W, h: H, title: 'Our bets', text: bets, sourcePdfId: '' } },
    { id: nid(), type: 'doc-card', x: x0 + (W + GAP) * 2, y, props: { w: W, h: H, title: 'Success metrics', text: metrics, sourcePdfId: '' } },
  ];
}

/* ─── JTBD Canvas ────────────────────────────────────────────────────────────── */

function jtbdShapes(name: string) {
  const NW = 220, NH = 96, HH = 44, GAP = 20;
  const totalW = NW * 3 + GAP * 2;
  const x0 = -totalW / 2;
  const cols = ['Situation', 'Motivation', 'Outcome'];
  const placeholders = [
    ['When I am…', "I'm dealing with…", 'The trigger is…'],
    ['I want to…', 'So that I can…', 'What I really need is…'],
    ["I know I've succeeded when…", "The feeling I'm after…", 'The metric that matters…'],
  ];
  const colors = ['#e8f0ff', '#fdeaf1', '#eafaf0'];

  const shapes = [];

  for (let c = 0; c < 3; c++) {
    const x = x0 + c * (NW + GAP);
    // Column header
    shapes.push({ id: nid(), type: 'note-card', x, y: -HH - 8, props: { w: NW, h: HH, text: cols[c], color: colors[c] } });
    // 3 body notes
    for (let r = 0; r < 3; r++) {
      shapes.push({ id: nid(), type: 'note-card', x, y: r * (NH + 8), props: { w: NW, h: NH, text: placeholders[c]?.[r] ?? '', color: colors[c] } });
    }
  }

  // Insight doc below
  const insightY = 3 * (NH + 8) + 20;
  shapes.push({
    id: nid(), type: 'doc-card', x: x0, y: insightY,
    props: { w: totalW, h: 200, title: name || 'Key insight', text: '## Key insight\n\nSummarise the job-to-be-done in one sentence:\n\n*"When [situation], I want to [motivation], so I can [outcome]."*', sourcePdfId: '' },
  });

  return shapes;
}

/* ─── Feature Brief ──────────────────────────────────────────────────────────── */

function featureBriefShapes(name: string) {
  const title = name || 'Feature brief';
  const text = [
    '## Why',
    '',
    '*What user problem does this solve? Why now?*',
    '',
    '## Who',
    '',
    '*Which user segment is the primary beneficiary?*',
    '',
    "## What we're building",
    '',
    '*Describe the feature in one paragraph. Be specific enough to build from.*',
    '',
    '## Not in scope',
    '',
    '- ...',
    '- ...',
    '',
    '## Open questions',
    '',
    '- ...',
  ].join('\n');

  return [{ id: nid(), type: 'doc-card', x: -300, y: -280, props: { w: 600, h: 560, title, text, sourcePdfId: '' } }];
}

/* ─── Competitive Landscape ─────────────────────────────────────────────────── */

function competitiveShapes(name: string) {
  const hint = `${name || 'Competitive landscape'} — double-click to add competitors, press Tab to fill the cells`;
  return [
    {
      id: nid(), type: 'note-card', x: -380, y: -120,
      props: { w: 760, h: 44, text: hint, color: '#f0f4ff' },
    },
    {
      id: nid(), type: 'table-card', x: -380, y: -64,
      props: {
        w: 760, h: 200,
        columns: ['Competitor', 'Approach', 'Strength', 'Watch-out'],
        rows: [['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']],
      },
    },
  ];
}

/* ─── Retrospective ─────────────────────────────────────────────────────────── */

function retroShapes(name: string) {
  const NW = 220, NH = 96, HH = 44, GAP = 20;
  const totalW = NW * 3 + GAP * 2;
  const x0 = -totalW / 2;
  const cols = ['✅ What worked', '❌ What didn\'t', '💡 What we\'ll try'];
  const colors = ['#eafaf0', '#fdeaf1', '#fff9e6'];
  const seeds = [
    ['Add a win here…', 'Another win…', 'One more…'],
    ['Add a pain here…', 'Another pain…', 'One more…'],
    ['Add an experiment here…', 'Another idea…', 'One more…'],
  ];

  const shapes = [];
  // Optional title note
  shapes.push({ id: nid(), type: 'note-card', x: -totalW / 2, y: -HH - 20, props: { w: totalW, h: HH, text: `Retro: ${name || 'Sprint N'}`, color: '#f5f5f5' } });

  for (let c = 0; c < 3; c++) {
    const x = x0 + c * (NW + GAP);
    shapes.push({ id: nid(), type: 'note-card', x, y: 0, props: { w: NW, h: HH, text: cols[c], color: colors[c] } });
    for (let r = 0; r < 3; r++) {
      shapes.push({ id: nid(), type: 'note-card', x, y: HH + 8 + r * (NH + 8), props: { w: NW, h: NH, text: seeds[c]?.[r] ?? '', color: colors[c] } });
    }
  }

  return shapes;
}
