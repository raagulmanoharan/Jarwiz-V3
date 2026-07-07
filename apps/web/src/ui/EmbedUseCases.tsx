/**
 * The use-cases canvas (?usecases=1) — the marketing site's "different boards
 * for different people" section. One big board holds four rich, deliberately
 * busy persona workspaces built from REAL card shapes (docs, tables, diagrams,
 * links) with sticky notes that annotate and highlight things on the board — a
 * describe-the-use-case sticky plus a couple of hand-scrawled callouts. A bare
 * Next/Back arrow controller flies the camera from one workspace to the next,
 * so the use cases are shown *inside the product*.
 *
 * The overlay is pointer-events:none except the controller, so the marketing
 * page scrolls over it; the camera is driven only by the controller.
 */

import { useEffect, useRef } from 'react';
import { Box, createShapeId, stopEventPropagation, useEditor, type TLShapeId } from 'tldraw';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PROV_META_KEY } from '../ask/useAsk';

type CardSpec =
  | { slot: 'desc' | 'note1' | 'note2'; text: string }
  | { slot: 'doc'; title: string; text: string }
  | { slot: 'table' | 'table2'; columns: string[]; rows: string[][] }
  | { slot: 'diagram'; title: string; code: string }
  | { slot: 'link'; url: string; siteName: string; title: string; description: string };

interface Persona {
  name: string;
  cards: CardSpec[];
}

// Staggered placement of each slot within a persona's region (region centre = 0)
// — offset so the board reads as a real, messy workspace, not a tidy grid.
const SLOTS: Record<CardSpec['slot'], { dx: number; dy: number; w: number; h: number }> = {
  desc: { dx: -1090, dy: -400, w: 300, h: 210 },
  table: { dx: -360, dy: -430, w: 660, h: 300 },
  table2: { dx: 400, dy: -410, w: 380, h: 300 },
  doc: { dx: -770, dy: -120, w: 360, h: 470 },
  diagram: { dx: -300, dy: -90, w: 600, h: 360 },
  link: { dx: 430, dy: -80, w: 350, h: 150 },
  note1: { dx: 360, dy: 130, w: 190, h: 120 },
  note2: { dx: -380, dy: 300, w: 210, h: 120 },
};

const REGION_GAP = 2700;

const PERSONAS: Persona[] = [
  {
    name: 'Product managers',
    cards: [
      { slot: 'desc', text: 'Product managers\n\nTurn a fuzzy feature idea into a shipped plan — competitors, trade-offs, the spec, and the flow, on one board.' },
      { slot: 'doc', title: 'PRD — Saved Views', text: '## Saved Views\n\n**Problem.** Power users rebuild the same filters every day.\n\n**Goal.** Save a filter set once, reopen and share it.\n\n- **P0** — save, name, reopen a view\n- **P1** — share with a teammate\n- **P2** — set a team default\n\n**Success:** 30% of weekly actives save a view within 30 days.' },
      { slot: 'table', columns: ['Tool', 'Saved views', 'Sharing', 'Feel'], rows: [['Linear', 'Yes', 'Team', 'Fast'], ['Jira', 'Yes', 'Complex', 'Heavy'], ['Height', 'Partial', 'No', 'Simple'], ['Us', '—', '—', 'the gap']] },
      { slot: 'diagram', title: 'User flow', code: 'flowchart LR\n  A[Filter list] --> B[Save view]\n  B --> C[Name it]\n  C --> D{Share?}\n  D -->|No| E[Reopen later]\n  D -->|Yes| F[Pick teammate]\n  F --> E' },
      { slot: 'table2', columns: ['Idea', 'Effort', 'Impact', 'Bucket'], rows: [['Save view', 'S', 'H', 'Quick win'], ['Sharing', 'M', 'H', 'Big bet'], ['Team default', 'M', 'M', 'Fill-in'], ['Pinned tabs', 'L', 'L', 'Time sink']] },
      { slot: 'link', url: 'https://linear.app/docs/views', siteName: 'Linear', title: 'Custom views & filters', description: 'How Linear models saved, shareable views.' },
      { slot: 'note1', text: 'P0 — ship this first' },
      { slot: 'note2', text: '← the gap we own' },
    ],
  },
  {
    name: 'Designers',
    cards: [
      { slot: 'desc', text: 'Designers\n\nSynthesize research, map the journey, and pressure-test the direction — scattered inputs become a board you can build from.' },
      { slot: 'doc', title: 'Research synthesis', text: '## What we heard\n\n5 interviews · 2 usability tests\n\n- **Onboarding is the cliff** — 3/5 dropped at “connect data”.\n- Users trust **templates** over a blank canvas.\n- “Where do I even start?” came up every session.\n\n**Direction:** lead with a template gallery, defer the blank canvas.' },
      { slot: 'table', columns: ['App', 'Onboarding', 'First win', 'Empty state'], rows: [['Notion', 'Templates', '< 1 min', 'Guided'], ['Linear', 'Sample data', 'Fast', 'Clean'], ['Figma', 'Blank + tips', 'Slow', 'Sparse'], ['Ours', 'TBD', 'TBD', 'TBD']] },
      { slot: 'diagram', title: 'Journey map', code: 'flowchart LR\n  A[Discover] --> B[Sign up]\n  B --> C[Connect data]\n  C --> D{First value?}\n  D -->|No| E[Drop off]\n  D -->|Yes| F[Habit]' },
      { slot: 'table2', columns: ['Signal', 'Count', 'Move'], rows: [['Wants templates', '4/5', 'P0'], ['Confused start', '5/5', 'P0'], ['Likes shortcuts', '2/5', 'P2']] },
      { slot: 'link', url: 'https://maze.co/reports/ux-research', siteName: 'Maze', title: 'Usability test readout', description: 'The 12-participant onboarding study.' },
      { slot: 'note1', text: 'lead with templates' },
      { slot: 'note2', text: 'the cliff is here ↑' },
    ],
  },
  {
    name: 'Students & researchers',
    cards: [
      { slot: 'desc', text: 'Students & researchers\n\nDrop your sources and get a cited literature review, a concept map, and a study guide — grounded and traceable.' },
      { slot: 'doc', title: 'Literature review — Attention', text: '## Attention in NLP\n\nSelf-attention [1] reframed sequence modeling as fully parallel, removing recurrence.\n\n- **Transformers** [1] — self-attention + positional encoding.\n- **BERT** [2] — bidirectional pretraining, fine-tuned per task.\n- **Scaling laws** [3] — loss falls predictably with compute.\n\n_See sources for the primary papers._' },
      { slot: 'table', columns: ['Paper', 'Year', 'Key idea', 'Cited by'], rows: [['Attention Is All You Need', '2017', 'Transformer', '110k+'], ['BERT', '2018', 'Bidirectional', '90k+'], ['Scaling Laws', '2020', 'Compute→loss', '9k+']] },
      { slot: 'diagram', title: 'Concept map', code: 'flowchart TD\n  A[Attention] --> B[Transformers]\n  B --> C[BERT]\n  B --> D[GPT]\n  B --> E[Scaling laws]\n  C --> F[Fine-tuning]\n  D --> F' },
      { slot: 'table2', columns: ['Term', 'In one line'], rows: [['Self-attention', 'Tokens weigh each other'], ['Head', 'One attention pattern'], ['Pretraining', 'Learn before the task']] },
      { slot: 'link', url: 'https://arxiv.org/abs/1706.03762', siteName: 'arXiv', title: 'Attention Is All You Need', description: 'Vaswani et al., 2017 — the Transformer.' },
      { slot: 'note1', text: 'cite every claim' },
      { slot: 'note2', text: 'start with [1]' },
    ],
  },
  {
    name: 'Founders & strategists',
    cards: [
      { slot: 'desc', text: 'Founders & strategists\n\nSize the market, benchmark rivals, and stress-test the risks before you bet — one prompt, a whole strategy board.' },
      { slot: 'doc', title: 'Thesis — Ambient scribe', text: '## AI note-taker for clinicians\n\n**Wedge:** an ambient scribe for solo & small practices.\n\n- **Why now** — speech models are finally good enough; documentation burnout is peaking.\n- **Moat** — specialty templates + EHR integrations.\n\n**Ask:** $1.5M pre-seed to reach 50 paying clinics.' },
      { slot: 'table', columns: ['Layer', 'Who', 'Value'], rows: [['TAM', 'All US clinicians', '$12B'], ['SAM', 'Outpatient notes', '$3.4B'], ['SOM', 'Solo + small (yr 3)', '$260M']] },
      { slot: 'diagram', title: 'Go-to-market', code: 'flowchart LR\n  A[Solo clinics] --> B[Free trial]\n  B --> C{Loves it?}\n  C -->|Yes| D[Paid seat]\n  C -->|No| E[Learn why]\n  D --> F[Referral]\n  F --> A' },
      { slot: 'table2', columns: ['Rival', 'Focus', 'Gap'], rows: [['Abridge', 'Hospitals', 'Not for solo'], ['Nuance DAX', 'Enterprise', 'Pricey'], ['Freed', 'Solo', 'Few templates']] },
      { slot: 'link', url: 'https://rockhealth.com/insights', siteName: 'Rock Health', title: 'Digital health funding 2025', description: 'Where AI clinical tooling raised this year.' },
      { slot: 'note1', text: 'why now ✦' },
      { slot: 'note2', text: 'biggest risk ↓' },
    ],
  },
];

export function EmbedUseCases() {
  const editor = useEditor();
  const framesRef = useRef<Box[]>([]);
  const idxRef = useRef(0);

  useEffect(() => {
    // Wipe any persisted board, then lay out every persona region.
    const existing = [...editor.getCurrentPageShapeIds()];
    if (existing.length) editor.deleteShapes(existing);

    const frames: Box[] = [];
    const allIds: TLShapeId[] = [];
    PERSONAS.forEach((persona, i) => {
      const cx = i * REGION_GAP;
      const bySlot: Partial<Record<CardSpec['slot'], TLShapeId>> = {};
      for (const card of persona.cards) {
        const s = SLOTS[card.slot];
        const x = cx + s.dx;
        const y = s.dy;
        const id = createShapeId();
        bySlot[card.slot] = id;
        allIds.push(id);
        if (card.slot === 'desc' || card.slot === 'note1' || card.slot === 'note2') {
          editor.createShape({ id, type: 'note-card', x, y, props: { w: s.w, h: s.h, text: card.text, color: '' } });
        } else if (card.slot === 'doc') {
          editor.createShape({ id, type: 'doc-card', x, y, props: { w: s.w, h: s.h, title: card.title, text: card.text } });
        } else if (card.slot === 'table' || card.slot === 'table2') {
          editor.createShape({ id, type: 'table-card', x, y, props: { w: s.w, h: s.h, columns: card.columns, rows: card.rows } });
        } else if (card.slot === 'diagram') {
          editor.createShape({ id, type: 'diagram-card', x, y, props: { w: s.w, h: s.h, title: card.title, code: card.code } });
        } else if (card.slot === 'link') {
          editor.createShape({ id, type: 'link-card', x, y, props: { w: s.w, h: s.h, url: card.url, title: card.title, description: card.description, image: '', favicon: '', siteName: card.siteName, loading: false } });
        }
      }
      // Provenance lineage within the region: the source link feeds the tables;
      // the tables feed the recommendation doc; the doc feeds the diagram. Drawn
      // as the product's own dotted lines (the cards stay selected below).
      const prov = (target: TLShapeId | undefined, type: string, sources: (TLShapeId | undefined)[]) => {
        const src = sources.filter((s): s is TLShapeId => !!s);
        if (target && src.length) {
          editor.updateShape({ id: target, type, meta: { [PROV_META_KEY]: src } } as Parameters<typeof editor.updateShape>[0]);
        }
      };
      prov(bySlot.table, 'table-card', [bySlot.link]);
      prov(bySlot.table2, 'table-card', [bySlot.link]);
      prov(bySlot.doc, 'doc-card', [bySlot.table]);
      prov(bySlot.diagram, 'diagram-card', [bySlot.doc]);
      frames.push(new Box(cx - 1150, -480, 1980, 960));
    });
    framesRef.current = frames;
    // Keep everything selected so every region's dotted lineage stays drawn.
    editor.setSelectedShapes(allIds);
    editor.zoomToBounds(frames[0]!, { inset: 40, animation: { duration: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const flyTo = (next: number) => {
    const frames = framesRef.current;
    if (!frames.length) return;
    const n = (next + frames.length) % frames.length;
    idxRef.current = n;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    editor.zoomToBounds(frames[n]!, { inset: 40, animation: { duration: reduce ? 0 : 900 } });
  };

  return (
    <div className="jz-uc" aria-hidden="false">
      <div className="jz-uc-ctrl" onPointerDown={stopEventPropagation}>
        <button className="jz-uc-btn" aria-label="Previous use case" onClick={() => flyTo(idxRef.current - 1)}>
          <ChevronLeft size={20} />
        </button>
        <button className="jz-uc-btn" aria-label="Next use case" onClick={() => flyTo(idxRef.current + 1)}>
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
