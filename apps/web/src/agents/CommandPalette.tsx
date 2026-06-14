/**
 * ⌘K command palette — the fast path to summoning an agent.
 *
 * Press ⌘K / Ctrl+K anywhere to open; arrow keys + Enter or click to pick.
 * The palette is transparent about *what the agent sees*: it reflects the
 * current selection live (Kuse-style), so you know whether the run will act on
 * your selected cards or guides you to pick one first. Esc or a backdrop click
 * closes it. Non-modal to the canvas underneath in spirit, but it traps focus
 * while open so the keyboard path is unambiguous.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useEditor, useValue, type TLShape } from 'tldraw';
import { AGENTS, type AgentMeta } from '@jarwiz/shared';
import { isCardShape } from './runRequest';

interface CommandPaletteProps {
  /** Pick an agent, with an optional steering brief (tone/length/audience…). */
  onPickAgent: (agent: AgentMeta, brief?: string) => void;
}

export function CommandPalette({ onPickAgent }: CommandPaletteProps) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [brief, setBrief] = useState('');
  const briefRef = useRef<HTMLTextAreaElement>(null);

  // Focus the brief whenever the palette opens (you can type an instruction
  // immediately; arrow keys still navigate the agent list via the dialog).
  useEffect(() => {
    if (open) {
      setBrief('');
      briefRef.current?.focus();
    }
  }, [open]);

  // Live "what the agent sees" — the selected cards this run would act on.
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
        setActive(0);
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const pick = useCallback(
    (agent: AgentMeta) => {
      setOpen(false);
      onPickAgent(agent, brief.trim() || undefined);
    },
    [onPickAgent, brief],
  );

  if (!open) return null;

  const count = selectedCards.length;
  const sourceTitle = describeSelection(selectedCards);

  return (
    <div className="jz-palette-backdrop" onPointerDown={() => setOpen(false)}>
      <div
        className="jz-palette"
        role="dialog"
        aria-label="Summon an agent"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % AGENTS.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + AGENTS.length) % AGENTS.length);
          } else if (e.key === 'Enter' && !e.shiftKey) {
            // Shift+Enter inserts a newline in the brief; Enter summons.
            e.preventDefault();
            const agent = AGENTS[active];
            if (agent) pick(agent);
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
              Select a card first — the agent works from what you choose.
            </span>
          )}
        </div>

        <textarea
          ref={briefRef}
          className="jz-palette-brief"
          value={brief}
          rows={1}
          placeholder="Add an instruction — tone, length, audience, format… (optional)"
          onChange={(e) => setBrief(e.currentTarget.value)}
        />

        <div className="jz-palette-list" role="listbox" tabIndex={-1}>
          {AGENTS.map((agent, i) => (
            <button
              key={agent.id}
              role="option"
              aria-selected={i === active}
              className={`jz-palette-item${i === active ? ' jz-palette-item-active' : ''}`}
              style={{ '--agent-color': agent.color } as CSSProperties}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(agent)}
            >
              <span className="jz-palette-avatar">{agent.name[0]}</span>
              <span className="jz-palette-meta">
                <span className="jz-palette-name">{agent.name}</span>
                <span className="jz-palette-tagline">{agent.tagline}</span>
              </span>
              <span className="jz-palette-enter" aria-hidden>
                ↵
              </span>
            </button>
          ))}
        </div>

        <div className="jz-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> summon
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
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
