/**
 * A one-slot registry for the doc card's active formatted editor.
 *
 * The app's format bar (ask/CardActionBar) historically drove a `<textarea>`.
 * When a doc is edited in the rich (WYSIWYG) editor there's no textarea, so the
 * bar routes its format intents here instead — the same B/I/U/list/table/image
 * buttons, now dispatched as TipTap commands. Only one card edits at a time, so
 * a single slot suffices; RichDocEditor sets it on mount and clears on unmount.
 */

import type { Editor as TiptapEditor } from '@tiptap/react';

let active: TiptapEditor | null = null;

export function setActiveRichEditor(editor: TiptapEditor | null): void {
  active = editor;
}

/** Run a format intent (by the CardActionBar key) against the active rich
 *  editor. Returns false when there's no rich editor (caller falls back to the
 *  textarea path), so the format bar behaves identically on dialect docs. */
export function runRichFormat(key: string, arg?: { src?: string; alt?: string }): boolean {
  if (!active) return false;
  const chain = active.chain().focus();
  switch (key) {
    case 'bold': chain.toggleBold().run(); return true;
    case 'italic': chain.toggleItalic().run(); return true;
    case 'underline': chain.toggleUnderline().run(); return true;
    case 'strike': chain.toggleStrike().run(); return true;
    case 'bullets': chain.toggleBulletList().run(); return true;
    case 'checklist': chain.toggleTaskList().run(); return true;
    case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); return true;
    case 'image':
      if (!arg?.src) return false;
      chain.setImage({ src: arg.src, alt: arg.alt ?? '' }).run();
      return true;
    default:
      return false;
  }
}
