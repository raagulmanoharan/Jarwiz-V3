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
export type AgentEvent =
  /** Honest status text for the dock and status chips. */
  | { type: 'status'; message: string }
  /** Cursor target in page (canvas) coordinates — the agent walks here. */
  | { type: 'cursor'; x: number; y: number }
  /** Place a new card artifact on the board. */
  | {
      type: 'card.create';
      cardId: string;
      kind: CardKind;
      x: number;
      y: number;
      title?: string;
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
