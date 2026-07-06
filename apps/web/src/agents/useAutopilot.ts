/**
 * Autopilot keyboard glue for an editing card. Thin and stateless: the actual
 * runs are concurrent background tasks in autopilotStore (so you can fire one
 * and go work another card). Runs START from clickable nudges (owner call
 * 2026-07-05 — Tab no longer triggers AI, so Tab does its native job:
 * moving between table cells). Keys only manage a RUNNING fill:
 *
 *   Esc           → stop this card's fill
 *   any input key → yield instantly (abort; the keystroke takes over)
 */

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { type TLShapeId } from 'tldraw';
import { abortAutopilot, isAutopilotRunning } from './autopilotStore';

export function useAutopilot() {
  const onKeyDown = useCallback((shapeId: TLShapeId, e: ReactKeyboardEvent) => {
    if (!isAutopilotRunning(shapeId)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // stop the fill, don't exit edit mode
      abortAutopilot(shapeId);
      return;
    }
    const typing =
      (e.key.length === 1 && !e.metaKey && !e.ctrlKey) ||
      e.key === 'Enter' ||
      e.key === 'Backspace' ||
      e.key === 'Delete';
    if (typing) abortAutopilot(shapeId); // yield — let the keystroke take over
  }, []);

  return { onKeyDown };
}
