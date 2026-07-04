/**
 * Renders an active lineage trace as a pure-CSS spotlight: ancestry members
 * (cards + their provenance arrows) stay at full opacity, the rest of the
 * board dims, and the traced root gets a soft accent glow. Implemented as an
 * injected <style> keyed on tldraw's `data-shape-id` containers — no shape is
 * mutated, so tracing is invisible to undo history and persistence.
 *
 * The trace clears itself when the root leaves the selection or Esc is
 * pressed, so it can never get stuck over the board.
 */

import { useEffect } from 'react';
import { useEditor, useValue } from 'tldraw';
import { useSyncExternalStore } from 'react';
import { clearLineage, getLineage, subscribeLineage } from './lineage';

export function LineageLayer() {
  const editor = useEditor();
  const lineage = useSyncExternalStore(subscribeLineage, getLineage, getLineage);

  // Release the spotlight the moment the traced card leaves the selection —
  // deselect, delete, board switch, anything.
  const rootSelected = useValue(
    'lineage root selected',
    () => (lineage ? editor.getSelectedShapeIds().includes(lineage.rootId) : false),
    [editor, lineage],
  );
  useEffect(() => {
    if (lineage && !rootSelected) clearLineage();
  }, [lineage, rootSelected]);

  useEffect(() => {
    if (!lineage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearLineage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lineage]);

  if (!lineage) return null;

  const keep = [...lineage.members]
    .map((id) => `.tl-shape[data-shape-id="${id}"]`)
    .join(',\n');

  // !important throughout: tldraw writes each shape's own opacity as an inline
  // style, which would otherwise beat any stylesheet rule.
  const css = `
    .tl-shape {
      opacity: 0.18 !important;
      transition: opacity var(--jz-dur-base) var(--jz-ease-out);
    }
    ${keep} {
      opacity: 1 !important;
    }
    .tl-shape[data-shape-id="${lineage.rootId}"] {
      filter: drop-shadow(0 0 14px color-mix(in srgb, var(--jz-accent) 45%, transparent));
    }
  `;

  return <style>{css}</style>;
}
