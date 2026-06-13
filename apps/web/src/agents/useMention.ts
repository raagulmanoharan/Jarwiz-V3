/**
 * Card-side glue for @mention. The card calls `sync` on every change (to open /
 * close the picker as you type "@…") and routes keydowns through `onKeyDown`
 * first — when the picker is open, Enter/Tab summons the top match and Esc
 * closes it; otherwise the key falls through to Autopilot.
 */

import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEditor, type TLShapeId } from 'tldraw';
import { bestAgent, closeMention, commitMention, getMention, syncMention } from './mention';

export function useMention() {
  const editor = useEditor();

  const sync = useCallback((cardId: TLShapeId, value: string, caret: number) => {
    syncMention(cardId, value, caret);
  }, []);

  /** Returns true if it handled the key (the card should then skip Autopilot). */
  const onKeyDown = useCallback(
    (cardId: TLShapeId, e: ReactKeyboardEvent): boolean => {
      const m = getMention();
      if (!m || m.cardId !== cardId) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMention();
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const agent = bestAgent(m.query);
        e.preventDefault();
        e.stopPropagation();
        if (agent) commitMention(editor, cardId, agent.id);
        else closeMention();
        return true;
      }
      return false;
    },
    [editor],
  );

  return { sync, onKeyDown };
}
