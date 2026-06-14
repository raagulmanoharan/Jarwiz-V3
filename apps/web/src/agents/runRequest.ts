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
  'table-card': 'table',
};

/** Flatten a table card's grid into a compact text an agent can read. */
function tableToText(props: Record<string, unknown>): string {
  const columns = Array.isArray(props.columns) ? (props.columns as string[]) : [];
  const rows = Array.isArray(props.rows) ? (props.rows as string[][]) : [];
  if (columns.length === 0) return '';
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(columns), ...rows.map((r) => line(r))].join('\n');
}

/** Does this shape carry a Jarwiz card a card can act on? */
export function isCardShape(shape: TLShape | undefined): shape is TLShape {
  return shape !== undefined && shape.type in KIND_BY_TYPE;
}

function shapeToRunCard(shape: TLShape): RunCard {
  const props = shape.props as Record<string, unknown>;
  const text =
    shape.type === 'table-card'
      ? tableToText(props)
      : typeof props.text === 'string'
        ? props.text
        : undefined;
  return {
    cardId: shape.id,
    kind: KIND_BY_TYPE[shape.type] ?? 'note',
    x: shape.x,
    y: shape.y,
    w: typeof props.w === 'number' ? props.w : 0,
    h: typeof props.h === 'number' ? props.h : 0,
    url: typeof props.url === 'string' ? props.url : undefined,
    title: typeof props.title === 'string' ? props.title : undefined,
    text,
  };
}

export function buildRunRequest(
  editor: Editor,
  source: TLShape,
  context: TLShape[] = [],
  brief?: string,
): AgentRunRequest {
  const sourceProps = source.props as Record<string, unknown>;
  const sourceWidth = typeof sourceProps.w === 'number' ? sourceProps.w : 0;
  const selection = context.map(shapeToRunCard);

  return {
    source: shapeToRunCard(source),
    selection: selection.length > 0 ? selection : undefined,
    placement: freePlacement(editor, source, sourceWidth),
    brief: brief?.trim() || undefined,
  };
}

/**
 * Where to drop the agent's artifacts: to the right of the source, but past
 * any existing content so successive runs don't pile cards on top of each
 * other. Falls back to right-of-source when the board bounds are unavailable.
 */
function freePlacement(
  editor: Editor,
  source: TLShape,
  sourceWidth: number,
): { x: number; y: number } {
  const rightOfSource = source.x + sourceWidth + PLACEMENT_OFFSET;
  const bounds = editor.getCurrentPageBounds();
  const x = bounds ? Math.max(rightOfSource, bounds.maxX + PLACEMENT_OFFSET) : rightOfSource;
  return { x, y: source.y };
}
