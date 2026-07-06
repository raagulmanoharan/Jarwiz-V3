/**
 * The card action bar — floats just ABOVE the selected card(s), so the
 * operations sit visually on the thing they act on (anchored via
 * useCardAnchor, camera-tracked, clamped clear of the topbar). It holds
 * one-tap OPERATIONS on the artifact: the Refine ▾ transforms. Typed/open
 * questions live in the prompt bar; provenance lives in the drawn edges.
 */

import { useRef, useState, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue, type Editor, type TLShapeId } from 'tldraw';
import { Bold, Italic, Underline, Strikethrough, List, ListTodo, Maximize2, Table2, Image as ImageIcon } from 'lucide-react';
import { AFFINITY_COLORS, NOTE_PAPER, PROTOTYPE_PROMPT_SIZE, type NoteCardShape, type PrototypeCardShape } from '../shapes';
import { ASKABLE, hasAskableContent } from './askable';
import { formatControlledTextarea, insertBlock, insertTableBlock, toggleInline, toggleLinePrefix, type FormatResult } from './textFormat';
import { uploadAsset } from '../lib/uploadAsset';
import { openDocFocus } from '../ui/focusDoc';
import { PROFILE_PROMPT } from './profilePrompt';
import { useAsk } from './useAsk';
import { useDiagram } from '../agents/useDiagram';
import { useDashboard } from '../agents/useDashboard';
import { gridIsDashboardable } from '../lib/dashboardable';
import { refreshPrototype } from '../agents/prototypeRefresh';
import { useTidy, canTidy } from '../agents/useTidy';
import { useCluster, canCluster } from '../agents/useCluster';
import { useCardAnchor } from './useCardAnchor';

const ANSWER = new Set(['doc-card', 'table-card', 'diagram-card']);
type Transform = { label: string; run: () => void };

/** The sticky's muted palette — the refine bar doubles as its colour switcher
 *  (the tldraw style panel is hidden for our cards). */
const STICKY_TINTS = [NOTE_PAPER, ...AFFINITY_COLORS];

const FMT_ICON = { size: 14, strokeWidth: 2 };

/** The text card's format actions — markdown edits over the editing
 *  textarea's selection, one entry per bar button. */
const FORMATS: Array<{ key: string; label: string; icon: React.ReactNode; run: (text: string, s: number, e: number) => FormatResult }> = [
  { key: 'bold', label: 'Bold (⌘B)', icon: <Bold {...FMT_ICON} />, run: (t, s, e) => toggleInline(t, s, e, '**') },
  { key: 'italic', label: 'Italic (⌘I)', icon: <Italic {...FMT_ICON} />, run: (t, s, e) => toggleInline(t, s, e, '*') },
  { key: 'underline', label: 'Underline (⌘U)', icon: <Underline {...FMT_ICON} />, run: (t, s, e) => toggleInline(t, s, e, '__') },
  { key: 'strike', label: 'Strikethrough', icon: <Strikethrough {...FMT_ICON} />, run: (t, s, e) => toggleInline(t, s, e, '~~') },
  { key: 'bullets', label: 'Bullet list', icon: <List {...FMT_ICON} />, run: (t, s, e) => toggleLinePrefix(t, s, e, '- ') },
  { key: 'checklist', label: 'Checklist', icon: <ListTodo {...FMT_ICON} />, run: (t, s, e) => toggleLinePrefix(t, s, e, '- [ ] ') },
];

/** Line-shape formats (bullets/checklist) apply to prose, not table cells. */
const TABLE_FORMAT_KEYS = new Set(['bold', 'italic', 'underline', 'strike']);

/** Apply a format to the card being edited — the doc's textarea, or whichever
 *  table cell holds the focus. Runs through the textarea's own onChange
 *  (formatControlledTextarea), so each surface's write path (auto-title,
 *  cell link-enrichment) stays intact. Outside edit mode the first press
 *  enters it, so the bar is always safe to click. */
export function applyCardFormat(editor: Editor, id: TLShapeId, run: (text: string, s: number, e: number) => FormatResult): void {
  if (editor.getEditingShapeId() === id) {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && (active.classList.contains('jz-doc-textarea') || active.classList.contains('jz-table-input'))) {
      formatControlledTextarea(active, run);
      return;
    }
    const docTa = document.querySelector<HTMLTextAreaElement>('.jz-doc-textarea');
    if (docTa) {
      formatControlledTextarea(docTa, run);
      return;
    }
    return;
  }
  editor.setEditingShape(id);
}

export function CardActionBar() {
  const editor = useEditor();
  const { ask } = useAsk();
  const { diagram } = useDiagram();
  const { tidy } = useTidy();
  const { cluster } = useCluster();
  const { buildDashboard } = useDashboard();
  const [menu, setMenu] = useState<null | 'refine' | 'tint' | 'more'>(null);
  // Hidden picker for "insert image" — uploads to the blob store, then drops
  // a markdown image at the caret (the doc card renders it inline).
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageTargetRef = useRef<TLShapeId | null>(null);

  const onPickImage = async (file: File | undefined, cardId: TLShapeId) => {
    if (!file) return;
    editor.setEditingShape(cardId); // mount the textarea so the caret exists
    try {
      const { url } = await uploadAsset(file, 'image');
      const alt = file.name.replace(/\.[a-z0-9]+$/i, '');
      applyCardFormat(editor, cardId, (t, s, e) => insertBlock(t, s, e, `![${alt}](${url})`, alt));
    } catch {
      /* upload failed — leave the card untouched */
    }
  };

  // One or more askable shapes selected → the bar lights up (same place always).
  const sel = useValue(
    'cardbar-selection',
    () => {
      const ids = editor.getSelectedShapeIds().filter((i) => { const t = editor.getShape(i)?.type; return t ? ASKABLE.has(t) : false; });
      if (ids.length === 0) return null;
      if (ids.length > 1) {
        const pdfCount = ids.filter((i) => editor.getShape(i)?.type === 'pdf-card').length;
        return { multi: true as const, ids, pdfCount, type: '', id: ids[0]! };
      }
      const id = ids[0]!;
      const s = editor.getShape(id)!;
      return { multi: false as const, ids, id, type: s.type };
    },
    [editor],
  );

  // dy clears the card's OUTSIDE title tag (doc/table titles render above the
  // card's top edge) — at -10 the bar sat on top of them.
  const anchor = useCardAnchor((sel?.ids ?? null) as TLShapeId[] | null, { edge: 'top', dy: -34 });

  // The selected sticky's current tint (drives the palette's "on" dot).
  const stickyColor = useValue(
    'cardbar-sticky-color',
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const s = editor.getShape(ids[0]!);
      return s?.type === 'note-card' ? String((s.props as { color?: string }).color || NOTE_PAPER) : null;
    },
    [editor],
  );

  if (!sel) return null;
  const id = sel.id as TLShapeId;
  const ids = sel.ids as TLShapeId[];
  // Content gate: an empty card has nothing to shorten, deepen, discuss, or
  // summarise — offering those reads as broken. Same predicate the prompt
  // bar's starter chips use.
  const contentful = ids.filter((i) => hasAskableContent(editor, editor.getShape(i)));
  const hasContent = !sel.multi && contentful.length === 1;

  const transforms: Transform[] = [];
  if (!sel.multi && hasContent && ANSWER.has(sel.type)) {
    transforms.push(
      { label: 'Make it shorter', run: () => ask('Make this shorter and tighter, keeping the key points.', [id], { targetId: id, skipClarify: true }) },
      { label: 'Go deeper', run: () => ask('Go deeper — add detail, nuance, and specifics.', [id], { targetId: id, skipClarify: true }) },
    );
    if (sel.type !== 'table-card') transforms.push({ label: 'As a table', run: () => ask('Reformat this as a comparison table.', [id], { skipClarify: true }) });
    if (sel.type !== 'diagram-card') transforms.push({ label: 'As a diagram', run: () => ask('Turn this into a diagram.', [id], { skipClarify: true }) });
    transforms.push({ label: 'Regenerate', run: () => ask('Regenerate this, same intent, fresh take.', [id], { targetId: id }) });
  }
  // A link card with extracted page text refines like a document — the page
  // content is on the card, so these read the page, not just its meta tags.
  if (!sel.multi && hasContent && sel.type === 'link-card') {
    const pageText = String((editor.getShape(id)?.props as Record<string, unknown>)?.text ?? '');
    if (pageText.trim()) {
      transforms.push(
        { label: '✦ Summarise the page', run: () => ask('Summarise this page — what it is, the key points, and anything actionable.', [id], { skipClarify: true, logLabel: 'Summarized the page' }) },
        { label: 'Key takeaways', run: () => ask('Extract the key takeaways from this page as a short, specific list.', [id], { skipClarify: true }) },
      );
    }
  }
  // A UI prototype refines as a design, not as prose — offer moves that reshape
  // the rendered interface, kept in place (the refine keeps the prototype format).
  if (!sel.multi && hasContent && sel.type === 'prototype-card') {
    transforms.push(
      { label: '✦ Refine the design', run: () => ask('Refine this UI prototype — improve the visual hierarchy, spacing, and polish, keeping the same intent and content.', [id], { targetId: id, skipClarify: true, logLabel: 'Refined the prototype' }) },
      { label: 'Try another layout', run: () => ask('Redesign this UI with a different layout, same content and purpose.', [id], { targetId: id, skipClarify: true }) },
      // Reset reloads the live UI to its initial state (no model call) — undo a
      // running timer, a filled form, a screen you navigated to.
      { label: '↻ Reset', run: () => refreshPrototype(id) },
      { label: 'Regenerate', run: () => ask('Regenerate this UI prototype, same intent, fresh take.', [id], { targetId: id }) },
    );
  }
  // An image is a vision input — offer moves that read the picture.
  if (!sel.multi && hasContent && sel.type === 'image-card') {
    transforms.push(
      { label: '✦ Describe this', run: () => ask('Describe what you see in this image — subject, composition, colours, and any text.', [id], { skipClarify: true, logLabel: 'Described the image' }) },
      { label: 'Extract the text', run: () => ask('Transcribe any text visible in this image, exactly, as a list.', [id], { skipClarify: true }) },
    );
  }
  // A video reads from its transcript and watched frames — offer moves that
  // fit motion content (only once it has been processed).
  if (!sel.multi && sel.type === 'youtube-card') {
    const vp = editor.getShape(id)?.props as Record<string, unknown> | undefined;
    const processed = vp?.hasTranscript === true || (Array.isArray(vp?.frames) && vp!.frames.length > 0);
    if (processed) {
      transforms.push(
        { label: '✦ Summarise the video', run: () => ask('Summarise this video — what it covers and the key points, in order.', [id], { skipClarify: true, logLabel: 'Summarised the video' }) },
        { label: 'Key moments', run: () => ask('List the key moments of this video with their timestamps.', [id], { skipClarify: true }) },
        { label: 'Dissect the style', run: () => ask('Dissect this video’s editing and narration style: hook, pacing, cut rhythm, tone, and how it closes.', [id], { skipClarify: true }) },
      );
    }
  }
  // A spreadsheet reads like data, not prose — offer analysis moves that fit
  // a grid, plus the shared table/diagram reshapes.
  if (!sel.multi && hasContent && sel.type === 'sheet-card') {
    // Data-aware gate (not regex): the SheetCard writes meta.jzDashboardable
    // once its grid loads — offer the interactive dashboard only when the sheet
    // actually holds chartable data (measures × dimensions).
    const sheet = editor.getShape(id);
    if (sheet?.meta?.jzDashboardable) {
      const p = sheet.props as { assetId?: string; name?: string };
      transforms.push({
        label: '✦ Interactive dashboard',
        run: () =>
          buildDashboard(id, p.name ?? '', async () => {
            const res = await fetch(`/api/sheet/${encodeURIComponent(p.assetId ?? '')}/grid`);
            const data = (await res.json()) as { sheets?: { rows: string[][] }[] };
            return data.sheets?.[0]?.rows ?? [];
          }),
      });
    }
    transforms.push(
      { label: 'Key insights', run: () => ask('What are the key insights in this spreadsheet? Call out notable totals, trends, and outliers.', [id], { skipClarify: true, logLabel: 'Analysed the sheet' }) },
      { label: 'Summarise the columns', run: () => ask('Summarise what each column of this spreadsheet holds and what the data is about.', [id], { skipClarify: true }) },
    );
  }
  // A table of numbers is dashboard-able too — same data-shape gate, read
  // straight from the card's cells.
  if (!sel.multi && hasContent && sel.type === 'table-card') {
    const t = editor.getShape(id);
    const tp = t?.props as { columns?: string[]; rows?: string[][] } | undefined;
    const grid = tp ? [tp.columns ?? [], ...(tp.rows ?? [])] : [];
    if (gridIsDashboardable(grid)) {
      transforms.unshift({
        label: '✦ Interactive dashboard',
        run: () => buildDashboard(id, (t?.meta?.jzTitle as string) ?? '', () => grid),
      });
    }
  }
  // The drop-moment profile (docs/PDF-EDGE.md build 3): a dropped PDF or
  // spreadsheet lands selected, so this bar IS the drop moment — Profile
  // rides it as a fixed action (a profile is the file's summary; owner call,
  // 2026-07-04), not buried in the Refine menu.
  const profileable = !sel.multi && hasContent && (sel.type === 'pdf-card' || sel.type === 'sheet-card');

  if (sel.multi && contentful.length > 0) {
    // Multi-select gets the same bar, with cross-selection transforms —
    // as long as at least one selected card actually holds content.
    transforms.push(
      { label: '✦ Summarise the selection', run: () => ask('Summarise the selected cards together into one concise doc.', ids, { skipClarify: true }) },
      { label: '✦ Combine into a doc', run: () => ask('Combine the selected cards into one structured document.', ids, { skipClarify: true }) },
    );
    if (sel.pdfCount >= 2) {
      transforms.push(
        { label: 'Find conflicts', run: () => ask('Find conflicts and contradictions between these documents, clause by clause.', ids, { skipClarify: true }) },
        { label: 'Compare clauses', run: () => ask('Compare these documents clause by clause, showing where each one stands and where they differ.', ids, { skipClarify: true }) },
      );
    }
  }
  if (canCluster(editor, ids)) transforms.push({ label: '✦ Cluster & summarise', run: () => cluster() });
  if (canTidy(editor, ids)) transforms.push({ label: '⤢ Tidy layout', run: () => tidy(ids) });
  // A flowchart is a text-structure move — offer it where there's structure to
  // draw (prose, tables, docs), not on a raw image or video (owner audit,
  // 2026-07-05). Multi-select keeps it — combining cards into a flow is valid.
  const FLOWCHARTABLE = new Set(['doc-card', 'table-card', 'note-card', 'link-card', 'pdf-card', 'sheet-card', 'diagram-card']);
  const flowchartable = sel.multi ? contentful.length > 0 : contentful.length > 0 && FLOWCHARTABLE.has(sel.type);
  if (flowchartable) transforms.push({ label: '◇ Make a flowchart', run: () => diagram('Turn this into a flowchart.', ids) });

  const runTransform = (t: Transform) => { setMenu(null); t.run(); };

  // A sticky always gets its colour switcher — even empty (colour is how the
  // user organises annotations, independent of content).
  const sticky = !sel.multi && sel.type === 'note-card';
  // Text and table cards get the format group — formatting is for WRITING,
  // so it can't gate on already having content. Tables take the inline
  // formats only (bullets/checklists are prose shapes).
  const formattable = !sel.multi && (sel.type === 'doc-card' || sel.type === 'table-card');
  const visibleFormats = sel.type === 'table-card' ? FORMATS.filter((f) => TABLE_FORMAT_KEYS.has(f.key)) : FORMATS;

  // The ⋯ overflow menu (Duplicate / Delete, plus Edit prompt for a prototype)
  // is offered on every single selected card — so a card always has at least
  // this menu, even when it has no refine transforms.
  const showMore = !sel.multi;
  const editPrototypePrompt = () => {
    const s = editor.getShape(id);
    if (s?.type !== 'prototype-card') return;
    // Flip back to the small prompt composer, keeping the prompt, so it can be
    // reworded and regenerated.
    editor.updateShape<PrototypeCardShape>({ id, type: 'prototype-card', props: { html: '', status: 'idle', w: PROTOTYPE_PROMPT_SIZE.w, h: PROTOTYPE_PROMPT_SIZE.h } });
    editor.select(id);
  };
  const moreActions: Transform[] = [];
  if (sel.type === 'prototype-card') moreActions.push({ label: '✎ Edit prompt', run: editPrototypePrompt });
  moreActions.push(
    { label: '⧉ Duplicate', run: () => editor.duplicateShapes([id], { x: 32, y: 32 }) },
    { label: '🗑 Delete', run: () => editor.deleteShapes([id]) },
  );

  // Nothing meaningful to offer (e.g. a single empty card) → no bar at all.
  // Provenance itself needs no button: the drawn edges ARE the lineage.
  if (transforms.length === 0 && !profileable && !sticky && !formattable && !showMore) return null;
  if (!anchor) return null;

  // Flipped below the card (no headroom above), the bar renders downward from
  // its anchor instead of upward — the CSS modifier keeps the entrance
  // animation's transform in agreement.
  const below = anchor.placement === 'below';
  const style: CSSProperties = {
    left: anchor.x,
    top: anchor.y,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  };
  return (
    <div className={`jz-cardbar${below ? ' jz-cardbar--below' : ''}`} style={style} onPointerDown={stopEventPropagation}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          const target = imageTargetRef.current;
          e.currentTarget.value = ''; // let the same file be picked again
          if (target) void onPickImage(file, target);
        }}
      />
      {profileable ? (
        <button
          className="jz-cardbar-btn"
          title="A one-glance summary: what this is, who wrote it, red flags, where to start"
          onClick={() => ask(PROFILE_PROMPT, [id], { skipClarify: true, logLabel: 'Summarized the document' })}
        >
          ✦ Summary
        </button>
      ) : null}
      {formattable ? (
        <div className="jz-cardbar-fmt" role="group" aria-label="Text formatting">
          {visibleFormats.map((f) => (
            <button
              key={f.key}
              className="jz-cardbar-iconbtn"
              title={f.label}
              aria-label={f.label}
              // preventDefault keeps focus (and the selection) in the card's
              // textarea — a normal click would blur it before we can format.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyCardFormat(editor, id, f.run)}
            >
              {f.icon}
            </button>
          ))}
          {sel.type === 'doc-card' ? (
            <>
              <span className="jz-cardbar-fmt-sep" aria-hidden />
              <button
                className="jz-cardbar-iconbtn"
                title="Insert table"
                aria-label="Insert table"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyCardFormat(editor, id, insertTableBlock)}
              >
                <Table2 {...FMT_ICON} />
              </button>
              <button
                className="jz-cardbar-iconbtn"
                title="Insert image"
                aria-label="Insert image"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  imageTargetRef.current = id;
                  imageInputRef.current?.click();
                }}
              >
                <ImageIcon {...FMT_ICON} />
              </button>
              <button
                className="jz-cardbar-iconbtn"
                title="Edit full screen"
                aria-label="Edit full screen"
                onClick={() => openDocFocus(id)}
              >
                <Maximize2 {...FMT_ICON} />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {sticky ? (
        <div className="jz-cardbar-group">
          <button
            className={`jz-cardbar-btn${menu === 'tint' ? ' jz-cardbar-btn--open' : ''}`}
            aria-label="Sticky colour"
            title="Sticky colour"
            onClick={() => setMenu(menu === 'tint' ? null : 'tint')}
          >
            <span className="jz-cardbar-dot" style={{ background: stickyColor ?? NOTE_PAPER }} aria-hidden />
            <span className="jz-cardbar-caret" aria-hidden>▾</span>
          </button>
          {menu === 'tint' ? (
            <div className="jz-cardbar-menu jz-cardbar-menu--tints" role="menu" aria-label="Sticky colour">
              {STICKY_TINTS.map((c) => (
                <button
                  key={c}
                  className={`jz-cardbar-swatch${stickyColor === c ? ' jz-cardbar-swatch--on' : ''}`}
                  style={{ background: c }}
                  role="menuitem"
                  aria-label="Sticky colour"
                  onClick={() => {
                    setMenu(null);
                    editor.updateShape<NoteCardShape>({ id, type: 'note-card', props: { color: c } });
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {transforms.length > 0 ? (
        <div className="jz-cardbar-group">
          <button className={`jz-cardbar-btn${menu === 'refine' ? ' jz-cardbar-btn--open' : ''}`} onClick={() => setMenu(menu === 'refine' ? null : 'refine')}>
            ✦ Actions <span className="jz-cardbar-caret" aria-hidden>▾</span>
          </button>
          {menu === 'refine' ? (
            <div className="jz-cardbar-menu" role="menu">
              {transforms.map((t) => (
                <button key={t.label} className="jz-cardbar-item" onClick={() => runTransform(t)}>{t.label}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {showMore ? (
        <div className="jz-cardbar-group">
          <button
            className={`jz-cardbar-btn jz-cardbar-btn--icon${menu === 'more' ? ' jz-cardbar-btn--open' : ''}`}
            aria-label="More actions"
            title="More"
            onClick={() => setMenu(menu === 'more' ? null : 'more')}
          >
            ⋯
          </button>
          {menu === 'more' ? (
            <div className="jz-cardbar-menu jz-cardbar-menu--right" role="menu">
              {moreActions.map((t) => (
                <button key={t.label} className="jz-cardbar-item" onClick={() => runTransform(t)}>{t.label}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
