/**
 * Real multiplayer sync — a tldraw sync room per board, over WebSockets.
 *
 * The board is genuinely shared: every connected client (human or, later, an
 * agent client) sees the same store, live. The server validates against the
 * SAME schema the client uses — tldraw defaults plus our custom card shapes —
 * which is why the card prop schemas live in @jarwiz/shared (createTLSchema
 * here, ShapeUtils there, built from identical props).
 *
 * Rooms are in-memory and ephemeral (good enough for the foundation; swap the
 * store for a persistent one later). One TLSocketRoom per roomId.
 */

import { TLSocketRoom } from '@tldraw/sync-core';
import {
  createTLSchema,
  defaultBindingSchemas,
  defaultShapeSchemas,
  type TLRecord,
} from '@tldraw/tlschema';
import { cardShapeProps } from '@jarwiz/shared';

const customShapes = Object.fromEntries(
  Object.entries(cardShapeProps).map(([type, props]) => [type, { props }]),
);

/** Defaults (arrow, draw, …) + our custom cards — must mirror the client. */
const schema = createTLSchema({
  shapes: { ...defaultShapeSchemas, ...customShapes },
  bindings: { ...defaultBindingSchemas },
});

const rooms = new Map<string, TLSocketRoom<TLRecord>>();

function getRoom(roomId: string): TLSocketRoom<TLRecord> {
  let room = rooms.get(roomId);
  if (!room) {
    room = new TLSocketRoom({ schema });
    rooms.set(roomId, room);
  }
  return room;
}

/** Attach a freshly-upgraded WebSocket to its room's sync session. */
export function handleSyncSocket(roomId: string, sessionId: string, socket: unknown): void {
  // `ws` WebSocket satisfies tldraw's WebSocketMinimal (send/close/addEventListener).
  getRoom(roomId).handleSocketConnect({ sessionId, socket: socket as never });
}

