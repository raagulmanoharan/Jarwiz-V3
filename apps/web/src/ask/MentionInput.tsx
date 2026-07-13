/**
 * The composer's text field — a contenteditable that carries inline @mention
 * chips alongside prose. A mention is an atomic, non-editable token that stands
 * in for a board card; it can lead the prompt (dropped there when you select a
 * card on canvas) or sit mid-sentence (typed with "@"). Everything else is
 * plain text.
 *
 * Why contenteditable and not a <textarea>: a textarea can't render a chip
 * *inside* the text, and inline references are the whole point — "compare
 * @Pricing with @Competitor" reads where the intent is. We keep the DOM to
 * exactly two node kinds (text nodes with real "\n" newlines, and `.jz-mention`
 * chip spans) by fully controlling input/paste/Enter, so serialization stays
 * trivial and the caret never lands somewhere surprising.
 *
 * React never renders children into the editable (the element is self-closing);
 * chips are inserted/removed imperatively. That's the standard contenteditable
 * pattern — it lets the browser own the caret while React owns everything else,
 * and a parent re-render can't clobber the live DOM.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

/** A board card that can be referenced — id, a short label, its shape kind. */
export interface MentionCard {
  id: string;
  label: string;
  kind: string;
}

/** The composer's serialized value on every change. */
export interface MentionModel {
  /** Prose only — mention chips contribute nothing. Drives "/" detection,
   *  shape suggestion, and the "is there anything to send" gate. */
  plainText: string;
  /** The prompt as sent: prose with each mention rendered as its label, so the
   *  model reads "@Pricing" as the card it names (the sources carry content). */
  promptText: string;
  /** The referenced card ids, in document order. These are the ask's grounds. */
  mentionIds: string[];
}

export interface MentionInputHandle {
  focus(): void;
  clear(): void;
  /** Replace the prose (drops all chips) and put the caret at the end — used
   *  when a ready-made prompt is dropped in (a comment's "let Jarwiz fix it",
   *  a starter). Any grounding chips re-appear via selection reconciliation. */
  setText(text: string): void;
  /** Add a chip for a card. `prepend` leads the prompt (selection-origin);
   *  otherwise it lands at the caret. No-op if the card is already mentioned.
   *  Programmatic — does NOT fire onUserRemoveMention. */
  insertMention(card: MentionCard, opts?: { prepend?: boolean }): void;
  /** Remove a card's chip. Programmatic — does NOT fire onUserRemoveMention. */
  removeMention(id: string): void;
}

interface MentionInputProps {
  placeholder: string;
  /** All askable board cards, for the "@" picker (already-mentioned excluded). */
  cardOptions: MentionCard[];
  onChange(model: MentionModel): void;
  /** The user picked a card from the "@" menu (a reference, not a selection). */
  onUserAddMention(id: string): void;
  /** The user removed a chip — the ✕ or a Backspace. Parent deselects / drops
   *  the typed ref. Not fired for programmatic insert/removeMention. */
  onUserRemoveMention(id: string): void;
  /** Key events when the "@" menu is closed (Enter-to-send, the "/" menu). */
  onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void;
  onFocus(): void;
  onBlur(): void;
  /** Pasted files — return true to consume (attach) instead of inserting text. */
  onPasteFiles(files: File[]): boolean;
  /** Pasted text — return true to consume (attach) instead of inserting text. */
  onPasteText(text: string): boolean;
}

/** Serialize the editable's DOM to the model. Only two node kinds exist by
 *  construction; anything else (a stray block from an odd paste) is walked. */
function serialize(root: HTMLElement): MentionModel {
  let plainText = '';
  let promptText = '';
  const mentionIds: string[] = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent ?? '';
        plainText += t;
        promptText += t;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.classList.contains('jz-mention')) {
          const id = el.getAttribute('data-id');
          const label = el.getAttribute('data-label') ?? '';
          if (id) {
            mentionIds.push(id);
            promptText += label;
          }
        } else if (el.tagName === 'BR') {
          plainText += '\n';
          promptText += '\n';
        } else {
          if (plainText && !plainText.endsWith('\n')) {
            plainText += '\n';
            promptText += '\n';
          }
          walk(el);
        }
      }
    });
  };
  walk(root);
  return { plainText, promptText, mentionIds };
}

/** Build a mention chip element for a card. It's contenteditable=false so the
 *  browser treats it as one atom; the ✕ removes it explicitly. */
function makeChip(card: MentionCard, onRemove: (id: string, el: HTMLElement) => void): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'jz-mention';
  chip.contentEditable = 'false';
  chip.setAttribute('data-id', card.id);
  chip.setAttribute('data-label', card.label);
  const label = document.createElement('span');
  label.className = 'jz-mention-label';
  label.textContent = card.label;
  chip.appendChild(label);
  const x = document.createElement('button');
  x.className = 'jz-mention-x';
  x.type = 'button';
  x.setAttribute('aria-label', `Remove ${card.label} from context`);
  x.textContent = '✕';
  x.addEventListener('mousedown', (e) => {
    // mousedown (not click) so the chip goes before the editable's blur steals
    // focus; preventDefault keeps the caret in the composer.
    e.preventDefault();
    e.stopPropagation();
    onRemove(card.id, chip);
  });
  chip.appendChild(x);
  return chip;
}

/** The "@query" run immediately before a collapsed caret, if any. Card titles
 *  hold spaces, so the query runs from the last "@" (at a word boundary) up to
 *  the caret — the menu filters live as it grows. */
function mentionQueryAt(root: HTMLElement): { query: string; textNode: Text; at: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  const text = (node as Text).textContent ?? '';
  const before = text.slice(0, sel.anchorOffset);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // The "@" must start a run: at the string start or after whitespace.
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  // A newline in the run means the "@" is stale (menu shouldn't span lines).
  if (query.includes('\n')) return null;
  return { query, textNode: node as Text, at };
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(function MentionInput(
  {
    placeholder,
    cardOptions,
    onChange,
    onUserAddMention,
    onUserRemoveMention,
    onKeyDown,
    onFocus,
    onBlur,
    onPasteFiles,
    onPasteText,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const prevIds = useRef<string[]>([]);
  // The live "@" query and menu highlight. null query = menu closed.
  const [query, setQuery] = useState<string | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  // Where the "@" menu floats — anchored to the caret (left) and just above its
  // line (bottom), both relative to the composer, like a typical mention popup.
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);

  const matches =
    query === null
      ? []
      : cardOptions
          .filter((c) => !prevIds.current.includes(c.id))
          .filter((c) => (query ? c.label.toLowerCase().includes(query.toLowerCase()) : true))
          .slice(0, 6);

  /** Recompute the model, emit it, and fire onUserRemoveMention for any chip
   *  that vanished since the last sync (a Backspace over a chip). Programmatic
   *  removals suppress that via `silentRemovals`. */
  const syncModel = useCallback(
    (silentRemovals?: Set<string>) => {
      const root = rootRef.current;
      if (!root) return;
      const model = serialize(root);
      const gone = prevIds.current.filter((id) => !model.mentionIds.includes(id));
      prevIds.current = model.mentionIds;
      root.classList.toggle('jz-mention-empty', model.plainText.trim() === '' && model.mentionIds.length === 0);
      for (const id of gone) {
        if (!silentRemovals?.has(id)) onUserRemoveMention(id);
      }
      onChange(model);
    },
    [onChange, onUserRemoveMention],
  );

  const removeChip = useCallback(
    (id: string, el: HTMLElement, silent: boolean) => {
      el.remove();
      syncModel(silent ? new Set([id]) : undefined);
      rootRef.current?.focus();
    },
    [syncModel],
  );

  const insertNodeAtCaret = useCallback((node: Node, trailingSpace: boolean) => {
    const root = rootRef.current;
    if (!root) return;
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      // Not focused in the editable — drop it at the very end.
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    let tail: Node = node;
    if (trailingSpace) {
      const space = document.createTextNode(' ');
      node.parentNode?.insertBefore(space, node.nextSibling);
      tail = space;
    }
    const after = document.createRange();
    after.setStartAfter(tail);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => rootRef.current?.focus(),
      clear: () => {
        const root = rootRef.current;
        if (!root) return;
        root.textContent = '';
        prevIds.current = [];
        setQuery(null);
        syncModel();
      },
      setText: (text: string) => {
        const root = rootRef.current;
        if (!root) return;
        root.textContent = text;
        prevIds.current = [];
        setQuery(null);
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(root);
        r.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(r);
        syncModel();
      },
      insertMention: (card, opts) => {
        const root = rootRef.current;
        if (!root || prevIds.current.includes(card.id)) return;
        const chip = makeChip(card, (id, el) => removeChip(id, el, false));
        if (opts?.prepend) {
          root.insertBefore(chip, root.firstChild);
          const space = document.createTextNode(' ');
          root.insertBefore(space, chip.nextSibling);
        } else {
          insertNodeAtCaret(chip, true);
        }
        syncModel(new Set([card.id])); // programmatic: no user-removal echo
      },
      removeMention: (id) => {
        const el = rootRef.current?.querySelector<HTMLElement>(`.jz-mention[data-id="${CSS.escape(id)}"]`);
        if (el) removeChip(id, el, true);
      },
    }),
    [insertNodeAtCaret, removeChip, syncModel],
  );

  const commitMention = useCallback(
    (card: MentionCard) => {
      const root = rootRef.current;
      const q = mentionQueryAt(root!);
      if (root && q) {
        // Delete the "@query" text, then drop the chip in its place.
        const r = document.createRange();
        r.setStart(q.textNode, q.at);
        r.setEnd(q.textNode, q.at + q.query.length + 1);
        r.deleteContents();
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
      const chip = makeChip(card, (id, el) => removeChip(id, el, false));
      insertNodeAtCaret(chip, true);
      setQuery(null);
      setMenuIdx(0);
      onUserAddMention(card.id);
      syncModel(new Set([card.id])); // the add is reported via onUserAddMention
    },
    [insertNodeAtCaret, onUserAddMention, removeChip, syncModel],
  );

  // The caret's position relative to the composer wrapper: x from the last
  // character before it (a collapsed range gives an empty rect in some
  // browsers, so we measure the preceding glyph — the "@" is always there),
  // y as the gap from the wrapper's bottom up to the caret line.
  const caretPos = useCallback((): { left: number; bottom: number } | null => {
    const wrap = wrapRef.current;
    const sel = window.getSelection();
    if (!wrap || !sel || sel.rangeCount === 0) return null;
    const wrapRect = wrap.getBoundingClientRect();
    const node = sel.anchorNode;
    let x = wrapRect.left + 4;
    let top = wrapRect.top;
    if (node && node.nodeType === Node.TEXT_NODE && sel.anchorOffset > 0) {
      const r = document.createRange();
      r.setStart(node, sel.anchorOffset - 1);
      r.setEnd(node, sel.anchorOffset);
      const rect = r.getBoundingClientRect();
      if (rect.width || rect.height) {
        x = rect.right;
        top = rect.top;
      }
    }
    const left = Math.max(0, Math.min(x - wrapRect.left, wrapRect.width - 232));
    const bottom = wrapRect.bottom - top + 8;
    return { left, bottom };
  }, []);

  const refreshQuery = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = mentionQueryAt(root);
    if (q === null) {
      setQuery(null);
      return;
    }
    setQuery((prev) => {
      if (prev !== q.query) setMenuIdx(0);
      return q.query;
    });
    setMenuPos(caretPos());
  }, [caretPos]);

  const handleInput = useCallback(() => {
    syncModel();
    refreshQuery();
  }, [refreshQuery, syncModel]);

  const insertText = useCallback(
    (text: string) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      const after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Shield tldraw's canvas shortcuts from composer typing (a bare "v" must
      // not switch tools while you're writing a prompt).
      e.stopPropagation();
      if (query !== null && matches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMenuIdx((i) => Math.min(i + 1, matches.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMenuIdx((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          commitMention(matches[menuIdx] ?? matches[0]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setQuery(null);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Send — the parent owns submit. Never let contenteditable insert a <br>.
        e.preventDefault();
        onKeyDown(e);
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        // Soft newline as a real "\n" (white-space: pre-wrap renders it), so the
        // DOM stays flat instead of sprouting a <div>/<br>.
        e.preventDefault();
        insertText('\n');
        syncModel();
        return;
      }
      onKeyDown(e);
    },
    [commitMention, insertText, matches, menuIdx, onKeyDown, query, syncModel],
  );

  const handlePaste = useCallback(
    (e: ReactClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(e.clipboardData.files);
      if (files.length && onPasteFiles(files)) {
        e.preventDefault();
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      if (text && onPasteText(text)) {
        e.preventDefault();
        return;
      }
      if (text) {
        e.preventDefault();
        insertText(text);
        handleInput();
      }
    },
    [handleInput, insertText, onPasteFiles, onPasteText],
  );

  // Keep the placeholder overlay honest on mount.
  useEffect(() => {
    rootRef.current?.classList.add('jz-mention-empty');
  }, []);

  return (
    <div className="jz-mention-wrap" ref={wrapRef}>
      <div
        ref={rootRef}
        className="jz-promptbar-input jz-mention-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Prompt"
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={refreshQuery}
        onMouseUp={refreshQuery}
        onPaste={handlePaste}
        onFocus={onFocus}
        onBlur={() => {
          // Let a menu click land before the menu unmounts on blur.
          window.setTimeout(() => setQuery(null), 120);
          onBlur();
        }}
      />
      {query !== null ? (
        <div
          className="jz-mention-menu"
          role="menu"
          aria-label="Mention a card"
          style={menuPos ? { left: menuPos.left, bottom: menuPos.bottom } : undefined}
        >
          <span className="jz-mode-menu-title">Mention a card</span>
          {matches.length === 0 ? (
            <span className="jz-mode-item-hint" style={{ padding: '6px 8px' }}>
              {cardOptions.length === 0 ? 'No cards to mention yet' : 'No matching card'}
            </span>
          ) : (
            matches.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                className={`jz-mode-item${i === menuIdx ? ' jz-mode-item--active' : ''}`}
                onMouseEnter={() => setMenuIdx(i)}
                // mousedown so the pick beats the editable's blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitMention(c);
                }}
              >
                <span className="jz-mention-menu-at" aria-hidden>@</span>
                <span className="jz-mode-item-label">{c.label}</span>
                <span className="jz-mode-item-hint">{c.kind}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
});
