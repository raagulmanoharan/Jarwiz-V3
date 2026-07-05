/**
 * The Jarwiz agent wire protocol.
 *
 * The server executes a canvas action by emitting an AgentEvent over SSE;
 * the client applies it to the tldraw store (creating shapes, streaming
 * text deltas into them, drawing arrows) and animates the agent cursor to
 * wherever the event lands. See docs/ARCHITECTURE.md.
 */

import type { AgentId } from './agents.js';

/** The kinds of cards an agent (or the user) can place on the board. */
export type CardKind = 'link' | 'youtube' | 'image' | 'pdf' | 'sheet' | 'note' | 'doc' | 'table';

/** Metadata extracted by the server's POST /api/link/preview endpoint. */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image?: string;
  favicon?: string;
  themeColor?: string;
  siteName?: string;
  /** Readable page text (capped server-side) — what asks/refines ground on. */
  text?: string;
}

/**
 * One event in an agent run's SSE stream.
 *
 * Framing on the wire: `data: {json}\n\n` per event. A run always
 * terminates with either `{ type: 'done' }` or `{ type: 'error' }`.
 */
/**
 * A board card serialized compactly for an agent run request. `cardId` is
 * the client's stable shape id — the server echoes it back in
 * `edge.create` events so the client can wire edges to existing shapes.
 */
export interface RunCard {
  cardId: string;
  kind: CardKind;
  /** Page-space position and size of the card on the board. */
  x: number;
  y: number;
  w: number;
  h: number;
  url?: string;
  title?: string;
  /** Card body text — used as source material when there is no url. */
  text?: string;
}

/**
 * POST /api/agents/:id/run request body.
 *
 * The client computes a free-space `placement` hint (page coordinates,
 * top-left of the suggested artifact area, to the right of the source);
 * agents decide *what* to make, the protocol keeps *where* sane.
 */
export interface AgentRunRequest {
  /** The card the run is about (the offer target or the selected card). */
  source: RunCard;
  /** Additional selected cards, when the user summoned on a multi-selection. */
  selection?: RunCard[];
  /** Free-space placement hint for the agent's artifact. */
  placement: { x: number; y: number };
  /**
   * Optional plain-language instruction steering this run — tone, length,
   * audience, format, reading level, anything. The agent follows it.
   */
  brief?: string;
}

export type AgentEvent =
  /** Honest status text for the dock and status chips. */
  | { type: 'status'; message: string }
  /** Cursor target in page (canvas) coordinates — the agent walks here. */
  | { type: 'cursor'; x: number; y: number }
  /**
   * Place a new card artifact on the board.
   *
   * Streamed cards (a Summarizer doc) are created empty and filled by later
   * `card.delta` events. Fully-formed cards (a Researcher link card, a
   * Brainstormer note) carry their content here: `url` for link cards, `text`
   * for the note body or link description.
   */
  | {
      type: 'card.create';
      cardId: string;
      kind: CardKind;
      x: number;
      y: number;
      title?: string;
      url?: string;
      text?: string;
      /** Table cards (kind 'table') carry their grid here, fully formed. */
      columns?: string[];
      rows?: string[][];
    }
  /** Stream text into a card, word by word. */
  | { type: 'card.delta'; cardId: string; textDelta: string }
  /** The card's content is complete. */
  | { type: 'card.done'; cardId: string }
  /** Draw a provenance edge between two cards. */
  | { type: 'edge.create'; fromCardId: string; toCardId: string; label?: string }
  /** The run finished successfully. */
  | { type: 'done' }
  /** The run failed — surfaced honestly on the board, never silently. */
  | { type: 'error'; message: string };

/* ─── Autopilot (Tab-to-continue) ───────────────────────────────────────── */

/**
 * POST /api/autopilot request — ask an agent to continue the prose in a card
 * the user is editing, in place, from where their caret stopped. The agent
 * never rewrites existing text; it only appends a bounded continuation.
 * See docs/ROADMAP.md §9 (M4 — Autopilot, phase A0).
 */
export interface AutopilotRequest {
  /** Which card kind is being continued — shapes the voice/format. */
  kind: 'doc' | 'note';
  /** The document title, when present, for context. */
  title?: string;
  /** The existing card text up to the caret — the agent continues from here. */
  text: string;
  /**
   * Nearby board content for grounding — connected cards first, then selected,
   * nearby, and board-wide. Capped and truncated before sending. When text is
   * empty (cold start), the agent writes an opener grounded in this context.
   */
  boardContext?: AutopilotBoardCard[];
}

/** One board card serialised compactly for Autopilot context. */
export interface AutopilotBoardCard {
  kind: string;
  title?: string;
  text: string;
  /** How the card was reached — used for relevance ordering. */
  relation: 'connected' | 'selected' | 'nearby' | 'board';
}

/**
 * One event in an autopilot SSE stream. Framing: `data: {json}\n\n`. Always
 * terminates with `done` or `error`. Deltas are appended at the caret live,
 * with the agent's streaming caret showing, multiplayer-style.
 */
export type AutopilotEvent =
  | { type: 'delta'; textDelta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/* ─── Content-aware suggestions (proactive pills) ───────────────────────── */

/** A proposed agent action, tailored to a dropped artifact's actual content. */
export interface AgentSuggestion {
  /** Short pill label, e.g. "Make a compliance checklist". */
  label: string;
  /** Which agent does it. */
  agentId: AgentId;
  /** Optional steering brief passed to the run. */
  brief?: string;
}

/**
 * POST /api/suggest request — read a dropped artifact and propose tailored
 * agent-action pills. The server extracts the content (fetch a link/oEmbed a
 * video / parse a PDF) and asks the model what's worth doing with it.
 */
export interface SuggestRequest {
  kind: 'youtube' | 'link' | 'pdf';
  url?: string;
  title?: string;
  /** A PDF's data URL (the card's src) for server-side text extraction. */
  pdfDataUrl?: string;
}

export interface SuggestResponse {
  suggestions: AgentSuggestion[];
}

/**
 * POST /api/cluster-suggest request — propose CROSS-CUTTING actions over a set
 * of related artifacts (compare them, synthesize them, find the through-line).
 * Surface-level: only titles + kinds, so it's fast.
 */
export interface ClusterSuggestRequest {
  items: Array<{ kind: string; title: string }>;
  /** The detected shared theme word, if any. */
  theme?: string;
}

/**
 * POST /api/autopilot/table request — fill the empty cells of a table the user
 * is building (A1). The agent reads the column headers and any rows the user
 * filled, completes the rest, and the cells stream in one at a time so the
 * Writer avatar can hop across the grid.
 */
export interface TableAutopilotRequest {
  /** Column headers — define what each cell should contain. */
  columns: string[];
  /** Current rows (row-major); empty strings are the cells to fill. */
  rows: string[][];
}

export type TableAutopilotEvent =
  /** Fill one cell. Emitted in visiting order so the avatar hops cell to cell. */
  | { type: 'cell'; row: number; col: number; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/* ─── Comments & agent voice ────────────────────────────────────────────── */

/** One message in a card's comment thread — from you or from an agent. */
export interface CommentMessage {
  id: string;
  /** 'you' for the human, or an AgentId when an agent replied. */
  author: 'you' | AgentId;
  text: string;
  ts: number;
}

/**
 * POST /api/comment request — ask an agent to reply, in conversation, to a
 * card's comment thread. Agents are participants: they answer in the thread
 * like a teammate (a short message), they don't dump a card. Streams its reply
 * as `AutopilotEvent` text deltas.
 */
export interface CommentReplyRequest {
  agentId: AgentId;
  cardKind: CardKind;
  cardTitle?: string;
  cardText?: string;
  /** The card's source URL (link/youtube cards) so the server can fetch the
   *  real content — page text or a video transcript — to reply from. */
  cardUrl?: string;
  /** The thread so far, oldest first; author is 'you' or an agent's name. */
  thread: Array<{ author: string; text: string }>;
}

/**
 * Ask — the one AI verb of the PDF journey (docs/PDF-JOURNEY.md). A free-form
 * question (or a predefined seed prompt) is run against one or more source
 * cards; the server picks the response shape and streams an answer card.
 */
export interface AskSource {
  kind: CardKind;
  /** Server asset id for PDF/file sources — the server reads its text. */
  assetId?: string;
  title?: string;
  /** Inline text for text-bearing sources (doc/table/note responses). */
  text?: string;
  /** Data URL of an image source (`data:image/...;base64,...`). Sent to the
   *  model as a vision input on the API path; noted but unseen on the dev
   *  sidecar (which is text-only). */
  dataUrl?: string;
  /** Source web page URL (link-card sources) — answers cite it as a markdown
   *  link and close with a Source reference line. */
  url?: string;
  /** Watched video frames (video-card sources): asset ids of sampled stills,
   *  in time order. The server loads them as vision inputs so the model sees
   *  the video, not just its transcript. */
  frameAssetIds?: string[];
}

export interface AskRequest {
  prompt: string;
  sources: AskSource[];
  /**
   * The shape of the card being refined, when the prompt targets an existing
   * answer (an in-place tweak — "add a node", "make it shorter"). The server
   * keeps this shape unless the prompt explicitly asks for a different format,
   * so a refinement regenerates the same card rather than spawning a new one.
   */
  currentShape?: AskShape;
  /**
   * Set once the user has answered a clarifying question — skips the
   * disambiguation pass so the (now-specific) request runs straight through.
   */
  skipClarify?: boolean;
  /**
   * Explicit response shape picked by the user (the prompt bar's "/" mode
   * selector). Wins over the prompt-based router. This is also the only path
   * that may produce sticky notes ('affinity') — the router never chooses
   * stickies on its own; they're the user's annotation medium.
   */
  shape?: AskShape;
  /**
   * Deep research pass — the model gets a bigger live-web budget (many
   * searches + page fetches) and a dossier mission: reviews across platforms,
   * prices, reputation, red flags, alternatives. Always answers as a doc.
   */
  deep?: boolean;
  /**
   * Suppress the automatic deep-research upgrade. The board fan-out (compose)
   * generates several cards in a row and must stay snappy, so each card runs on
   * the normal budget even when its prompt sounds research-y.
   */
  noResearch?: boolean;
  /**
   * Run a Thinking Machine skill (server-side): the machine's own system prompt
   * and research budget replace the normal router, and the `prompt` is just the
   * subject the user typed into the machine block. See server machines.ts.
   */
  machineId?: string;
}

/* ─── Diagram (canvas pivot P2 — the AI builds primitives) ───────────────────
 * "Turn this into a flowchart": the model returns a graph spec and the client
 * lays it out as native tldraw shapes + connectors (not a card, not Mermaid).
 * This is the agent authoring real, editable primitives the user can then tweak.
 */

export interface DiagramNode {
  /** Stable id used to wire edges; opaque to the user. */
  id: string;
  label: string;
  /** Node silhouette — maps to a tldraw geo shape. */
  shape?: 'rectangle' | 'ellipse' | 'diamond';
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramRequest {
  prompt: string;
  /** Optional grounding — the selected cards/primitives the diagram is built from. */
  sources?: AskSource[];
}

/* ─── Cluster & summarise (Big Rocks 2.1 — synthesis) ────────────────────────
 * Start from the user's OWN stickies and synthesise backward: group them into
 * named themes and write a short "themes so far" summary. Distinct from the
 * affinity diagram, which starts from a prompt.
 */

export interface ClusterRequest {
  /** The selected sticky notes' text, in selection order. */
  items: string[];
}

export interface ClusterTheme {
  name: string;
  /** Indices into the request `items` that belong to this theme. */
  members: number[];
}

export interface ClusterResult {
  themes: ClusterTheme[];
  /** A short markdown synthesis ("3 themes emerged: …"). */
  summary: string;
}

/* ─── Analyze (Big Rocks 2.3 / 3.1 / 3.2 — agents with opinions) ──────────────
 * One endpoint, three lenses over the board (or a selection):
 *  - 'tensions' — name specific contradictions between cards (conflict detection)
 *  - 'gaps'     — what a senior PM would ask that isn't answered ("what am I missing?")
 *  - 'critique' — Devil's Advocate: weakest assumption, failure mode, likely objector
 * Each returns a single doc card (title + markdown body).
 */

export type AnalyzeMode = 'tensions' | 'gaps' | 'critique';

export interface AnalyzeCard {
  kind: string;
  title?: string;
  text: string;
  /** PDF cards: the server-side asset whose extracted text joins the scan
   *  (capped server-side — see analyze.ts PDF_* limits). */
  assetId?: string;
}

export interface AnalyzeRequest {
  mode: AnalyzeMode;
  cards: AnalyzeCard[];
}

export interface AnalyzeResult {
  title: string;
  /** Markdown body for the result doc card. */
  text: string;
}

/* ─── Discover (Ultra Think — grounded resource discovery) ────────────────────
 * Read the board and surface REAL related resources from the live web (Claude
 * grounded search). The links must be real — an ungrounded model invents dead
 * URLs — so the server validates and dedupes before returning them.
 */

export type ResourceKind =
  | 'video'
  | 'news'
  | 'article'
  | 'paper'
  | 'pdf'
  | 'doc'
  | 'repo'
  | 'other';

export interface SuggestedResource {
  title: string;
  description: string;
  /** A real, reachable http(s) URL (validated server-side). */
  url: string;
  kind: ResourceKind;
  /** The specific connection/gap this fills — smarter than "because you
   *  saved X"; names what on the board it advances and why it's worth it. */
  reason: string;
  /** Source domain (e.g. "arxiv.org"), derived from the URL. */
  source: string;
  /** The board theme this belongs to — the drawer groups results by topic. */
  topic: string;
}

export interface DiscoverRequest {
  /** The board's cards, summarised like an analyze scan. */
  cards: AnalyzeCard[];
  /** URLs already on the board — never suggest a duplicate. */
  existingUrls?: string[];
}

export interface DiscoverResult {
  resources: SuggestedResource[];
}

/* ─── Notice (proactive comments — FigJam-style) ──────────────────────────────
 * Jarwiz quietly reviews the board and, when it spots something genuinely worth
 * flagging, leaves a short comment PINNED to the specific card it's about — a
 * contradiction, a risk, a timing/season issue, a missing piece. Non-intrusive:
 * a handful at most, only when there's real signal.
 */

export type NoticeKind = 'risk' | 'tension' | 'gap' | 'idea';

/** A board card tagged with its stable shape id so a comment can pin to it. */
export interface NoticeCard extends AnalyzeCard {
  id: string;
}

export interface NoticeComment {
  /** The shape id this comment pins to (must be one of the sent card ids). */
  cardId: string;
  kind: NoticeKind;
  /** One or two tight sentences — what Jarwiz noticed, in a collaborator's voice. */
  body: string;
  /** Optional one-click follow-up: a prompt Jarwiz would run on that card to
   *  address the note (prefilled into the prompt bar, grounded on the card). */
  suggestion?: string;
}

export interface NoticeRequest {
  cards: NoticeCard[];
  /** Today's date (ISO yyyy-mm-dd) so Jarwiz can catch timing/season issues. */
  today?: string;
}

export interface NoticeResult {
  comments: NoticeComment[];
}

/* ─── Annotate (Stickies mode — Jarwiz drops notes across many cards) ─────────
 * Sticky notes are the USER's medium — but when they explicitly pick Stickies
 * mode and ask ("TL;DR each link", "review my ideas and add your two cents"),
 * Jarwiz drops a short sticky next to each relevant card. One note per target.
 */

export interface AnnotateRequest {
  /** The user's instruction (e.g. "add a tl;dr to each link I've added"). */
  prompt: string;
  /** Candidate target cards (selection, else the whole board), id-tagged. */
  cards: NoticeCard[];
}

export interface AnnotateNote {
  /** The card this sticky annotates (one of the sent ids). */
  cardId: string;
  /** The sticky's text — short, a couple of sentences at most. */
  note: string;
}

export interface AnnotateResult {
  notes: AnnotateNote[];
}

/* ─── Compose (board fan-out — one intent → many laid-out cards) ───────────────
 * The orchestrator: read the board (a brief, or a few dropped things) and build
 * it out into a rich spatial working set — a comparison table, sticky-note
 * tips, day/plan docs, a budget — instead of one monolithic card. The server
 * plans the SET, then generates each card by reusing the Ask engine; the client
 * lays them out masonry-style as they stream in.
 */

export interface ComposePlanCard {
  slot: number;
  type: AskShape;
  title: string;
}

export interface ComposeRequest {
  /** The board so far — the material the fan-out grounds and expands on. */
  board: AnalyzeCard[];
  /** Optional explicit steer ("plan my Goa weekend"); else inferred from board. */
  intent?: string;
  /** When set, run this Thinking Machine's BOARD skill on `intent` (the typed
   *  subject) instead of the generic board planner. See server machineBoard.ts. */
  machineId?: string;
}

/** SSE for a compose run: the plan up front, then each card's Ask events
 *  wrapped with the slot they belong to, then a final done. */
export type ComposeEvent =
  | { type: 'plan'; cards: ComposePlanCard[] }
  | { type: 'slot'; slot: number; event: AskEvent }
  | { type: 'done' }
  | { type: 'error'; message: string };

/* ─── Revise (Big Rocks 3.3 — conversational depth) ──────────────────────────
 * Argue with an answer card: a follow-up instruction revises the doc IN PLACE
 * (not a new card), keeping the dialogue on the one artifact.
 */

export interface ReviseTurn {
  role: 'you' | 'agent';
  text: string;
}

export interface ReviseRequest {
  /** The doc card's current markdown. */
  text: string;
  /** The user's follow-up ("yes, but what about enterprise customers?"). */
  instruction: string;
  /** Prior turns in this card's discussion, for continuity. */
  thread?: ReviseTurn[];
}

export interface ReviseResult {
  /** The full revised markdown to replace the card's body. */
  text: string;
}

/**
 * The shape the answer takes; inferred from the prompt + content, steerable.
 *  - `doc`/`list` — written prose or bullets. A checklist is a `doc`/`list`
 *    whose items are `- [ ]` task lines; it is NOT a separate shape.
 *  - `table` — a comparison/matrix grid.
 *  - `diagram` — a Mermaid diagram; the server picks the subtype (flowchart,
 *    sequence, mindmap, ER, gantt, …) from the prompt and emits Mermaid code.
 *  - `affinity` — clustered sticky notes (an affinity diagram): not one card but
 *    a set of `note` cards grouped into labelled clusters.
 */
export type AskShape = 'doc' | 'table' | 'list' | 'diagram' | 'affinity';

/** SSE events for a single Ask response.
 *  - Tables build live: `card.create` carries the columns + row count, then
 *    `table.cell` events fill cells one by one.
 *  - Docs/lists/diagrams stream as `card.delta` text (a diagram streams its
 *    Mermaid source, rendered to SVG once `card.done` lands).
 *  - Affinity diagrams emit `affinity.cluster` (a labelled group) followed by
 *    `affinity.note` events (a sticky in that group). */
export type AskEvent =
  | { type: 'status'; message: string }
  /** The request was genuinely ambiguous — ask the user a short question with a
   *  few tappable options before making anything. The run ends after this; the
   *  client re-asks with the answer folded in (and `skipClarify`). */
  | { type: 'clarify'; question: string; options: string[] }
  | { type: 'card.create'; shape: AskShape; title?: string; columns?: string[]; rowCount?: number }
  | { type: 'card.title'; title: string }
  | { type: 'card.delta'; textDelta: string }
  | { type: 'table.cell'; r: number; c: number; text: string }
  | { type: 'affinity.cluster'; index: number; label: string }
  | { type: 'affinity.note'; cluster: number; text: string }
  | { type: 'card.done' }
  | { type: 'done' }
  | { type: 'error'; message: string };
