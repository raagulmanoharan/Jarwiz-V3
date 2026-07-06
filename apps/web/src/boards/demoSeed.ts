/**
 * Seed a representative board for the embedded demo (?demo=1). Hand-authored,
 * server-free content that mirrors what a real SWOT Thinking Machine produces —
 * a machine block, the 2×2 quadrants, a TOWS strategy table, and a verdict —
 * so a visitor sees the actual product with real cards they can pan, zoom, and
 * rearrange, without needing an API key.
 *
 * Only seeds an empty board; a returning visitor keeps whatever they changed.
 */

import { Box, createShapeId, type Editor, type TLShapePartial } from 'tldraw';
import { getActiveBoardId, markBoardUsed } from './boardStore';
import { PROV_META_KEY } from '../ask/useAsk';

export function seedDemoBoard(editor: Editor): void {
  // Already populated (persisted from a prior visit) — leave the visitor's board be.
  if (editor.getCurrentPageShapeIds().size > 0) {
    markBoardUsed(getActiveBoardId());
    return;
  }

  // The Thinking Machine that produced the board — its id is the provenance
  // source every output card points back to, so selecting the machine (or any
  // card) reveals the lineage hairlines, exactly like a real run.
  const machineId = createShapeId();

  // A doc card that cites the machine as its source (provenance).
  const doc = (x: number, y: number, w: number, title: string, text: string): TLShapePartial => ({
    id: createShapeId(),
    type: 'doc-card',
    x,
    y,
    props: { w, h: 210, title, text },
    meta: { [PROV_META_KEY]: [machineId] },
  });

  // Generous vertical gaps: doc/table cards auto-grow to their content, and each
  // card's title tag floats ~28px above it — so rows are spaced to clear a tall
  // card plus its tag with room to spare (no overlap).
  const shapes: TLShapePartial[] = [
    {
      id: machineId,
      type: 'machine-card',
      x: -700,
      y: 20,
      props: { w: 300, h: 286, machineId: 'swot', subject: 'Figma', status: 'done' },
    },
    // A friendly annotation to orient the visitor, well clear of the machine card.
    {
      id: createShapeId(),
      type: 'note-card',
      x: -700,
      y: 372,
      props: {
        w: 300,
        h: 118,
        text: 'This is the real Jarwiz. Drag a card, zoom around, or open a Thinking Machine from the left rail.',
        color: '#fde68a',
      },
    },
    // The SWOT 2×2 — internal (top) over external (bottom), 380px between rows.
    doc(-300, -210, 430, 'Strengths', '## Strengths\n\n- Best-in-class real-time collaboration, multiplayer by default\n- Browser-based — zero install, works on any OS\n- Huge plugin & community ecosystem\n- FigJam + Dev Mode extend it across the whole workflow'),
    doc(200, -210, 430, 'Weaknesses', '## Weaknesses\n\n- Performance can lag on very large files\n- Pricing steepens fast for bigger teams\n- Offline support is limited\n- Advanced prototyping trails dedicated tools'),
    doc(-300, 170, 430, 'Opportunities', '## Opportunities\n\n- AI-assisted design generation\n- Deeper design-to-code handoff\n- Expansion into whiteboarding & docs\n- Enterprise design-system governance'),
    doc(200, 170, 430, 'Threats', '## Threats\n\n- Adobe and Canva pushing the same space\n- New AI-native design tools emerging\n- Pressure on SaaS seat counts\n- Open-source alternatives (Penpot) maturing'),
    // TOWS cross-strategy table + the verdict, to the right — 470px apart so a
    // tall table never meets the verdict's floating title tag.
    {
      id: createShapeId(),
      type: 'table-card',
      x: 760,
      y: -210,
      props: {
        w: 470,
        h: 240,
        columns: ['Cross-strategy', 'Move'],
        rows: [
          ['Strengths × Opportunities', 'Ship AI generation on top of the collaboration moat'],
          ['Strengths × Threats', 'Lean on ecosystem lock-in against Adobe & Canva'],
          ['Weaknesses × Opportunities', 'Fix large-file performance to win enterprise'],
          ['Weaknesses × Threats', 'Add offline + value pricing to blunt challengers'],
        ],
      },
      meta: { jzTitle: 'TOWS — Strategic Moves', [PROV_META_KEY]: [machineId] },
    },
    doc(
      760,
      260,
      470,
      'Strategic Verdict',
      "## Strategic Verdict\n\nFigma's collaboration moat and ecosystem keep it the category leader — but the AI-native wave is the real contest.\n\n**Top priorities**\n1. Own AI-assisted design before challengers do\n2. Close the large-file performance gap\n3. Defend pricing against seat-count pressure",
    ),
  ];

  seedAndFrame(editor, shapes);
}

function seedAndFrame(editor: Editor, shapes: TLShapePartial[]): void {
  editor.createShapes(shapes);
  markBoardUsed(getActiveBoardId());

  // Frame the whole board on load, padded on the left so the fixed tool rail
  // never covers the leftmost card.
  editor.selectAll();
  const b = editor.getSelectionPageBounds();
  editor.selectNone();
  if (b) {
    const framed = new Box(b.x - 300, b.y - 24, b.w + 340, b.h + 48);
    editor.zoomToBounds(framed, { inset: 48, targetZoom: 1, animation: { duration: 0 } });
  }
}
