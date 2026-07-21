/**
 * Formatted (WYSIWYG) editor for doc cards — double-click a doc and edit it as
 * it looks, never as raw markdown. A thin TipTap wrapper over the ProseMirror
 * model; all markdown ↔ editor conversion (and its content-safety) lives in
 * ui/docBridge. The card owns when this mounts (edit mode) and stores the
 * serialized markdown, so this component is otherwise stateless.
 *
 * Docs using dialect-only syntax (```map / ```widget / [p.N] citations) never
 * reach here — the card routes them to the raw-text editor (see docBridge
 * `docHasSpecialSyntax`), so nothing this editor can't represent is ever at risk.
 */

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { stopEventPropagation } from 'tldraw';
import { mdToDoc, docToMd } from './docBridge';
import { setActiveRichEditor } from './richDocRegistry';

interface RichDocEditorProps {
  /** The doc's markdown at mount — the editor is uncontrolled thereafter. */
  initialMarkdown: string;
  /** Fires on every edit with the re-serialized markdown (dialect-faithful). */
  onChange: (markdown: string) => void;
  /** Escape / done — the card exits edit mode. */
  onExit?: () => void;
  /** Content height in px, so the card can grow to fit (grow-only). */
  onHeight?: (px: number) => void;
  /** Extra class on the root — e.g. `jz-doc-rich--focus` for the full-page editor. */
  className?: string;
}

export function RichDocEditor({ initialMarkdown, onChange, onExit, onHeight, className }: RichDocEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editor = useEditor({
    extensions: [
      // Only h1–h3 exist in the doc dialect (DocMarkdown renders # / ## / ###).
      // orderedList is OFF: the markdown dialect has no `1.` serializer
      // (docBridge) or renderer (DocMarkdown), so a numbered list would
      // round-trip to an empty string and silently lose the user's content.
      // Bullet + task lists stay (they serialize as `- ` / `- [ ]`).
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, orderedList: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      TaskList,
      TaskItem.configure({ nested: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: mdToDoc(initialMarkdown),
    autofocus: 'end',
    onUpdate: ({ editor }) => onChange(docToMd(editor.getJSON())),
  });

  // Expose this editor to the format bar (CardActionBar) so its B/I/U/list/
  // table/image buttons drive it. Cleared on unmount (edit mode ends).
  useEffect(() => {
    if (editor) setActiveRichEditor(editor);
    return () => setActiveRichEditor(null);
  }, [editor]);

  // Report content height to the card so it grows to fit while editing — the
  // same job the textarea's scrollHeight did before.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(el.scrollHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [onHeight, editor]);

  return (
    <div
      ref={rootRef}
      className={className ? `jz-doc-rich ${className}` : 'jz-doc-rich'}
      style={{ pointerEvents: 'all' }}
      onPointerDown={stopEventPropagation}
      onPointerMove={stopEventPropagation}
      onPointerUp={stopEventPropagation}
      onKeyDown={(e) => {
        // Escape leaves edit mode; let everything else reach the editor.
        if (e.key === 'Escape') {
          e.preventDefault();
          onExit?.();
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
