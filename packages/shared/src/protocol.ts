/**
 * The Jarwiz agent wire protocol.
 *
 * The server executes a canvas action by emitting an AgentEvent over SSE;
 * the client applies it to the tldraw store (creating shapes, streaming
 * text deltas into them, drawing arrows) and animates the agent cursor to
 * wherever the event lands. See docs/ARCHITECTURE.md.
 */

/** The kinds of cards an agent (or the user) can place on the board. */
export type CardKind = 'link' | 'youtube' | 'image' | 'pdf' | 'note' | 'doc';

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
