/**
 * Focus mode — a text card opened as a full-screen page (owner call
 * 2026-07-05): Google-Docs-like writing surface over a darkened board.
 * Minimal chrome — title, the same six format controls as the refine bar,
 * close. Edits write straight to the shape, so the card on the canvas is
 * always current and closing needs no save step. Esc or the backdrop closes.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { Bold, Italic, Underline, Strikethrough, List, ListTodo, X } from 'lucide-react';
import { toggleInline, toggleLinePrefix, shortcutMarker, type FormatResult } from '../ask/textFormat';
import { deriveTitle, getShapeTitle, setShapeTitle, titleIsAuto } from '../shapes/shapeTitle';
import type { DocCardShape } from '../shapes';
import type { RichBlock } from '@jarwiz/shared';
import { closeCardFocus, getCardFocus, subscribeCardFocus } from './focusCard';
import { RichBlocks } from './RichBlocks';
import { RichDocEditor } from './RichDocEditor';
import { docHasSpecialSyntax } from './docBridge';
import { runRichFormat } from './richDocRegistry';

const ICON = { size: 15, strokeWidth: 2 };

const FORMATS: Array<{ key: string; label: string; icon: React.ReactNode; run: (t: string, s: number, e: number) => FormatResult }> = [
  { key: 'bold', label: 'Bold (⌘B)', icon: <Bold {...ICON} />, run: (t, s, e) => toggleInline(t, s, e, '**') },
  { key: 'italic', label: 'Italic (⌘I)', icon: <Italic {...ICON} />, run: (t, s, e) => toggleInline(t, s, e, '*') },
  { key: 'underline', label: 'Underline (⌘U)', icon: <Underline {...ICON} />, run: (t, s, e) => toggleInline(t, s, e, '__') },
  { key: 'strike', label: 'Strikethrough', icon: <Strikethrough {...ICON} />, run: (t, s, e) => toggleInline(t, s, e, '~~') },
  { key: 'bullets', label: 'Bullet list', icon: <List {...ICON} />, run: (t, s, e) => toggleLinePrefix(t, s, e, '- ') },
  { key: 'checklist', label: 'Checklist', icon: <ListTodo {...ICON} />, run: (t, s, e) => toggleLinePrefix(t, s, e, '- [ ] ') },
];

export function DocFocusOverlay() {
  const editor = useEditor();
  const focusId = useSyncExternalStore(subscribeCardFocus, getCardFocus, getCardFocus);
  const shape = useValue(
    'focus-doc',
    () => (focusId ? (editor.getShape(focusId) as DocCardShape | undefined) : undefined),
    [editor, focusId],
  );
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Autosize: the textarea's height follows its content, so the PAGE grows
  // and the backdrop scrolls — never an inner scrollbar (owner call).
  const text = shape?.type === 'doc-card' ? (shape as DocCardShape).props.text : '';
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text, focusId]);

  // Esc closes from anywhere in the overlay; the card vanishing closes too.
  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCardFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId]);

  if (!focusId || !shape || shape.type !== 'doc-card') return null;
  const title = getShapeTitle(shape);
  const blocks = Array.isArray(shape.meta?.jzBlocks) ? (shape.meta!.jzBlocks as unknown as RichBlock[]) : null;

  const setText = (value: string) => {
    if (titleIsAuto(shape)) {
      editor.updateShape<DocCardShape>({
        id: shape.id,
        type: 'doc-card',
        props: { text: value, title: deriveTitle(value) },
        meta: { ...shape.meta, jzTitleAuto: true },
      });
    } else {
      editor.updateShape<DocCardShape>({ id: shape.id, type: 'doc-card', props: { text: value } });
    }
  };

  const applyFormat = (run: (t: string, s: number, e: number) => FormatResult) => {
    const ta = taRef.current;
    if (!ta) return;
    const { text: next, selStart, selEnd } = run(ta.value, ta.selectionStart, ta.selectionEnd);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  return (
    <div
      className="jz-focus-backdrop"
      onPointerDown={(e) => {
        stopEventPropagation(e);
        // Only a click on the backdrop itself closes — not clicks in the page.
        if (e.target === e.currentTarget) closeCardFocus();
      }}
    >
      <div className="jz-focus-page" role="dialog" aria-label="Full-screen editor">
        <div className="jz-focus-head">
          <input
            className="jz-focus-title"
            value={title}
            placeholder="Add a title"
            aria-label="Card title"
            onChange={(e) => setShapeTitle(editor, shape, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                taRef.current?.focus();
              }
              // Handled here because stopPropagation keeps the window
              // listener from ever seeing keys typed in the inputs.
              if (e.key === 'Escape') closeCardFocus();
              e.stopPropagation();
            }}
          />
          <div className="jz-focus-tools" role="group" aria-label="Text formatting">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className="jz-cardbar-iconbtn"
                title={f.label}
                aria-label={f.label}
                onMouseDown={(e) => e.preventDefault()}
                // Rich editor active → dispatch as a TipTap command; the
                // textarea path (applyFormat) only runs for dialect docs.
                onClick={() => { if (!runRichFormat(f.key)) applyFormat(f.run); }}
              >
                {f.icon}
              </button>
            ))}
            <button className="jz-cardbar-iconbtn jz-focus-close" title="Close (Esc)" aria-label="Close full-screen editor" onClick={closeCardFocus}>
              <X {...ICON} />
            </button>
          </div>
        </div>
        {blocks && blocks.length > 0 ? (
          // Structured block docs render read-only here (editing blocks is a
          // later phase) — better than an empty text editor.
          <div className="jz-focus-blocks">
            <RichBlocks blocks={blocks} />
          </div>
        ) : docHasSpecialSyntax(text) ? (
          // Dialect docs (map/widget/citations) keep the raw-text editor.
          <textarea
            ref={taRef}
            className="jz-focus-textarea"
            value={text}
            placeholder="Write something…"
            autoFocus
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              const marker = shortcutMarker(e);
              if (marker) {
                e.preventDefault();
                applyFormat((t, s, en) => toggleInline(t, s, en, marker));
                return;
              }
              if (e.key === 'Escape') closeCardFocus();
              e.stopPropagation();
            }}
          />
        ) : (
          // Formatted, full-page editing — same editor as the card, focus-sized.
          <RichDocEditor
            key={focusId}
            initialMarkdown={text}
            onChange={setText}
            onExit={closeCardFocus}
            className="jz-doc-rich--focus"
          />
        )}
      </div>
    </div>
  );
}
