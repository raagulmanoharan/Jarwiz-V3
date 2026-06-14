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
export type CardKind = 'link' | 'youtube' | 'image' | 'pdf' | 'note' | 'doc' | 'table';

/** Metadata extracted by the server's POST /api/link/preview endpoint. */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image?: string;
  favicon?: string;
  themeColor?: string;
  siteName?: string;
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
  /** The thread so far, oldest first; author is 'you' or an agent's name. */
  thread: Array<{ author: string; text: string }>;
}
