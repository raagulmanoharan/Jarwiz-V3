/**
 * ⌘K command palette — the fast path to asking Jarwiz.
 *
 * Press ⌘K / Ctrl+K anywhere to open; type an instruction; Enter summons.
 * The palette is transparent about *what Jarwiz sees*: it reflects the
 * current selection live (Kuse-style), so you know whether the run will act on
 * your selected cards or whether you need to pick one first. Esc or a backdrop
 * click closes it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, useValue, type TLShape } from 'tldraw';
import { Sparkle } from 'lucide-react';
import { isCardShape } from './runRequest';

interface CommandPaletteProps {
  /** Ask Jarwiz, optionally with a steering brief (tone/length/audience…). */
  onAsk: (brief?: string) => void;
}

export function CommandPalette({ onAsk }: CommandPaletteProps) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const briefRef = useRef<HTMLTextAreaElement>(null);

  // Focus the brief whenever the palette opens.
  useEffect(() => {
    if (open) {
      setBrief('');
      briefRef.current?.focus();
    }
  }, [open]);

  // Live "what Jarwiz sees" — the selected cards this run would act on.
  const selectedCards = useValue(
    'jarwiz palette selection',
    () =>
      editor
        .getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter(isCardShape),
    [editor],
  );

  // ⌘K / Ctrl+K toggles; Esc closes. Bound on window so it works canvas-wide.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const summon = useCallback(() => {
    setOpen(false);
    onAsk(brief.trim() || undefined);
  }, [onAsk, brief]);

  if (!open) return null;

  const count = selectedCards.length;
  const sourceTitle = describeSelection(selectedCards);

  return (
    <div className="jz-palette-backdrop" onPointerDown={() => setOpen(false)}>
      <div
        className="jz-palette"
        role="dialog"
        aria-label="Ask Jarwiz"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Shift+Enter inserts a newline in the brief; Enter summons.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            summon();
          }
        }}
      >
        <div className="jz-palette-context">
          {count > 0 ? (
            <>
              <span className="jz-palette-context-dot" aria-hidden />
              <span className="jz-palette-context-text">
                Acting on <strong>{sourceTitle}</strong>
              </span>
            </>
          ) : (
            <span className="jz-palette-context-text jz-palette-context-empty">
              Select a card first — Jarwiz works from what you choose.
            </span>
          )}
        </div>

        <textarea
          ref={briefRef}
          className="jz-palette-brief"
          value={brief}
          rows={2}
          placeholder="Ask Jarwiz anything — tone, length, audience, format…"
          onChange={(e) => setBrief(e.currentTarget.value)}
        />

        <button
          className="jz-palette-summon"
          onClick={summon}
          disabled={count === 0}
        >
          <Sparkle size={14} strokeWidth={1.7} fill="currentColor" aria-hidden />
          Ask Jarwiz
        </button>

        <div className="jz-palette-footer">
          <span><kbd>↵</kbd> ask</span>
          <span><kbd>shift</kbd>+<kbd>↵</kbd> newline</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/** A short, honest label for the current selection. */
function describeSelection(cards: TLShape[]): string {
  const first = cards[0];
  if (!first) return 'nothing';
  const props = first.props as { title?: string; text?: string; url?: string };
  const label = (props.title || props.text || props.url || 'a card').toString().trim();
  const trimmed = label.length > 32 ? `${label.slice(0, 32)}…` : label;
  if (cards.length === 1) return `“${trimmed}”`;
  return `“${trimmed}” + ${cards.length - 1} more`;
}
