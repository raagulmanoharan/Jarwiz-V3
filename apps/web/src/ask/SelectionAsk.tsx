/**
 * "Ask about this passage" — appears when you select text in a PDF reader. It
 * runs the Ask pipeline grounded in the exact passage (and its page), and marks
 * that passage as a highlight so the answer's [p.N] citation returns you to it.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor } from 'tldraw';
import { getPdfSelection, setPdfSelection, subscribePdfSelection } from '../pdf/pdfSelection';
import { setPdfHighlight } from '../pdf/pdfHighlight';
import { useAsk } from './useAsk';
import { JarwizSpark } from '../ui/JarwizSpark';

export function SelectionAsk() {
  const editor = useEditor();
  const { ask, isAsking } = useAsk();
  const selection = useSyncExternalStore(subscribePdfSelection, getPdfSelection, getPdfSelection);

  if (!selection || isAsking) return null;

  const ask_ = () => {
    const { shapeId, page, text } = selection;
    setPdfHighlight(shapeId, { page, quote: text });
    void ask(
      `From page ${page} of the document, explain this passage and its implications:\n"${text}"`,
      [shapeId],
    );
    setPdfSelection(null);
  };

  const style = { left: selection.x, top: selection.y + 8 } as CSSProperties;

  return (
    <button className="jz-selask" style={style} onPointerDown={stopEventPropagation} onClick={ask_}>
      <span className="jz-ask-spark" aria-hidden><JarwizSpark size={12} /></span>
      Ask about this passage
    </button>
  );
}
