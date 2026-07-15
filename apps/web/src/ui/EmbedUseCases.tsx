/**
 * The use-cases canvas (?usecases=1) — the marketing site's "one canvas, shaped
 * to the job" section. One big board holds SIX deliberately dense, messy
 * workspaces, one per product use case (build a product, research a topic,
 * design an experience, plan a trip, prepare a talk, make a decision). Each is
 * built from REAL card shapes — docs, tables, diagrams, source links, images,
 * and the newer cards the product now ships: a live MAP itinerary, an
 * interactive DASHBOARD, a LIVE PROTOTYPE, and an embedded VIDEO — with sticky
 * notes annotating the board, all wired with the product's own dotted
 * provenance lineage. A bare Next/Back arrow controller flies the camera
 * between workspaces.
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
interface Stop { name: string; query: string; lat: number; lng: number; day?: string; time?: string; note?: string }
type CardSpec =
  | { kind: 'note'; slot: string; text: string }
  | { kind: 'pin'; slot: string; text: string; anchor: string; corner: Corner }
  | { kind: 'doc'; slot: string; title: string; text: string }
  | { kind: 'table'; slot: string; columns: string[]; rows: string[][] }
  | { kind: 'diagram'; slot: string; title: string; code: string }
  | { kind: 'link'; slot: string; url: string; siteName: string; title: string; description: string }
  | { kind: 'img'; slot: string; src: string; name: string }
  | { kind: 'map'; slot: string; title: string; intro: string; ordered: boolean; stops: Stop[] }
  | { kind: 'dashboard'; slot: string; title: string; spec: string }
  | { kind: 'prototype'; slot: string; title: string; html: string }
  | { kind: 'video'; slot: string; videoId: string; url: string; title: string };

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
  link: 460, link2: 460, link3: 460, link4: 460, link5: 460,
  img: 500, img2: 460, img3: 440,
  map: 540, dashboard: 560, prototype: 460, video: 440,
};
const H0: Record<string, number> = {
  desc: 150,
  doc: 380, doc2: 260, research: 280,
  table: 210, table2: 200, table3: 200,
  diagram: 420, diagram2: 260,
  link: 150, link2: 150, link3: 150, link4: 150, link5: 150,
  img: 330, img2: 300, img3: 300,
  map: 360, dashboard: 440, prototype: 400, video: 300,
};
const NOTE_W = 210;
const NOTE_H = 96;

const REGION_GAP = 4200;

// A self-contained UI mockup for the design board's live prototype card. It
// renders inside a sandboxed iframe (allow-scripts, no network), so everything
// is inline — no external CSS, fonts, or assets.
const TEMPLATE_GALLERY_HTML = `<div style="font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;height:100%;box-sizing:border-box;padding:22px;background:#faf9f7;color:#1c1a17">
  <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a29c90;margin-bottom:6px">New board</div>
  <div style="font-size:21px;font-weight:650;margin-bottom:3px">Start from a template</div>
  <div style="font-size:12px;color:#78726a;margin-bottom:16px">Pick a starting point — you can always start blank.</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
    <div style="border:1px solid #e7e3db;border-radius:12px;padding:13px;background:#fff">
      <div style="font-size:22px">🎯</div>
      <div style="font-weight:600;margin-top:7px;font-size:13px">Problem → Bets</div>
      <div style="font-size:11px;color:#8a847a;margin-top:2px">Frame the space, place your bets</div>
    </div>
    <div style="border:1px solid #e7e3db;border-radius:12px;padding:13px;background:#fff">
      <div style="font-size:22px">🗺️</div>
      <div style="font-weight:600;margin-top:7px;font-size:13px">User journey</div>
      <div style="font-size:11px;color:#8a847a;margin-top:2px">Map the flow end to end</div>
    </div>
    <div style="border:1px solid #e7e3db;border-radius:12px;padding:13px;background:#fff">
      <div style="font-size:22px">🔍</div>
      <div style="font-weight:600;margin-top:7px;font-size:13px">Research wall</div>
      <div style="font-size:11px;color:#8a847a;margin-top:2px">Cluster notes into themes</div>
    </div>
    <div style="border:1px solid #1c1a17;border-radius:12px;padding:13px;background:#1c1a17;color:#faf9f7">
      <div style="font-size:22px">＋</div>
      <div style="font-weight:600;margin-top:7px;font-size:13px">Blank canvas</div>
      <div style="font-size:11px;color:#b9b3a8;margin-top:2px">Start from nothing</div>
    </div>
  </div>
</div>`;

// A product-metrics dashboard (OpenUI Lang — rendered 100% client-side by the
// dashboard card's offline reconciler; see apps/web/src/dashboard/library.tsx).
const LAUNCH_DASH = `root = Stack([kpis, charts, tbl], "column")
kpis = Grid([k1, k2, k3, k4], 4)
k1 = Kpi("Views saved / WAU", "27%", "target 30%")
k2 = Kpi("Shares per view", "0.38", "+0.38")
k3 = Kpi("Filter-reset bugs", "0", "-12 / wk")
k4 = Kpi("Crash-free", "99.7%", "+0.2%")
charts = Grid([bar, line], 2)
bar = BarChart("Adoption by week", ["Wk1","Wk2","Wk3","Wk4"], [4, 11, 19, 27])
line = LineChart("Weekly active savers", ["Wk1","Wk2","Wk3","Wk4"], [120, 340, 610, 880])
tbl = Card("Rollout gates", [t1])
t1 = Table(["Stage","Traffic","Crash-free","Go/No-go"], [["Dogfood","internal","100%","Go"],["Beta","5%","99.6%","Go"],["Ramp","50%","99.7%","Go"],["GA","100%","-","Pending"]])`;

// A build-vs-buy decision scorecard.
const DECISION_DASH = `root = Stack([kpis, charts, tbl], "column")
kpis = Grid([k1, k2, k3], 3)
k1 = Kpi("Recommended", "Buy · PostHog", "")
k2 = Kpi("3-yr cost", "$142k", "vs $410k build")
k3 = Kpi("Time to value", "2 wks", "vs 5 mo build")
charts = Grid([bar], 1)
bar = BarChart("Weighted score / 100", ["Build","Amplitude","PostHog"], [61, 74, 83])
tbl = Card("Scorecard", [t1])
t1 = Table(["Criterion","Weight","Build","Amplitude","PostHog"], [["Cost","30","6","7","9"],["Speed","25","4","9","9"],["Flexibility","20","10","5","7"],["Data ownership","15","10","4","8"],["Maintenance","10","3","9","8"]])`;

const PERSONAS: Persona[] = [
  {
    name: 'Building a product',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Building a product\n\nBreak a launch into a plan — the PRD, the competitive read, the flow, and the metrics that tell you it worked.' },
      { kind: 'doc', slot: 'doc', title: 'PRD — Saved Views', text: '## Saved Views\n\n**Problem.** Power users rebuild the same filters every day; the reset bug loses them mid-session.\n\n**Goal.** Save a filter set once, reopen and share it.\n\n- **P0** — save, name, reopen a view\n- **P1** — share with a teammate\n- **P2** — set a team default\n\n**Non-goals.** Cross-project views, per-view notifications.\n\n**Open questions.** Do shared views inherit permissions? What happens on a deleted field?\n\n**Success:** 30% of weekly actives save a view within 30 days.' },
      { kind: 'doc', slot: 'research', title: 'Research notes', text: '## What we found\n\n- Users rebuild the same 3–4 filters daily [1].\n- The reset bug clears views on refresh — 12 reports / wk [2].\n- Linear ships shareable team views; Jira over-complicates it [3].\n- Nielsen: persistent state cuts repeat cognitive load [4].\n\n_[1] interviews · [2] support · [3] Linear docs · [4] NN/g_' },
      { kind: 'doc', slot: 'doc2', title: 'Rollout plan', text: '## Rollout\n\n- **Wk 1** — internal dogfood\n- **Wk 2** — 5% beta, watch crash-free\n- **Wk 3** — ramp to 50%\n- **Wk 4** — GA + changelog\n\n**Guardrail:** hold the ramp if crash-free < 99.5%.' },
      { kind: 'table', slot: 'table', columns: ['Tool', 'Saved views', 'Sharing', 'Defaults', 'Feel'], rows: [['Linear', 'Yes', 'Team', 'Yes', 'Fast'], ['Jira', 'Yes', 'Complex', 'Yes', 'Heavy'], ['Height', 'Partial', 'No', 'No', 'Simple'], ['Asana', 'Yes', 'Team', 'No', 'Busy'], ['Us', '—', '—', '—', 'the gap']] },
      { kind: 'table', slot: 'table2', columns: ['Idea', 'Effort', 'Impact', 'Bucket'], rows: [['Save view', 'S', 'H', 'Quick win'], ['Sharing', 'M', 'H', 'Big bet'], ['Team default', 'M', 'M', 'Fill-in'], ['Pinned tabs', 'L', 'L', 'Time sink']] },
      { kind: 'dashboard', slot: 'dashboard', title: 'Launch metrics', spec: LAUNCH_DASH },
      { kind: 'diagram', slot: 'diagram', title: 'User flow', code: 'flowchart TD\n  A[Open list] --> B[Apply filters]\n  B --> C{Save?}\n  C -->|No| Z[Just browse]\n  C -->|Yes| D[Name view]\n  D --> E{Share?}\n  E -->|Private| F[My views]\n  E -->|Team| G[Team views]\n  G --> H{Set default?}\n  H -->|Yes| I[Team default]\n  H -->|No| F\n  F --> J[Reopen anytime]\n  I --> J' },
      { kind: 'diagram', slot: 'diagram2', title: 'Release ramp', code: 'flowchart LR\n  A[Dogfood] --> B[Beta 5%]\n  B --> C{Crash-free?}\n  C -->|No| D[Fix + hold]\n  D --> B\n  C -->|Yes| E[Ramp 50%]\n  E --> F[GA]' },
      { kind: 'link', slot: 'link', url: 'https://linear.app/docs/views', siteName: 'Linear', title: 'Custom views & filters', description: 'How Linear models saved, shareable views.' },
      { kind: 'link', slot: 'link2', url: 'https://support.atlassian.com/jira', siteName: 'Atlassian', title: 'JQL & saved filters', description: 'Jira’s filter + subscription model.' },
      { kind: 'link', slot: 'link3', url: 'https://height.app/changelog', siteName: 'Height', title: 'Views — changelog', description: 'How a lighter tool shipped views.' },
      { kind: 'img', slot: 'img', src: 'wireframe', name: 'Feature wireframes' },
      { kind: 'pin', slot: 'note1', text: 'P0 — ship this first', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: '← the gap we own', anchor: 'table', corner: 'bl' },
      { kind: 'pin', slot: 'note3', text: 'watch week 1', anchor: 'dashboard', corner: 'tr' },
    ],
  },
  {
    name: 'Researching a topic',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Researching a topic\n\nDrop your sources — papers, talks, links — and get a cited literature review, a concept map, and a study guide, every claim traceable.' },
      { kind: 'doc', slot: 'doc', title: 'Literature review — Attention', text: '## Attention in NLP\n\nSelf-attention [1] reframed sequence modeling as fully parallel, removing recurrence and unlocking scale.\n\n- **Transformers** [1] — self-attention + positional encoding.\n- **BERT** [2] — bidirectional pretraining, fine-tuned per task.\n- **Scaling laws** [3] — loss falls predictably with compute.\n- **Emergence** [4] — new abilities appear past a scale threshold.\n\n_See sources for the primary papers; complexity is O(n²·d)._' },
      { kind: 'doc', slot: 'research', title: 'Reading notes', text: '## Reading notes\n\n- [1] kills recurrence → full parallelism.\n- [2] bidirectional context beats left-to-right.\n- [3] loss ∝ compute^-α — predictable.\n- Open Q: why does emergence [4] appear abruptly?\n\n_Verify every claim against the primary paper._' },
      { kind: 'doc', slot: 'doc2', title: 'Study guide', text: '## Exam-ready\n\n- **Define** self-attention: softmax(QKᵀ/√d)·V.\n- **Contrast** RNN vs Transformer.\n- **Explain** why scaling helps [3].\n\n**Likely Q:** derive attention complexity → O(n²·d).' },
      { kind: 'table', slot: 'table', columns: ['Paper', 'Year', 'Key idea', 'Cited by'], rows: [['Attention Is All You Need', '2017', 'Transformer', '110k+'], ['BERT', '2018', 'Bidirectional', '90k+'], ['GPT-3', '2020', 'Few-shot', '30k+'], ['Scaling Laws', '2020', 'Compute→loss', '9k+']] },
      { kind: 'table', slot: 'table2', columns: ['Term', 'In one line'], rows: [['Self-attention', 'Tokens weigh each other'], ['Head', 'One attention pattern'], ['Pretraining', 'Learn before the task']] },
      { kind: 'diagram', slot: 'diagram', title: 'Concept map', code: 'flowchart TD\n  A[Attention] --> B[Self-attention]\n  A --> C[Cross-attention]\n  B --> D[Transformers]\n  D --> E[Encoder]\n  D --> F[Decoder]\n  E --> G[BERT]\n  F --> H[GPT]\n  D --> I[Scaling laws]\n  G --> J[Fine-tuning]\n  H --> J\n  I --> K[Emergent ability]' },
      { kind: 'diagram', slot: 'diagram2', title: 'Method lineage', code: 'flowchart LR\n  A[RNN] --> B[LSTM]\n  B --> C[Attention]\n  C --> D[Transformer]\n  D --> E[Pretrain + FT]' },
      { kind: 'video', slot: 'video', videoId: 'eMlx5fFNoYc', url: 'https://www.youtube.com/watch?v=eMlx5fFNoYc', title: 'Attention in transformers, visually explained — 3Blue1Brown' },
      { kind: 'link', slot: 'link', url: 'https://arxiv.org/abs/1706.03762', siteName: 'arXiv', title: 'Attention Is All You Need', description: 'Vaswani et al., 2017 — the Transformer.' },
      { kind: 'link', slot: 'link2', url: 'https://jalammar.github.io/illustrated-transformer', siteName: 'jalammar.github.io', title: 'The Illustrated Transformer', description: 'The canonical visual explainer.' },
      { kind: 'link', slot: 'link3', url: 'https://paperswithcode.com/method/transformer', siteName: 'Papers with Code', title: 'Transformer — leaderboard', description: 'Benchmarks and implementations.' },
      { kind: 'img', slot: 'img', src: 'radar', name: 'Fig — AI capability by job' },
      { kind: 'pin', slot: 'note1', text: 'cite every claim', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'start with [1]', anchor: 'link', corner: 'tl' },
      { kind: 'pin', slot: 'note3', text: 'watch this first', anchor: 'video', corner: 'tr' },
    ],
  },
  {
    name: 'Designing an experience',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Designing an experience\n\nSynthesize the research, map the journey, and pressure-test a direction — then prototype it live, right on the board.' },
      { kind: 'doc', slot: 'doc', title: 'Research synthesis', text: '## What we heard\n\n5 interviews · 2 usability tests · 1 diary study\n\n- **Onboarding is the cliff** — 3/5 dropped at “connect data”.\n- Users trust **templates** over a blank canvas.\n- “Where do I even start?” came up every session.\n- Power users want **keyboard-first** everything.\n\n**Direction:** lead with a template gallery, defer the blank canvas, and add a first-run checklist.' },
      { kind: 'doc', slot: 'research', title: 'Field notes', text: '## Field notes\n\n- P2, P4, P5 stalled at “connect data” [1].\n- Everyone asked “where do I start?” [1].\n- Template-first apps hit first-win < 1 min [2].\n- Heuristic pass: weak visibility + no undo [3].\n\n_[1] tests · [2] Baymard · [3] NN/g heuristics_' },
      { kind: 'doc', slot: 'doc2', title: 'Personas', text: '## Two personas\n\n**Maya · indie maker** — ships side projects, hates setup, lives in shortcuts.\n\n**Sam · team lead** — needs templates and sharing, cares about consistency.\n\nBoth open with: “where do I start?”' },
      { kind: 'table', slot: 'table', columns: ['App', 'Onboarding', 'First win', 'Empty state'], rows: [['Notion', 'Templates', '< 1 min', 'Guided'], ['Linear', 'Sample data', 'Fast', 'Clean'], ['Figma', 'Blank + tips', 'Slow', 'Sparse'], ['Ours', 'TBD', 'TBD', 'TBD']] },
      { kind: 'table', slot: 'table2', columns: ['Signal', 'Count', 'Move'], rows: [['Wants templates', '4/5', 'P0'], ['Confused start', '5/5', 'P0'], ['Likes shortcuts', '2/5', 'P2']] },
      { kind: 'diagram', slot: 'diagram', title: 'Journey map', code: 'flowchart TD\n  A[Discover] --> B[Landing]\n  B --> C{Sign up?}\n  C -->|No| X[Bounce]\n  C -->|Yes| D[Onboarding]\n  D --> E{Connect data?}\n  E -->|No| F[The cliff]\n  F --> G[Email nudge]\n  G --> E\n  E -->|Yes| H[First value]\n  H --> I{Return D2?}\n  I -->|Yes| J[Habit]\n  I -->|No| G' },
      { kind: 'prototype', slot: 'prototype', title: 'Onboarding — template gallery', html: TEMPLATE_GALLERY_HTML },
      { kind: 'link', slot: 'link', url: 'https://maze.co/reports/ux-research', siteName: 'Maze', title: 'Usability test readout', description: 'The 12-participant onboarding study.' },
      { kind: 'link', slot: 'link2', url: 'https://baymard.com/blog', siteName: 'Baymard', title: 'Onboarding UX benchmarks', description: 'What great first-runs have in common.' },
      { kind: 'img', slot: 'img', src: 'storyboard', name: 'UX storyboard' },
      { kind: 'img', slot: 'img2', src: 'des-ui', name: 'UI reference' },
      { kind: 'img', slot: 'img3', src: 'proxilexis', name: 'Concept board' },
      { kind: 'pin', slot: 'note1', text: 'lead with templates', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'the cliff is here ↑', anchor: 'diagram', corner: 'bl' },
      { kind: 'pin', slot: 'note3', text: 'ship this screen', anchor: 'prototype', corner: 'tr' },
    ],
  },
  {
    name: 'Planning a trip',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Planning a trip\n\nDrop a place and your dates — get a day-by-day itinerary on a real map, places to stay compared, and everything you saved in one plan.' },
      { kind: 'map', slot: 'map', title: 'Kyoto in 3 days', intro: 'Grouped by district so each day stays walkable — east Kyoto, then Arashiyama, then downtown.', ordered: true, stops: [
        { name: 'Fushimi Inari Taisha', query: 'Fushimi Inari Taisha, Kyoto, Japan', lat: 34.9671, lng: 135.7727, day: 'Day 1', time: '8:00 AM', note: 'Go early — the torii tunnels empty out before 9.' },
        { name: 'Kiyomizu-dera', query: 'Kiyomizu-dera, Kyoto, Japan', lat: 34.9949, lng: 135.7851, day: 'Day 1', time: '1:00 PM', note: 'Walk up through Higashiyama’s old lanes.' },
        { name: 'Gion', query: 'Gion, Kyoto, Japan', lat: 35.0037, lng: 135.7752, day: 'Day 1', time: '6:00 PM', note: 'Dusk is best for the lantern-lit streets.' },
        { name: 'Arashiyama Bamboo Grove', query: 'Arashiyama Bamboo Grove, Kyoto, Japan', lat: 35.0170, lng: 135.6717, day: 'Day 2', time: '9:00 AM', note: 'First train beats the crowds and the heat.' },
        { name: 'Kinkaku-ji', query: 'Kinkaku-ji, Kyoto, Japan', lat: 35.0394, lng: 135.7292, day: 'Day 2', time: '2:00 PM', note: 'The Golden Pavilion — 40 min is plenty.' },
        { name: 'Nishiki Market', query: 'Nishiki Market, Kyoto, Japan', lat: 35.0050, lng: 135.7649, day: 'Day 3', time: '11:00 AM', note: 'Graze lunch stall by stall.' },
      ] },
      { kind: 'doc', slot: 'doc', title: 'Day-by-day', text: '## 3 days in Kyoto\n\n**Day 1 · East Kyoto**\n- Fushimi Inari at dawn, then Kiyomizu-dera\n- Wander Higashiyama down to Gion for dusk\n\n**Day 2 · Arashiyama**\n- Bamboo grove first thing, Tenryu-ji garden\n- Afternoon at Kinkaku-ji\n\n**Day 3 · Downtown**\n- Nishiki Market lunch, then Pontocho\n- Slow morning, late train out\n\n_Base near Kyoto Station or Karasuma for the shortest hops._' },
      { kind: 'doc', slot: 'doc2', title: 'Budget & tips', text: '## Rough budget (per person)\n\n- **Stay** — €140/night × 3\n- **Trains** — €25 local + IC card\n- **Food** — €35/day, easy\n\n**Tips.** Cash still rules small shops. Temples close ~5pm. A 1-day bus pass pays off by the third ride.' },
      { kind: 'table', slot: 'table', columns: ['Area', 'Vibe', '€/night', 'Best for'], rows: [['Kyoto Station', 'Connected, modern', '€120', 'First trip, day trips'], ['Gion / Higashiyama', 'Traditional, quiet', '€180', 'Atmosphere, walkability'], ['Karasuma / Downtown', 'Central, lively', '€140', 'Food & nightlife'], ['Arashiyama', 'Leafy, remote', '€160', 'Slow mornings']] },
      { kind: 'table', slot: 'table2', columns: ['Getting around', 'Covers', 'Cost'], rows: [['City bus', 'Temples, center', '€2 / ride'], ['Subway', 'N–S, E–W lines', '€2–3'], ['JR train', 'Inari, Arashiyama', 'Pass'], ['Walk', 'Higashiyama', '—']] },
      { kind: 'diagram', slot: 'diagram', title: 'Days at a glance', code: 'flowchart LR\n  A[Day 1 · East Kyoto] --> B[Day 2 · Arashiyama]\n  B --> C[Day 3 · Downtown]' },
      { kind: 'link', slot: 'link5', url: 'https://www.klook.com/en-US/city/20-kyoto-things-to-do', siteName: 'Klook', title: 'Kyoto experiences', description: 'Tea ceremony, kimono rental, day tours.' },
      { kind: 'link', slot: 'link', url: 'https://www.booking.com/city/jp/kyoto.html', siteName: 'Booking.com', title: 'Kyoto stays', description: 'Ryokan and hotels by district.' },
      { kind: 'link', slot: 'link2', url: 'https://www.japan-guide.com/e/e2158.html', siteName: 'japan-guide.com', title: 'Kyoto travel guide', description: 'The definitive area-by-area guide.' },
      { kind: 'link', slot: 'link3', url: 'https://www.japanrailpass.net', siteName: 'japanrailpass.net', title: 'JR Pass', description: 'Worth it if you day-trip beyond the city.' },
      { kind: 'link', slot: 'link4', url: 'https://www.timeout.com/kyoto/restaurants', siteName: 'Time Out', title: 'Where to eat in Kyoto', description: 'Kaiseki to conveyor-belt sushi.' },
      { kind: 'pin', slot: 'note1', text: 'book Inari for dawn', anchor: 'map', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'best value ↑', anchor: 'table', corner: 'bl' },
      { kind: 'pin', slot: 'note3', text: 'buy before you fly', anchor: 'link3', corner: 'br' },
    ],
  },
  {
    name: 'Preparing a talk',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Preparing a talk\n\nGo from a rough idea to a talk that lands — the narrative arc, the storyboard, the three things they’ll remember, and a reference to study.' },
      { kind: 'doc', slot: 'doc', title: 'Talk outline', text: '## Designing for trust (18 min)\n\n**Hook.** The screenshot of the moment a user almost bailed.\n\n**Problem.** Trust is spent before the first click — and we design as if it’s earned after.\n\n**Turn.** Three cheap signals that buy it back: honest empty states, undo everywhere, showing your work.\n\n**Proof.** The onboarding rebuild — drop-off fell 62% → 34%.\n\n**Close.** Trust is a design material. Spend it on purpose.' },
      { kind: 'doc', slot: 'doc2', title: 'Three takeaways', text: '## They should leave with\n\n1. **Trust is spent, not earned** — front-load the signals.\n2. **Undo is a trust feature** — not a nice-to-have.\n3. **Show your work** — provenance beats polish.\n\n_If they remember one line: “trust is a design material.”_' },
      { kind: 'doc', slot: 'research', title: 'Audience notes', text: '## Room & audience\n\n- ~200 designers + PMs, post-lunch slot.\n- They’ve *heard* “build trust” — give them the mechanics.\n- Projector is 16:9, no confidence monitor — rehearse blind.\n\n_Cut the second case study if we run long._' },
      { kind: 'diagram', slot: 'diagram', title: 'Narrative arc', code: 'flowchart LR\n  A[Hook] --> B[Problem]\n  B --> C[Turn]\n  C --> D[Proof]\n  D --> E[Close]\n  E --> F[One line they keep]' },
      { kind: 'table', slot: 'table', columns: ['#', 'Slide', 'Beat', 'Time'], rows: [['1', 'Cold open', 'Hook', '1m'], ['2–4', 'The trust gap', 'Problem', '4m'], ['5–8', 'Three signals', 'Turn', '6m'], ['9–11', 'Rebuild results', 'Proof', '4m'], ['12', 'One line', 'Close', '2m']] },
      { kind: 'table', slot: 'table2', columns: ['Dry-run check', 'Status'], rows: [['Timed under 18m', '✓'], ['Demo works offline', '✓'], ['Backup PDF on USB', '—'], ['Q&A prompts ready', '✓']] },
      { kind: 'video', slot: 'video', videoId: 'qp0HIF3SfI4', url: 'https://www.youtube.com/watch?v=qp0HIF3SfI4', title: 'How great leaders inspire action — Simon Sinek' },
      { kind: 'img', slot: 'img', src: 'storyboard', name: 'Slide storyboard' },
      { kind: 'link', slot: 'link', url: 'https://www.ted.com/participate/organize-a-local-tedx-event/tedx-organizer-guide/speakers-program/prepare-your-speaker', siteName: 'TED', title: 'How to give a great talk', description: 'TED’s own speaker guide.' },
      { kind: 'link', slot: 'link2', url: 'https://www.duarte.com/slideology', siteName: 'Duarte', title: 'slide:ology', description: 'The reference on visual storytelling.' },
      { kind: 'link', slot: 'link3', url: 'https://speaking.io', siteName: 'speaking.io', title: 'Talk delivery tips', description: 'Practical advice on presence and pacing.' },
      { kind: 'pin', slot: 'note1', text: 'open with the pain', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'land these three', anchor: 'doc2', corner: 'br' },
      { kind: 'pin', slot: 'note3', text: 'study the pacing', anchor: 'video', corner: 'tr' },
    ],
  },
  {
    name: 'Making a decision',
    cards: [
      { kind: 'note', slot: 'desc', text: 'Making a decision\n\nLay the options side by side, weigh what matters, and see the trade-offs — a scorecard, a decision tree, and a recommendation you can defend.' },
      { kind: 'doc', slot: 'doc', title: 'Recommendation', text: '## Buy PostHog\n\n**The call.** Buy PostHog now; revisit build at 10× scale.\n\n- **Why** — 2 weeks to value vs 5 months; $142k vs $410k over 3 yrs; we own the data (self-host option).\n- **Give up** — some custom event modeling we’d get building in-house.\n- **Revisit if** — per-event pricing crosses $8k/mo or we go warehouse-native.\n\n**Confidence:** high — the scorecard holds even if we down-weight cost.' },
      { kind: 'doc', slot: 'doc2', title: 'Risks & unknowns', text: '## Watch-outs\n\n- **Lock-in** — export path exists but untested at our volume.\n- **Privacy** — self-host keeps PII in our VPC; confirm with legal.\n- **Skill** — team knows SQL, not their query DSL — ~1 wk ramp.\n\n_Open Q: does buy delay the warehouse we’ll need anyway?_' },
      { kind: 'doc', slot: 'research', title: 'How we scored', text: '## Method\n\n- 5 criteria, weighted to our constraints (see table).\n- Each option scored 1–10 per criterion by two of us, then averaged.\n- Weighted total / 100 → the bar chart.\n\n_Sensitivity: PostHog still wins if the cost weight drops to 15%._' },
      { kind: 'table', slot: 'table', columns: ['Option', '3-yr cost', 'Time to value', 'Data ownership', 'Flexibility'], rows: [['Build in-house', '$410k', '~5 mo', 'Full', 'High'], ['Amplitude', '$168k', '~2 wk', 'Vendor', 'Medium'], ['PostHog', '$142k', '~2 wk', 'Self-host', 'High'], ['Do nothing', '$0', '—', '—', '—']] },
      { kind: 'table', slot: 'table2', columns: ['Criterion', 'Weight', 'Why'], rows: [['Cost', '30%', 'Runway is tight'], ['Speed', '25%', 'Q3 launch'], ['Flexibility', '20%', 'Custom funnels'], ['Data ownership', '15%', 'Regulated data'], ['Maintenance', '10%', 'Small team']] },
      { kind: 'dashboard', slot: 'dashboard', title: 'Weighted scorecard', spec: DECISION_DASH },
      { kind: 'diagram', slot: 'diagram', title: 'Decision tree', code: 'flowchart TD\n  A[Need product analytics] --> B{Data must stay in-VPC?}\n  B -->|Yes| C[Self-host PostHog]\n  B -->|No| D{Team to build & maintain?}\n  D -->|Yes| E[Build in-house]\n  D -->|No| F{Budget > $160k / 3yr?}\n  F -->|Yes| G[Amplitude]\n  F -->|No| C' },
      { kind: 'img', slot: 'img', src: 'fnd-chart', name: '3-yr cost projection' },
      { kind: 'link', slot: 'link', url: 'https://posthog.com/pricing', siteName: 'PostHog', title: 'PostHog pricing', description: 'Usage tiers and the self-host plan.' },
      { kind: 'link', slot: 'link2', url: 'https://amplitude.com/pricing', siteName: 'Amplitude', title: 'Amplitude plans', description: 'Seat + event-based pricing.' },
      { kind: 'link', slot: 'link3', url: 'https://www.g2.com/categories/product-analytics', siteName: 'G2', title: 'Product analytics — reviews', description: 'Side-by-side ratings from real teams.' },
      { kind: 'pin', slot: 'note1', text: 'the call ↑', anchor: 'doc', corner: 'tr' },
      { kind: 'pin', slot: 'note2', text: 'winner', anchor: 'dashboard', corner: 'tr' },
      { kind: 'pin', slot: 'note3', text: 'confirm with legal', anchor: 'doc2', corner: 'br' },
    ],
  },
];

// Provenance edges by slot: sources → derived work, drawn as the product's own
// dotted lineage (every card stays selected below). Only edges whose BOTH ends
// exist in a given workspace are wired, so one table serves all six boards.
const PROV: [string, string[]][] = [
  ['research', ['link', 'link2']],
  ['table', ['link', 'link3']],
  ['doc', ['research', 'table']],
  ['diagram', ['doc']],
  ['diagram2', ['diagram']],
  ['dashboard', ['table', 'table2']],
  ['prototype', ['diagram', 'doc']],
  ['map', ['doc', 'link']],
  ['table2', ['img3', 'link2']],
  ['doc2', ['table2', 'table']],
];
const SLOT_TYPE: Record<string, string> = {
  table: 'table-card', table2: 'table-card', table3: 'table-card',
  doc: 'doc-card', doc2: 'doc-card', research: 'doc-card',
  diagram: 'diagram-card', diagram2: 'diagram-card',
  dashboard: 'dashboard-card', prototype: 'prototype-card', map: 'map-card',
};

// Reading order the masonry consumes cards in (only slots that exist are used).
// desc (the use-case description) leads; notes are pinned separately.
const FLOW_ORDER = [
  'desc', 'doc', 'research', 'table', 'diagram', 'link', 'dashboard', 'table2',
  'map', 'img', 'video', 'prototype', 'diagram2', 'table3', 'link2', 'img2',
  'link3', 'doc2', 'img3', 'link4', 'link5',
];

// Column count is chosen PER region (see reflow) so each workspace's natural
// aspect lands near the stage's — heavier boards get more columns, lighter ones
// fewer. Clamped so cards never get too small (many cols) or too sparse (few).
const MIN_COLS = 3;
const MAX_COLS = 5;
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
        } else if (card.kind === 'map') {
          editor.createShape({ id, type: 'map-card', x, y, props: { w: W[card.slot] ?? 560, h: H0[card.slot] ?? 360, title: card.title, intro: card.intro, stops: card.stops, ordered: card.ordered, status: 'done' } });
        } else if (card.kind === 'dashboard') {
          editor.createShape({ id, type: 'dashboard-card', x, y, props: { w: W[card.slot] ?? 620, h: H0[card.slot] ?? 470, title: card.title, spec: card.spec, status: 'done' } });
        } else if (card.kind === 'prototype') {
          editor.createShape({ id, type: 'prototype-card', x, y, props: { w: W[card.slot] ?? 460, h: H0[card.slot] ?? 400, html: card.html, title: card.title, prompt: card.title, status: 'done' } });
        } else if (card.kind === 'video') {
          editor.createShape({ id, type: 'youtube-card', x, y, props: { w: W[card.slot] ?? 440, h: H0[card.slot] ?? 300, videoId: card.videoId, url: card.url, title: card.title } });
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

        // Pick the column count that makes THIS region's natural aspect ≈ the
        // stage (16:9): with roughly-uniform card widths, aspect ≈ cols²·pitch
        // ÷ totalContentHeight, so solving for the target gives this sqrt. A
        // board full of tall docs + a dashboard gets more columns; a lean one
        // gets fewer. Clamped to keep cards legible and columns non-sparse.
        const pitch = Math.max(...flow.map((c) => c.w)) + GUTTER;
        const totalH = flow.reduce((s, c) => s + c.h + BASE_GAP, 0);
        const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(Math.sqrt((TARGET_ASPECT * totalH) / pitch))));

        // Balanced masonry (longest-processing-time bin-packing): place the
        // TALLEST cards first into the currently shortest column, so a single
        // auto-grown doc can't tower alone in one column while short link cards
        // pile up in another — the columns come out near-equal. `desc` (the
        // use-case blurb) is seeded top-left first so it always reads first;
        // each column is then re-sorted into reading order for a natural scan.
        const colH = new Array<number>(cols).fill(0);
        const colItems: FlowCard[][] = Array.from({ length: cols }, () => []);
        const readIndex = new Map(flow.map((c, i) => [c.id, i]));
        const [desc, ...rest] = flow;
        if (desc) {
          colItems[0]!.push(desc);
          colH[0]! += desc.h + BASE_GAP;
        }
        for (const c of [...rest].sort((a, b) => b.h - a.h)) {
          let k = 0;
          for (let j = 1; j < cols; j++) if (colH[j]! < colH[k]!) k = j;
          colItems[k]!.push(c);
          colH[k]! += c.h + BASE_GAP;
        }
        for (const items of colItems) items.sort((a, b) => readIndex.get(a.id)! - readIndex.get(b.id)!);

        const boardW = cols * pitch - GUTTER;
        const left = cx - boardW / 2;
        // Pure masonry: stack each column tight with a fixed small gap. The
        // adaptive column count already balanced total height across columns, so
        // the columns end near-even and the bottom edge is only lightly ragged —
        // a real workspace look. We deliberately DON'T stretch cards to a common
        // bottom: against one very tall card (a grown doc or a big diagram) that
        // would open large gaps inside the shorter columns, which reads as empty.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        colItems.forEach((items, k) => {
          if (!items.length) return;
          const x = left + k * pitch;
          let y = COL_TOP;
          for (const c of items) {
            editor.updateShape({ id: c.id, type: c.type, x, y } as Parameters<typeof editor.updateShape>[0]);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + c.w);
            maxY = Math.max(maxY, y + c.h);
            y += c.h + BASE_GAP;
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
