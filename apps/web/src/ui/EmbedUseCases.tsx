/**
 * The use-cases canvas (?usecases=1) — the marketing site's "different boards
 * for different people" section. One big board holds four deliberately dense,
 * messy persona workspaces built from REAL card shapes (docs, tables, complex
 * diagrams, source links, images/photos) with sticky notes annotating the
 * board, all wired with the product's own dotted provenance lineage. A bare
 * Next/Back arrow controller flies the camera between workspaces.
 *
 * The overlay is pointer-events:none except the controller, so the marketing
 * page scrolls over it; the camera is driven only by the controller.
 */

import { useEffect, useRef } from 'react';
import { Box, createShapeId, stopEventPropagation, useEditor, type TLShapeId } from 'tldraw';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PROV_META_KEY } from '../ask/useAsk';

const IMG = (name: string) => `${import.meta.env.BASE_URL}uc/${name}.jpg`;

type CardSpec =
  | { kind: 'note'; slot: string; text: string }
  | { kind: 'doc'; slot: string; title: string; text: string }
  | { kind: 'table'; slot: string; columns: string[]; rows: string[][] }
  | { kind: 'diagram'; slot: string; title: string; code: string }
  | { kind: 'link'; slot: string; url: string; siteName: string; title: string; description: string }
  | { kind: 'img'; slot: string; src: string; name: string };

interface Persona {
  name: string;
  cards: CardSpec[];
}

// Staggered placement of every slot within a persona's region (region centre = 0)
// — a big, busy workspace, offset so it reads as real work, not a grid.
// A filled, built-out board: cards spread across the whole region in loose
// columns like a real workspace, capped above a clear bottom band so the
// Next/Back controller (which docks at the viewport's bottom-centre) never
// overlaps a card.
// A compact, densely-packed workspace — cards nearly edge-to-edge in four
// loose columns so the whole board frames at a legible zoom, with a clear
// centre-bottom lane where the Next/Back controller docks.
const SLOTS: Record<string, { dx: number; dy: number; w: number; h: number }> = {
  desc: { dx: -960, dy: -520, w: 340, h: 150 },
  doc: { dx: -960, dy: -350, w: 380, h: 420 },
  doc2: { dx: -960, dy: 90, w: 380, h: 270 },
  note2: { dx: -940, dy: 380, w: 220, h: 100 },
  table: { dx: -560, dy: -520, w: 580, h: 230 },
  diagram: { dx: -560, dy: -270, w: 600, h: 420 },
  table3: { dx: -560, dy: 170, w: 560, h: 240 },
  table2: { dx: 60, dy: -520, w: 560, h: 220 },
  diagram2: { dx: 60, dy: -280, w: 600, h: 270 },
  link: { dx: 60, dy: 10, w: 280, h: 130 },
  link2: { dx: 350, dy: 10, w: 290, h: 130 },
  note1: { dx: 60, dy: 160, w: 190, h: 110 },
  img3: { dx: 280, dy: 160, w: 360, h: 240 },
  link3: { dx: 680, dy: -520, w: 380, h: 130 },
  img: { dx: 680, dy: -380, w: 360, h: 240 },
  img2: { dx: 680, dy: -120, w: 360, h: 250 },
  note3: { dx: 680, dy: 150, w: 200, h: 110 },
};

const REGION_GAP = 3200;

const PERSONAS: Persona[] = [
  {
    name: 'Product managers',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Product managers\n\nTurn a fuzzy feature idea into a shipped plan — competitors, trade-offs, the spec, the flow, the rollout.' },
      { kind: 'doc', slot: 'doc', title: 'PRD — Saved Views', text: '## Saved Views\n\n**Problem.** Power users rebuild the same filters every day; the reset bug loses them mid-session.\n\n**Goal.** Save a filter set once, reopen and share it.\n\n- **P0** — save, name, reopen a view\n- **P1** — share with a teammate\n- **P2** — set a team default\n\n**Non-goals.** Cross-project views, per-view notifications.\n\n**Open questions.** Do shared views inherit permissions? What happens on a deleted field?\n\n**Success:** 30% of weekly actives save a view within 30 days.' },
      { kind: 'doc', slot: 'doc2', title: 'Rollout plan', text: '## Rollout\n\n- **Wk 1** — internal dogfood\n- **Wk 2** — 5% beta, watch crash-free\n- **Wk 3** — ramp to 50%\n- **Wk 4** — GA + changelog\n\n**Guardrail:** hold the ramp if crash-free < 99.5%.' },
      { kind: 'table', slot: 'table', columns: ['Tool', 'Saved views', 'Sharing', 'Defaults', 'Feel'], rows: [['Linear', 'Yes', 'Team', 'Yes', 'Fast'], ['Jira', 'Yes', 'Complex', 'Yes', 'Heavy'], ['Height', 'Partial', 'No', 'No', 'Simple'], ['Asana', 'Yes', 'Team', 'No', 'Busy'], ['Us', '—', '—', '—', 'the gap']] },
      { kind: 'table', slot: 'table2', columns: ['Idea', 'Effort', 'Impact', 'Bucket'], rows: [['Save view', 'S', 'H', 'Quick win'], ['Sharing', 'M', 'H', 'Big bet'], ['Team default', 'M', 'M', 'Fill-in'], ['Pinned tabs', 'L', 'L', 'Time sink']] },
      { kind: 'table', slot: 'table3', columns: ['Metric', 'Target', 'Now'], rows: [['Views saved / WAU', '30%', '—'], ['Shares per view', '0.4', '—'], ['Filter-reset bugs', '0', '12 / wk']] },
      { kind: 'diagram', slot: 'diagram', title: 'User flow', code: 'flowchart TD\n  A[Open list] --> B[Apply filters]\n  B --> C{Save?}\n  C -->|No| Z[Just browse]\n  C -->|Yes| D[Name view]\n  D --> E{Share?}\n  E -->|Private| F[My views]\n  E -->|Team| G[Team views]\n  G --> H{Set default?}\n  H -->|Yes| I[Team default]\n  H -->|No| F\n  F --> J[Reopen anytime]\n  I --> J' },
      { kind: 'diagram', slot: 'diagram2', title: 'Release ramp', code: 'flowchart LR\n  A[Dogfood] --> B[Beta 5%]\n  B --> C{Crash-free?}\n  C -->|No| D[Fix + hold]\n  D --> B\n  C -->|Yes| E[Ramp 50%]\n  E --> F[GA]' },
      { kind: 'link', slot: 'link', url: 'https://linear.app/docs/views', siteName: 'Linear', title: 'Custom views & filters', description: 'How Linear models saved, shareable views.' },
      { kind: 'link', slot: 'link2', url: 'https://support.atlassian.com/jira', siteName: 'Atlassian', title: 'JQL & saved filters', description: 'Jira’s filter + subscription model.' },
      { kind: 'link', slot: 'link3', url: 'https://height.app/changelog', siteName: 'Height', title: 'Views — changelog', description: 'How a lighter tool shipped views.' },
      { kind: 'img', slot: 'img', src: 'wireframe', name: 'Feature wireframes' },
      { kind: 'note', slot: 'note1', text: 'P0 — ship this first' },
      { kind: 'note', slot: 'note2', text: '← the gap we own' },
      { kind: 'note', slot: 'note3', text: 'measure week 1' },
    ],
  },
  {
    name: 'Designers',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Designers\n\nSynthesize research, map the journey, and pressure-test the direction — scattered inputs become a board you build from.' },
      { kind: 'doc', slot: 'doc', title: 'Research synthesis', text: '## What we heard\n\n5 interviews · 2 usability tests · 1 diary study\n\n- **Onboarding is the cliff** — 3/5 dropped at “connect data”.\n- Users trust **templates** over a blank canvas.\n- “Where do I even start?” came up every session.\n- Power users want **keyboard-first** everything.\n\n**Direction:** lead with a template gallery, defer the blank canvas, and add a first-run checklist.' },
      { kind: 'doc', slot: 'doc2', title: 'Personas', text: '## Two personas\n\n**Maya · indie maker** — ships side projects, hates setup, lives in shortcuts.\n\n**Sam · team lead** — needs templates and sharing, cares about consistency.\n\nBoth open with: “where do I start?”' },
      { kind: 'table', slot: 'table', columns: ['App', 'Onboarding', 'First win', 'Empty state'], rows: [['Notion', 'Templates', '< 1 min', 'Guided'], ['Linear', 'Sample data', 'Fast', 'Clean'], ['Figma', 'Blank + tips', 'Slow', 'Sparse'], ['Ours', 'TBD', 'TBD', 'TBD']] },
      { kind: 'table', slot: 'table2', columns: ['Signal', 'Count', 'Move'], rows: [['Wants templates', '4/5', 'P0'], ['Confused start', '5/5', 'P0'], ['Likes shortcuts', '2/5', 'P2']] },
      { kind: 'table', slot: 'table3', columns: ['Heuristic', 'Score', 'Note'], rows: [['Visibility', '3/5', 'status unclear'], ['Error prevention', '2/5', 'no undo'], ['Consistency', '4/5', 'mostly ok'], ['Recognition', '3/5', 'hidden actions']] },
      { kind: 'diagram', slot: 'diagram', title: 'Journey map', code: 'flowchart TD\n  A[Discover] --> B[Landing]\n  B --> C{Sign up?}\n  C -->|No| X[Bounce]\n  C -->|Yes| D[Onboarding]\n  D --> E{Connect data?}\n  E -->|No| F[The cliff]\n  F --> G[Email nudge]\n  G --> E\n  E -->|Yes| H[First value]\n  H --> I{Return D2?}\n  I -->|Yes| J[Habit]\n  I -->|No| G' },
      { kind: 'diagram', slot: 'diagram2', title: 'Information architecture', code: 'flowchart TD\n  Home --> Templates\n  Home --> Canvas\n  Home --> Settings\n  Templates --> New[New board]\n  Canvas --> Share\n  Canvas --> Export' },
      { kind: 'link', slot: 'link', url: 'https://maze.co/reports/ux-research', siteName: 'Maze', title: 'Usability test readout', description: 'The 12-participant onboarding study.' },
      { kind: 'link', slot: 'link2', url: 'https://baymard.com/blog', siteName: 'Baymard', title: 'Onboarding UX benchmarks', description: 'What great first-runs have in common.' },
      { kind: 'link', slot: 'link3', url: 'https://dribbble.com/tags/onboarding', siteName: 'Dribbble', title: 'Onboarding references', description: 'Visual patterns worth stealing.' },
      { kind: 'img', slot: 'img', src: 'storyboard', name: 'UX storyboard' },
      { kind: 'img', slot: 'img2', src: 'proxilexis', name: 'Concept board' },
      { kind: 'img', slot: 'img3', src: 'des-ui', name: 'UI reference' },
      { kind: 'note', slot: 'note1', text: 'lead with templates' },
      { kind: 'note', slot: 'note2', text: 'the cliff is here ↑' },
      { kind: 'note', slot: 'note3', text: 'steal this pattern' },
    ],
  },
  {
    name: 'Students & researchers',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Students & researchers\n\nDrop your sources and get a cited literature review, a concept map, and a study guide — grounded and traceable.' },
      { kind: 'doc', slot: 'doc', title: 'Literature review — Attention', text: '## Attention in NLP\n\nSelf-attention [1] reframed sequence modeling as fully parallel, removing recurrence and unlocking scale.\n\n- **Transformers** [1] — self-attention + positional encoding.\n- **BERT** [2] — bidirectional pretraining, fine-tuned per task.\n- **Scaling laws** [3] — loss falls predictably with compute.\n- **Emergence** [4] — new abilities appear past a scale threshold.\n\n_See sources for the primary papers; complexity is O(n²·d)._' },
      { kind: 'doc', slot: 'doc2', title: 'Study guide', text: '## Exam-ready\n\n- **Define** self-attention: softmax(QKᵀ/√d)·V.\n- **Contrast** RNN vs Transformer.\n- **Explain** why scaling helps [3].\n\n**Likely Q:** derive attention complexity → O(n²·d).' },
      { kind: 'table', slot: 'table', columns: ['Paper', 'Year', 'Key idea', 'Cited by'], rows: [['Attention Is All You Need', '2017', 'Transformer', '110k+'], ['BERT', '2018', 'Bidirectional', '90k+'], ['GPT-3', '2020', 'Few-shot', '30k+'], ['Scaling Laws', '2020', 'Compute→loss', '9k+']] },
      { kind: 'table', slot: 'table2', columns: ['Term', 'In one line'], rows: [['Self-attention', 'Tokens weigh each other'], ['Head', 'One attention pattern'], ['Pretraining', 'Learn before the task']] },
      { kind: 'table', slot: 'table3', columns: ['Year', 'Milestone'], rows: [['2014', 'Attention (Bahdanau)'], ['2017', 'Transformer'], ['2018', 'BERT / GPT'], ['2020', 'Scaling laws']] },
      { kind: 'diagram', slot: 'diagram', title: 'Concept map', code: 'flowchart TD\n  A[Attention] --> B[Self-attention]\n  A --> C[Cross-attention]\n  B --> D[Transformers]\n  D --> E[Encoder]\n  D --> F[Decoder]\n  E --> G[BERT]\n  F --> H[GPT]\n  D --> I[Scaling laws]\n  G --> J[Fine-tuning]\n  H --> J\n  I --> K[Emergent ability]' },
      { kind: 'diagram', slot: 'diagram2', title: 'Method lineage', code: 'flowchart LR\n  A[RNN] --> B[LSTM]\n  B --> C[Attention]\n  C --> D[Transformer]\n  D --> E[Pretrain + FT]' },
      { kind: 'link', slot: 'link', url: 'https://arxiv.org/abs/1706.03762', siteName: 'arXiv', title: 'Attention Is All You Need', description: 'Vaswani et al., 2017 — the Transformer.' },
      { kind: 'link', slot: 'link2', url: 'https://jalammar.github.io/illustrated-transformer', siteName: 'jalammar.github.io', title: 'The Illustrated Transformer', description: 'The canonical visual explainer.' },
      { kind: 'link', slot: 'link3', url: 'https://paperswithcode.com/method/transformer', siteName: 'Papers with Code', title: 'Transformer — leaderboard', description: 'Benchmarks and implementations.' },
      { kind: 'img', slot: 'img', src: 'radar', name: 'Fig — AI capability by job' },
      { kind: 'note', slot: 'note1', text: 'cite every claim' },
      { kind: 'note', slot: 'note2', text: 'start with [1]' },
      { kind: 'note', slot: 'note3', text: 'exam: know O(n²·d)' },
    ],
  },
  {
    name: 'Founders & strategists',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Founders & strategists\n\nSize the market, benchmark rivals, and stress-test the risks before you bet — one prompt, a whole strategy board.' },
      { kind: 'doc', slot: 'doc', title: 'Thesis — Ambient scribe', text: '## AI note-taker for clinicians\n\n**Wedge:** an ambient scribe for solo & small practices.\n\n- **Why now** — speech models are finally good enough; documentation burnout is peaking; reimbursement favors throughput.\n- **Moat** — specialty templates + EHR integrations + a data flywheel from corrections.\n- **Risk** — enterprise incumbents move down-market.\n\n**Ask:** $1.5M pre-seed to reach 50 paying clinics and prove retention.' },
      { kind: 'doc', slot: 'doc2', title: 'Go-to-market', text: '## GTM\n\n- **Beachhead** — solo primary-care.\n- **Channel** — clinician communities + referrals.\n- **Price** — $99 / seat / mo, annual.\n\n**Motion:** PLG trial → onboarding call at activation.' },
      { kind: 'table', slot: 'table', columns: ['Layer', 'Who', 'Value'], rows: [['TAM', 'All US clinicians', '$12B'], ['SAM', 'Outpatient notes', '$3.4B'], ['SOM', 'Solo + small (yr 3)', '$260M']] },
      { kind: 'table', slot: 'table2', columns: ['Rival', 'Focus', 'Gap'], rows: [['Abridge', 'Hospitals', 'Not for solo'], ['Nuance DAX', 'Enterprise', 'Pricey'], ['Freed', 'Solo', 'Few templates']] },
      { kind: 'table', slot: 'table3', columns: ['Metric', 'Value'], rows: [['ACV', '$1.2k'], ['CAC', '$400'], ['Payback', '4 mo'], ['Gross margin', '82%']] },
      { kind: 'diagram', slot: 'diagram', title: 'Go-to-market loop', code: 'flowchart TD\n  A[Solo clinics] --> B[Free trial]\n  B --> C{Activated?}\n  C -->|No| D[Onboard call]\n  D --> C\n  C -->|Yes| E[Paid seat]\n  E --> F{Happy?}\n  F -->|Yes| G[Referral]\n  G --> A\n  F -->|No| H[Save / churn]' },
      { kind: 'diagram', slot: 'diagram2', title: 'Funnel', code: 'flowchart LR\n  A[1000 signups] --> B[600 activate]\n  B --> C[220 paid]\n  C --> D[180 retained]' },
      { kind: 'link', slot: 'link', url: 'https://rockhealth.com/insights', siteName: 'Rock Health', title: 'Digital health funding 2025', description: 'Where AI clinical tooling raised this year.' },
      { kind: 'link', slot: 'link2', url: 'https://a16z.com/tag/healthcare', siteName: 'a16z', title: 'AI in the clinic — thesis', description: 'The investor case for ambient AI.' },
      { kind: 'link', slot: 'link3', url: 'https://www.crunchbase.com/hub/ai-scribe', siteName: 'Crunchbase', title: 'AI scribe — funding rounds', description: 'Who raised, how much, when.' },
      { kind: 'img', slot: 'img', src: 'stocks', name: 'The AI circle of money' },
      { kind: 'img', slot: 'img2', src: 'fnd-chart', name: 'Market size — 2022–2032' },
      { kind: 'note', slot: 'note1', text: 'why now ✦' },
      { kind: 'note', slot: 'note2', text: 'biggest risk ↓' },
      { kind: 'note', slot: 'note3', text: '$25/seat ceiling' },
    ],
  },
];

// Provenance edges by slot: sources → derived work. Drawn as the product's own
// dotted lineage (every card stays selected below).
const PROV: [string, string[]][] = [
  ['table', ['link', 'link3']],
  ['table2', ['link2']],
  ['doc', ['table', 'table2', 'img3']],
  ['doc2', ['doc']],
  ['diagram', ['doc']],
  ['diagram2', ['table3']],
  ['table3', ['table']],
];
const SLOT_TYPE: Record<string, string> = {
  table: 'table-card', table2: 'table-card', table3: 'table-card',
  doc: 'doc-card', doc2: 'doc-card', diagram: 'diagram-card', diagram2: 'diagram-card',
};

export function EmbedUseCases() {
  const editor = useEditor();
  const framesRef = useRef<Box[]>([]);
  const idxRef = useRef(0);

  useEffect(() => {
    const existing = [...editor.getCurrentPageShapeIds()];
    if (existing.length) editor.deleteShapes(existing);

    const frames: Box[] = [];
    const allIds: TLShapeId[] = [];
    PERSONAS.forEach((persona, i) => {
      const cx = i * REGION_GAP;
      const bySlot: Record<string, TLShapeId> = {};
      for (const card of persona.cards) {
        const s = SLOTS[card.slot];
        if (!s) continue;
        const x = cx + s.dx;
        const y = s.dy;
        const id = createShapeId();
        bySlot[card.slot] = id;
        allIds.push(id);
        if (card.kind === 'note') {
          editor.createShape({ id, type: 'note-card', x, y, props: { w: s.w, h: s.h, text: card.text, color: '' } });
        } else if (card.kind === 'doc') {
          editor.createShape({ id, type: 'doc-card', x, y, props: { w: s.w, h: s.h, title: card.title, text: card.text } });
        } else if (card.kind === 'table') {
          editor.createShape({ id, type: 'table-card', x, y, props: { w: s.w, h: s.h, columns: card.columns, rows: card.rows } });
        } else if (card.kind === 'diagram') {
          editor.createShape({ id, type: 'diagram-card', x, y, props: { w: s.w, h: s.h, title: card.title, code: card.code } });
        } else if (card.kind === 'link') {
          editor.createShape({ id, type: 'link-card', x, y, props: { w: s.w, h: s.h, url: card.url, title: card.title, description: card.description, image: '', favicon: '', siteName: card.siteName, loading: false } });
        } else if (card.kind === 'img') {
          editor.createShape({ id, type: 'image-card', x, y, props: { w: s.w, h: s.h, src: IMG(card.src), name: card.name } });
        }
      }
      // Wire provenance for whatever slots this persona actually has.
      for (const [target, sources] of PROV) {
        const tid = bySlot[target];
        const src = sources.map((s) => bySlot[s]).filter((v): v is TLShapeId => !!v);
        const type = SLOT_TYPE[target];
        if (tid && type && src.length) {
          editor.updateShape({ id: tid, type, meta: { [PROV_META_KEY]: src } } as Parameters<typeof editor.updateShape>[0]);
        }
      }
      // Aspect-matched to the stage so it fills without letterboxing; the
      // controller sits in the clear centre-bottom lane.
      frames.push(new Box(cx - 1030, -560, 2060, 1080));
    });
    framesRef.current = frames;
    editor.setSelectedShapes(allIds);
    editor.zoomToBounds(frames[0]!, { inset: 36, animation: { duration: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const flyTo = (next: number) => {
    const frames = framesRef.current;
    if (!frames.length) return;
    const n = (next + frames.length) % frames.length;
    idxRef.current = n;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    editor.zoomToBounds(frames[n]!, { inset: 36, animation: { duration: reduce ? 0 : 950 } });
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
