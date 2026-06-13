/**
 * Turn tldraw shapes into an AgentRunRequest.
 *
 * Shared by both entry points so summoning ("Ask an agent") and accepting a
 * proactive offer ("Summarize this?") build identical requests: the source
 * card, optional context cards, and a free-space placement hint to the right
 * of the source (agents decide *what* to make, the protocol keeps *where*
 * sane — see docs/ARCHITECTURE.md).
 */

import type { Editor, TLShape } from 'tldraw';
import type { AgentRunRequest, CardKind, RunCard } from '@jarwiz/shared';

/** Placement hint sits this far to the right of the source card. */
const PLACEMENT_OFFSET = 60;

const KIND_BY_TYPE: Record<string, CardKind> = {
  'link-card': 'link',
  'youtube-card': 'youtube',
  'image-card': 'image',
  'pdf-card': 'pdf',
  'note-card': 'note',
  'doc-card': 'doc',
};

/** Does this shape carry a Jarwiz card a card can act on? */
export function isCardShape(shape: TLShape | undefined): shape is TLShape {
  return shape !== undefined && shape.type in KIND_BY_TYPE;
}

function shapeToRunCard(shape: TLShape): RunCard {
  const props = shape.props as Record<string, unknown>;
  return {
    cardId: shape.id,
    kind: KIND_BY_TYPE[shape.type] ?? 'note',
    x: shape.x,
    y: shape.y,
    w: typeof props.w === 'number' ? props.w : 0,
    h: typeof props.h === 'number' ? props.h : 0,
    url: typeof props.url === 'string' ? props.url : undefined,
    title: typeof props.title === 'string' ? props.title : undefined,
    text: typeof props.text === 'string' ? props.text : undefined,
  };
}

export function buildRunRequest(
  _editor: Editor,
  source: TLShape,
  context: TLShape[] = [],
): AgentRunRequest {
  const sourceProps = source.props as Record<string, unknown>;
  const sourceWidth = typeof sourceProps.w === 'number' ? sourceProps.w : 0;
  const selection = context.map(shapeToRunCard);

  return {
    source: shapeToRunCard(source),
    selection: selection.length > 0 ? selection : undefined,
    placement: {
      x: source.x + sourceWidth + PLACEMENT_OFFSET,
      y: source.y,
    },
  };
}
