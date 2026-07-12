/**
 * The use-cases canvas (?usecases=1) — the marketing site's "different boards
 * for different people" section. One big board holds four deliberately dense,
 * messy persona workspaces built from REAL card shapes (docs, tables, complex
 * diagrams, source links, images/photos, research notes) with sticky notes
 * annotating the board, all wired with the product's own dotted provenance
 * lineage. A bare Next/Back arrow controller flies the camera between
 * workspaces.
 *
 * Layout is done AFTER the auto-growing cards (docs, tables, diagrams) have
 * settled their real heights: a balanced column masonry, sized to the stage's
 * WIDE aspect ratio so each workspace fills the frame side-to-side (no side
 * letterboxing, bigger cards) rather than framing as a tall square. Sticky
 * notes are pinned onto the card they annotate, so they fill the board instead
 * of eating a column. The overlay is pointer-events:none except the controller.
 */

import { useEffect, useRef } from 'react';
import { Box, createShapeId, stopEventPropagation, useEditor, type TLShapeId } from 'tldraw';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PROV_META_KEY } from '../ask/useAsk';

const IMG = (name: string) => `${import.meta.env.BASE_URL}uc/${name}.jpg`;

type Corner = 'tr' | 'tl' | 'br' | 'bl';
type CardSpec =
  | { kind: 'note'; slot: string; text: string }
  | { kind: 'pin'; slot: string; text: string; anchor: string; corner: Corner }
  | { kind: 'doc'; slot: string; title: string; text: string }
  | { kind: 'table'; slot: string; columns: string[]; rows: string[][] }
  | { kind: 'diagram'; slot: string; title: string; code: string }
  | { kind: 'link'; slot: string; url: string; siteName: string; title: string; description: string }
  | { kind: 'img'; slot: string; src: string; name: string };

interface Persona {
  name: string;
  cards: CardSpec[];
}

// Natural width per slot — used at create time and as the card's masonry width.
// Kept in a fairly tight band (440–620) so columns pack with little horizontal
// slack; heights are read live from the rendered cards during reflow.
const W: Record<string, number> = {
  desc: 380,
  doc: 540, doc2: 460, research: 480,
  table: 600, table2: 560, table3: 520,
  diagram: 600, diagram2: 560,
  link: 460, link2: 460, link3: 460, link4: 460,
  img: 500, img2: 460, img3: 440,
};
const H0: Record<string, number> = {
  desc: 150,
  doc: 380, doc2: 260, research: 280,
  table: 210, table2: 200, table3: 200,
  diagram: 420, diagram2: 260,
  link: 150, link2: 150, link3: 150, link4: 150,
  img: 330, img2: 300, img3: 300,
};
const NOTE_W = 210;
const NOTE_H = 96;

const REGION_GAP = 4200;

const PERSONAS: Persona[] = [
  {
    name: 'Product managers',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Product managers\n\nTurn a fuzzy feature idea into a shipped plan — competitors, trade-offs, the spec, the flow, the rollout.' },
      { kind: 'doc', slot: 'doc', title: 'PRD — Saved Views', text: '## Saved Views\n\n**Problem.** Power users rebuild the same filters every day; the reset bug loses them mid-session.\n\n**Goal.** Save a filter set once, reopen and share it.\n\n- **P0** — save, name, reopen a view\n- **P1** — share with a teammate\n- **P2** — set a team default\n\n**Non-goals.** Cross-project views, per-view notifications.\n\n**Open questions.** Do shared views inherit permissions? What happens on a deleted field?\n\n**Success:** 30% of weekly actives save a view within 30 days.' },
      { kind: 'doc', slot: 'research', title: 'Research notes', text: '## What we found\n\n- Users rebuild the same 3–4 filters daily [1].\n- The reset bug clears views on refresh — 12 reports / wk [2].\n- Linear ships shareable team views; Jira over-complicates it [3].\n- Nielsen: persistent state cuts repeat cognitive load [4].\n\n_[1] interviews · [2] support · [3] Linear docs · [4] NN/g_' },
      { kind: 'doc', slot: 'doc2', title: 'Rollout plan', text: '## Rollout\n\n- **Wk 1** — internal dogfood\n- **Wk 2** — 5% beta, watch crash-free\n- **Wk 3** — ramp to 50%\n- **Wk 4** — GA + changelog\n\n**Guardrail:** hold the ramp if crash-free < 99.5%.' },
      { kind: 'table', slot: 'table', columns: ['Tool', 'Saved views', 'Sharing', 'Defaults', 'Feel'], rows: [['Linear', 'Yes', 'Team', 'Yes', 'Fast'], ['Jira', 'Yes', 'Complex', 'Yes', 'Heavy'], ['Height', 'Partial', 'No', 'No', 'Simple'], ['Asana', 'Yes', 'Team', 'No', 'Busy'], ['Us', '—', '—', '—', 'the gap']] },
      { kind: 'table', slot: 'table2', columns: ['Idea', 'Effort', 'Impact', 'Bucket'], rows: [['Save view', 'S', 'H', 'Quick win'], ['Sharing', 'M', 'H', 'Big bet'], ['Team default', 'M', 'M', 'Fill-in'], ['Pinned tabs', 'L', 'L', 'Time sink']] },
      { kind: 'table', slot: 'table3', columns: ['Metric', 'Target', 'Now'], rows: [['Views saved / WAU', '30%', '—'], ['Shares per view', '0.4', '—'], ['Filter-reset bugs', '0', '12 / wk']] },
      { kind: 'diagram', slot: 'diagram', title: 'User flow', code: 'flowchart TD\n  A[Open list] --> B[Apply filters]\n  B --> C{Save?}\n  C -->|No| Z[Just browse]\n  C -->|Yes| D[Name view]\n  D --> E{Share?}\n  E -->|Private| F[My views]\n  E -->|Team| G[Team views]\n  G --> H{Set default?}\n  H -->|Yes| I[Team default]\n  H -->|No| F\n  F --> J[Reopen anytime]\n  I --> J' },
      { kind: 'diagram', slot: 'diagram2', title: 'Release ramp', code: 'flowchart LR\n  A[Dogfood] --> B[Beta 5%]\n  B --> C{Crash-free?}\n  C -->|No| D[Fix + hold]\n  D --> B\n  C -->|Yes| E[Ramp 50%]\n  E --> F[GA]' },
      { kind: 'link', slot: 'link', url: 'https://linear.app/docs/views', siteName: 'Linear', title: 'Custom views & filters', description: 'How Linear models saved, shareable views.' },
      { kind: 'link', slot: 'link2', url: 'https://support.atlassian.com/jira', siteName: 'Atlassian', title: 'JQL & saved filters', description: 'Jira’s filter + subscription model.' },
      { kind: 'link', slot: 'link3', url: 'https://height.app/changelog', siteName: 'Height', title: 'Views — changelog', description: 'How a lighter tool shipped views.' },
      { kind: 'link', slot: 'link4', url: 'https://www.nngroup.com/articles/persistence', siteName: 'NN/g', title: 'Persistent state in UX', description: 'Why remembering the user’s view matters.' },
      { kind: 'img', slot: 'img', src: 'wireframe', name: 'Feature wireframes' },
      { kind: 'pin', slot: 'note1', text: 'P0 — ship this first', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: '← the gap we own', anchor: 'table', corner: 'bl' },
      { kind: 'pin', slot: 'note3', text: 'measure week 1', anchor: 'table3', corner: 'tr' },
    ],
  },
  {
    name: 'Designers',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Designers\n\nSynthesize research, map the journey, and pressure-test the direction — scattered inputs become a board you build from.' },
      { kind: 'doc', slot: 'doc', title: 'Research synthesis', text: '## What we heard\n\n5 interviews · 2 usability tests · 1 diary study\n\n- **Onboarding is the cliff** — 3/5 dropped at “connect data”.\n- Users trust **templates** over a blank canvas.\n- “Where do I even start?” came up every session.\n- Power users want **keyboard-first** everything.\n\n**Direction:** lead with a template gallery, defer the blank canvas, and add a first-run checklist.' },
      { kind: 'doc', slot: 'research', title: 'Research notes', text: '## Field notes\n\n- P2, P4, P5 stalled at “connect data” [1].\n- Everyone asked “where do I start?” [1].\n- Template-first apps hit first-win < 1 min [2].\n- Heuristic pass: weak visibility + no undo [3].\n\n_[1] tests · [2] Baymard · [3] NN/g heuristics_' },
      { kind: 'doc', slot: 'doc2', title: 'Personas', text: '## Two personas\n\n**Maya · indie maker** — ships side projects, hates setup, lives in shortcuts.\n\n**Sam · team lead** — needs templates and sharing, cares about consistency.\n\nBoth open with: “where do I start?”' },
      { kind: 'table', slot: 'table', columns: ['App', 'Onboarding', 'First win', 'Empty state'], rows: [['Notion', 'Templates', '< 1 min', 'Guided'], ['Linear', 'Sample data', 'Fast', 'Clean'], ['Figma', 'Blank + tips', 'Slow', 'Sparse'], ['Ours', 'TBD', 'TBD', 'TBD']] },
      { kind: 'table', slot: 'table2', columns: ['Signal', 'Count', 'Move'], rows: [['Wants templates', '4/5', 'P0'], ['Confused start', '5/5', 'P0'], ['Likes shortcuts', '2/5', 'P2']] },
      { kind: 'table', slot: 'table3', columns: ['Heuristic', 'Score', 'Note'], rows: [['Visibility', '3/5', 'status unclear'], ['Error prevention', '2/5', 'no undo'], ['Consistency', '4/5', 'mostly ok'], ['Recognition', '3/5', 'hidden actions']] },
      { kind: 'diagram', slot: 'diagram', title: 'Journey map', code: 'flowchart TD\n  A[Discover] --> B[Landing]\n  B --> C{Sign up?}\n  C -->|No| X[Bounce]\n  C -->|Yes| D[Onboarding]\n  D --> E{Connect data?}\n  E -->|No| F[The cliff]\n  F --> G[Email nudge]\n  G --> E\n  E -->|Yes| H[First value]\n  H --> I{Return D2?}\n  I -->|Yes| J[Habit]\n  I -->|No| G' },
      { kind: 'diagram', slot: 'diagram2', title: 'Information architecture', code: 'flowchart LR\n  Home --> Templates\n  Home --> Canvas\n  Home --> Settings\n  Templates --> New[New board]\n  Canvas --> Share\n  Canvas --> Export' },
      { kind: 'link', slot: 'link', url: 'https://maze.co/reports/ux-research', siteName: 'Maze', title: 'Usability test readout', description: 'The 12-participant onboarding study.' },
      { kind: 'link', slot: 'link2', url: 'https://baymard.com/blog', siteName: 'Baymard', title: 'Onboarding UX benchmarks', description: 'What great first-runs have in common.' },
      { kind: 'link', slot: 'link3', url: 'https://dribbble.com/tags/onboarding', siteName: 'Dribbble', title: 'Onboarding references', description: 'Visual patterns worth stealing.' },
      { kind: 'link', slot: 'link4', url: 'https://lawsofux.com', siteName: 'Laws of UX', title: 'Heuristics & principles', description: 'Reference for the heuristic scoring.' },
      { kind: 'img', slot: 'img', src: 'storyboard', name: 'UX storyboard' },
      { kind: 'img', slot: 'img2', src: 'proxilexis', name: 'Concept board' },
      { kind: 'img', slot: 'img3', src: 'des-ui', name: 'UI reference' },
      { kind: 'pin', slot: 'note1', text: 'lead with templates', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'the cliff is here ↑', anchor: 'diagram', corner: 'bl' },
      { kind: 'pin', slot: 'note3', text: 'steal this pattern', anchor: 'img3', corner: 'tr' },
    ],
  },
  {
    name: 'Students & researchers',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Students & researchers\n\nDrop your sources and get a cited literature review, a concept map, and a study guide — grounded and traceable.' },
      { kind: 'doc', slot: 'doc', title: 'Literature review — Attention', text: '## Attention in NLP\n\nSelf-attention [1] reframed sequence modeling as fully parallel, removing recurrence and unlocking scale.\n\n- **Transformers** [1] — self-attention + positional encoding.\n- **BERT** [2] — bidirectional pretraining, fine-tuned per task.\n- **Scaling laws** [3] — loss falls predictably with compute.\n- **Emergence** [4] — new abilities appear past a scale threshold.\n\n_See sources for the primary papers; complexity is O(n²·d)._' },
      { kind: 'doc', slot: 'research', title: 'Research notes', text: '## Reading notes\n\n- [1] kills recurrence → full parallelism.\n- [2] bidirectional context beats left-to-right.\n- [3] loss ∝ compute^-α — predictable.\n- Open Q: why does emergence [4] appear abruptly?\n\n_Verify every claim against the primary paper._' },
      { kind: 'doc', slot: 'doc2', title: 'Study guide', text: '## Exam-ready\n\n- **Define** self-attention: softmax(QKᵀ/√d)·V.\n- **Contrast** RNN vs Transformer.\n- **Explain** why scaling helps [3].\n\n**Likely Q:** derive attention complexity → O(n²·d).' },
      { kind: 'table', slot: 'table', columns: ['Paper', 'Year', 'Key idea', 'Cited by'], rows: [['Attention Is All You Need', '2017', 'Transformer', '110k+'], ['BERT', '2018', 'Bidirectional', '90k+'], ['GPT-3', '2020', 'Few-shot', '30k+'], ['Scaling Laws', '2020', 'Compute→loss', '9k+']] },
      { kind: 'table', slot: 'table2', columns: ['Term', 'In one line'], rows: [['Self-attention', 'Tokens weigh each other'], ['Head', 'One attention pattern'], ['Pretraining', 'Learn before the task']] },
      { kind: 'table', slot: 'table3', columns: ['Year', 'Milestone'], rows: [['2014', 'Attention (Bahdanau)'], ['2017', 'Transformer'], ['2018', 'BERT / GPT'], ['2020', 'Scaling laws']] },
      { kind: 'diagram', slot: 'diagram', title: 'Concept map', code: 'flowchart TD\n  A[Attention] --> B[Self-attention]\n  A --> C[Cross-attention]\n  B --> D[Transformers]\n  D --> E[Encoder]\n  D --> F[Decoder]\n  E --> G[BERT]\n  F --> H[GPT]\n  D --> I[Scaling laws]\n  G --> J[Fine-tuning]\n  H --> J\n  I --> K[Emergent ability]' },
      { kind: 'diagram', slot: 'diagram2', title: 'Method lineage', code: 'flowchart LR\n  A[RNN] --> B[LSTM]\n  B --> C[Attention]\n  C --> D[Transformer]\n  D --> E[Pretrain + FT]' },
      { kind: 'link', slot: 'link', url: 'https://arxiv.org/abs/1706.03762', siteName: 'arXiv', title: 'Attention Is All You Need', description: 'Vaswani et al., 2017 — the Transformer.' },
      { kind: 'link', slot: 'link2', url: 'https://jalammar.github.io/illustrated-transformer', siteName: 'jalammar.github.io', title: 'The Illustrated Transformer', description: 'The canonical visual explainer.' },
      { kind: 'link', slot: 'link3', url: 'https://paperswithcode.com/method/transformer', siteName: 'Papers with Code', title: 'Transformer — leaderboard', description: 'Benchmarks and implementations.' },
      { kind: 'link', slot: 'link4', url: 'https://distill.pub', siteName: 'Distill', title: 'Visualizing attention', description: 'Interactive explainers worth citing.' },
      { kind: 'img', slot: 'img', src: 'radar', name: 'Fig — AI capability by job' },
      { kind: 'pin', slot: 'note1', text: 'cite every claim', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'start with [1]', anchor: 'link', corner: 'tl' },
      { kind: 'pin', slot: 'note3', text: 'exam: know O(n²·d)', anchor: 'doc2', corner: 'br' },
    ],
  },
  {
    name: 'Founders & strategists',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Founders & strategists\n\nSize the market, benchmark rivals, and stress-test the risks before you bet — one prompt, a whole strategy board.' },
      { kind: 'doc', slot: 'doc', title: 'Thesis — Ambient scribe', text: '## AI note-taker for clinicians\n\n**Wedge:** an ambient scribe for solo & small practices.\n\n- **Why now** — speech models are finally good enough; documentation burnout is peaking; reimbursement favors throughput.\n- **Moat** — specialty templates + EHR integrations + a data flywheel from corrections.\n- **Risk** — enterprise incumbents move down-market.\n\n**Ask:** $1.5M pre-seed to reach 50 paying clinics and prove retention.' },
      { kind: 'doc', slot: 'research', title: 'Research notes', text: '## Diligence notes\n\n- Speech WER now < 5% on medical audio [1].\n- Burnout: 2/3 of clinicians cite documentation [2].\n- Freed proves solo demand; thin templates [3].\n- Risk: DAX moves down-market on price [4].\n\n_[1] benchmark · [2] AMA · [3] Crunchbase · [4] a16z_' },
      { kind: 'doc', slot: 'doc2', title: 'Go-to-market', text: '## GTM\n\n- **Beachhead** — solo primary-care.\n- **Channel** — clinician communities + referrals.\n- **Price** — $99 / seat / mo, annual.\n\n**Motion:** PLG trial → onboarding call at activation.' },
      { kind: 'table', slot: 'table', columns: ['Layer', 'Who', 'Value'], rows: [['TAM', 'All US clinicians', '$12B'], ['SAM', 'Outpatient notes', '$3.4B'], ['SOM', 'Solo + small (yr 3)', '$260M']] },
      { kind: 'table', slot: 'table2', columns: ['Rival', 'Focus', 'Gap'], rows: [['Abridge', 'Hospitals', 'Not for solo'], ['Nuance DAX', 'Enterprise', 'Pricey'], ['Freed', 'Solo', 'Few templates']] },
      { kind: 'table', slot: 'table3', columns: ['Metric', 'Value'], rows: [['ACV', '$1.2k'], ['CAC', '$400'], ['Payback', '4 mo'], ['Gross margin', '82%']] },
      { kind: 'diagram', slot: 'diagram', title: 'Go-to-market loop', code: 'flowchart TD\n  A[Solo clinics] --> B[Free trial]\n  B --> C{Activated?}\n  C -->|No| D[Onboard call]\n  D --> C\n  C -->|Yes| E[Paid seat]\n  E --> F{Happy?}\n  F -->|Yes| G[Referral]\n  G --> A\n  F -->|No| H[Save / churn]' },
      { kind: 'diagram', slot: 'diagram2', title: 'Funnel', code: 'flowchart LR\n  A[1000 signups] --> B[600 activate]\n  B --> C[220 paid]\n  C --> D[180 retained]' },
      { kind: 'link', slot: 'link', url: 'https://rockhealth.com/insights', siteName: 'Rock Health', title: 'Digital health funding 2025', description: 'Where AI clinical tooling raised this year.' },
      { kind: 'link', slot: 'link2', url: 'https://a16z.com/tag/healthcare', siteName: 'a16z', title: 'AI in the clinic — thesis', description: 'The investor case for ambient AI.' },
      { kind: 'link', slot: 'link3', url: 'https://www.crunchbase.com/hub/ai-scribe', siteName: 'Crunchbase', title: 'AI scribe — funding rounds', description: 'Who raised, how much, when.' },
      { kind: 'link', slot: 'link4', url: 'https://www.cbinsights.com/research/digital-health', siteName: 'CB Insights', title: 'Digital health market map', description: 'Competitive landscape & funding.' },
      { kind: 'img', slot: 'img', src: 'stocks', name: 'The AI circle of money' },
      { kind: 'img', slot: 'img2', src: 'fnd-chart', name: 'Market size — 2022–2032' },
      { kind: 'pin', slot: 'note1', text: 'why now', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'biggest risk ↓', anchor: 'table2', corner: 'tr' },
      { kind: 'pin', slot: 'note3', text: '$25/seat ceiling', anchor: 'doc2', corner: 'br' },
    ],
  },
];

// Provenance edges by slot: sources → derived work, drawn as the product's own
// dotted lineage (every card stays selected below). Multi-hop CHAINS so the
// lineage reads as a real chain of work:
//   link → research → doc → diagram → diagram2   (the main research chain)
//   img3 → table2 → doc2 → table3                (a second chain)
const PROV: [string, string[]][] = [
  ['research', ['link', 'link2', 'link4']],
  ['table', ['link', 'link3']],
  ['doc', ['research', 'table']],
  ['diagram', ['doc']],
  ['diagram2', ['diagram']],
  ['table2', ['img3', 'link2']],
  ['doc2', ['table2']],
  ['table3', ['doc2', 'table']],
];
const SLOT_TYPE: Record<string, string> = {
  table: 'table-card', table2: 'table-card', table3: 'table-card',
  doc: 'doc-card', doc2: 'doc-card', research: 'doc-card',
  diagram: 'diagram-card', diagram2: 'diagram-card',
};

// Reading order the masonry consumes cards in (only slots that exist are used).
// desc (the use-case description) leads; notes are pinned separately.
const FLOW_ORDER = [
  'desc', 'doc', 'research', 'table', 'diagram', 'link', 'table2', 'img',
  'diagram2', 'table3', 'link2', 'img2', 'link3', 'img3', 'link4', 'doc2',
];

const COLS = 4;
const GUTTER = 64; // horizontal space between columns
const BASE_GAP = 40; // minimum vertical space between stacked cards
const TARGET_ASPECT = 1.78; // ≈ the stage viewport, so each region fills it
const COL_TOP = -700;
const BOTTOM_BAND = 110; // clear space below the cards for the controller

interface FlowCard { id: TLShapeId; type: string; w: number; h: number }
interface PinCard { id: TLShapeId; anchor: string; corner: Corner }

export function EmbedUseCases() {
  const editor = useEditor();
  const framesRef = useRef<Box[]>([]);
  const idxRef = useRef(0);

  useEffect(() => {
    const existing = [...editor.getCurrentPageShapeIds()];
    if (existing.length) editor.deleteShapes(existing);

    const regions: { cx: number; bySlot: Record<string, TLShapeId>; pins: PinCard[] }[] = [];
    const allIds: TLShapeId[] = [];
    PERSONAS.forEach((persona, i) => {
      const cx = i * REGION_GAP;
      const bySlot: Record<string, TLShapeId> = {};
      const pins: PinCard[] = [];
      for (const card of persona.cards) {
        const id = createShapeId();
        bySlot[card.slot] = id;
        allIds.push(id);
        const x = cx;
        const y = COL_TOP; // rough; reflow repositions once heights settle
        if (card.kind === 'note') {
          editor.createShape({ id, type: 'note-card', x, y, props: { w: W[card.slot] ?? 320, h: H0[card.slot] ?? 140, text: card.text, color: '' } });
        } else if (card.kind === 'pin') {
          pins.push({ id, anchor: card.anchor, corner: card.corner });
          editor.createShape({ id, type: 'note-card', x, y, props: { w: NOTE_W, h: NOTE_H, text: card.text, color: '' } });
        } else if (card.kind === 'doc') {
          editor.createShape({ id, type: 'doc-card', x, y, props: { w: W[card.slot] ?? 460, h: H0[card.slot] ?? 300, title: card.title, text: card.text } });
        } else if (card.kind === 'table') {
          editor.createShape({ id, type: 'table-card', x, y, props: { w: W[card.slot] ?? 540, h: H0[card.slot] ?? 200, columns: card.columns, rows: card.rows } });
        } else if (card.kind === 'diagram') {
          editor.createShape({ id, type: 'diagram-card', x, y, props: { w: W[card.slot] ?? 580, h: H0[card.slot] ?? 400, title: card.title, code: card.code } });
        } else if (card.kind === 'link') {
          editor.createShape({ id, type: 'link-card', x, y, props: { w: W[card.slot] ?? 460, h: H0[card.slot] ?? 150, url: card.url, title: card.title, description: card.description, image: '', favicon: '', siteName: card.siteName, loading: false } });
        } else if (card.kind === 'img') {
          const w = W[card.slot] ?? 480;
          editor.createShape({ id, type: 'image-card', x, y, props: { w, h: H0[card.slot] ?? Math.round(w * 0.66), src: IMG(card.src), name: card.name } });
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
      regions.push({ cx, bySlot, pins });
    });
    editor.setSelectedShapes(allIds);
    // Rough initial frame to avoid a flash; the reflow re-frames once the
    // auto-growing cards (docs, tables, diagrams) have settled their heights.
    editor.zoomToBounds(new Box(-1400, -700, 2800, 1500), { inset: 24, animation: { duration: 0 } });

    // Lay out each region AFTER heights settle: a balanced column masonry sized
    // to the stage's wide aspect so the workspace fills the frame side-to-side.
    // Run a few times because Mermaid renders asynchronously; each pass re-reads
    // settled heights.
    const reflow = () => {
      const newFrames: Box[] = [];
      for (const { cx, bySlot, pins } of regions) {
        // Gather flow cards in reading order with their ACTUAL sizes.
        const flow: FlowCard[] = [];
        for (const slot of FLOW_ORDER) {
          const id = bySlot[slot];
          if (!id) continue;
          const shape = editor.getShape(id);
          if (!shape) continue;
          const b = editor.getShapePageBounds(id);
          flow.push({ id, type: shape.type, w: b ? b.w : W[slot] ?? 460, h: b ? b.h : H0[slot] ?? 240 });
        }
        if (!flow.length) continue;

        // Balanced masonry: drop each card into the currently shortest column.
        const colH = new Array<number>(COLS).fill(0);
        const colItems: FlowCard[][] = Array.from({ length: COLS }, () => []);
        for (const c of flow) {
          let k = 0;
          for (let j = 1; j < COLS; j++) if (colH[j]! < colH[k]!) k = j;
          colItems[k]!.push(c);
          colH[k]! += c.h + BASE_GAP;
        }

        const pitch = Math.max(...flow.map((c) => c.w)) + GUTTER;
        const boardW = COLS * pitch - GUTTER;
        const left = cx - boardW / 2;
        // Stretch columns toward a wide target height so the region fills the
        // stage vertically too — but only gently (masonry already balanced the
        // columns, so the added gap is small and even, never a broken void).
        const targetH = boardW / TARGET_ASPECT;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        colItems.forEach((items, k) => {
          if (!items.length) return;
          const contentH = items.reduce((s, c) => s + c.h, 0);
          const gaps = Math.max(1, items.length - 1);
          let gap = BASE_GAP;
          if (contentH + BASE_GAP * gaps < targetH) gap = (targetH - contentH) / gaps;
          gap = Math.min(gap, 190);
          const x = left + k * pitch;
          let y = COL_TOP;
          for (const c of items) {
            editor.updateShape({ id: c.id, type: c.type, x, y } as Parameters<typeof editor.updateShape>[0]);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + c.w);
            maxY = Math.max(maxY, y + c.h);
            y += c.h + gap;
          }
        });

        // Pin each sticky onto the corner of the card it annotates, overlapping
        // slightly like a real sticky slapped on the board.
        const OVER = 22;
        for (const pin of pins) {
          const ab = editor.getShapePageBounds(pin.anchor ? bySlot[pin.anchor] ?? pin.id : pin.id);
          if (!ab) continue;
          let nx: number, ny: number;
          switch (pin.corner) {
            case 'tl': nx = ab.x - NOTE_W + OVER; ny = ab.y - NOTE_H + OVER; break;
            case 'br': nx = ab.x + ab.w - OVER; ny = ab.y + ab.h - OVER; break;
            case 'bl': nx = ab.x - NOTE_W + OVER; ny = ab.y + ab.h - OVER; break;
            default: nx = ab.x + ab.w - OVER; ny = ab.y - NOTE_H + OVER; break; // 'tr'
          }
          editor.updateShape({ id: pin.id, type: 'note-card', x: nx, y: ny } as Parameters<typeof editor.updateShape>[0]);
          minX = Math.min(minX, nx);
          minY = Math.min(minY, ny);
          maxX = Math.max(maxX, nx + NOTE_W);
          maxY = Math.max(maxY, ny + NOTE_H);
        }

        const pad = 56;
        newFrames.push(new Box(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2 + BOTTOM_BAND));
      }
      framesRef.current = newFrames;
      const frame = newFrames[idxRef.current];
      if (frame) editor.zoomToBounds(frame, { inset: 16, animation: { duration: 0 } });
    };
    const timers = [350, 900, 1600, 2600].map((ms) => window.setTimeout(reflow, ms));

    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const flyTo = (next: number) => {
    const frames = framesRef.current;
    if (!frames.length) return;
    const n = (next + frames.length) % frames.length;
    idxRef.current = n;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    editor.zoomToBounds(frames[n]!, { inset: 16, animation: { duration: reduce ? 0 : 950 } });
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
