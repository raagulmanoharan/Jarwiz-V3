/**
 * Which shape types can ground an Ask. Rich cards plus native primitives
 * (canvas pivot P1): a selected shape, label, or hand-drawn cluster is
 * askable, so "create something from this" works on a sketch, not just cards.
 * Shared by the prompt bar (ground chips) and the card action bar.
 */
export const ASKABLE = new Set([
  'pdf-card', 'doc-card', 'table-card', 'diagram-card', 'note-card', 'image-card',
  'geo', 'text', 'note', 'arrow', 'frame',
]);
