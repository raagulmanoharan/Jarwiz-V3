import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getActiveBoard, getActiveBoardId, renameBoard, subscribeBoards } from '../boards/boardStore';
import { getTheme, subscribeTheme, toggleTheme } from './theme';
import {
  isSidePanelOpen,
  subscribeSidePanel,
  toggleSidePanel,
} from './sidePanelStore';
import { UltraThink } from './UltraThink';
import { canTidyBoard, useTidyBoard } from '../agents/tidyBoard';

/**
 * Canvas chrome — top bar (Flora-aligned).
 *
 *   Left cluster:   ☰ logo · workspace pill / inline-editable board name + caret
 *   Right cluster:  zoom dropdown · share button · theme toggle
 *
 * Behaviour notes:
 *  - The logo is a round hamburger button that toggles the left side panel
 *    (workspace switcher + board list). The title caret opens the same panel,
 *    so there's a single discoverable surface for "manage boards/workspace".
 *  - The board name itself stays inline-editable: click → edit → Enter to
 *    commit, Escape to cancel, blur to commit.
 *  - The workspace pill above the title is a small rounded rectangle that
 *    also opens the side panel (workspace switching lives there).
 *  - Zoom dropdown owns all zoom controls (the bottom-right ZoomPill is
 *    retired with this commit).
 *  - Theme toggle is a single icon button: sun ⇄ moon, with a gentle scale +
 *    rotation micro-animation honouring prefers-reduced-motion.
 */
export function Topbar() {
  return (
    <div className="jz-topbar">
      <div className="jz-topbar-left">
        <HamburgerLogo />
        <TitleBlock />
      </div>
      <div className="jz-topbar-right">
        <UltraThink />
        <TidyButton />
        <ZoomDropdown />
        <ThemeToggleButton />
      </div>
    </div>
  );
}

/**
 * Round hamburger / logo button. Tapping it toggles the left side panel
 * where workspaces + boards live. The icon is a Jarwiz mark by default and
 * cross-fades to a hamburger glyph when the panel is open — so the same
 * button reads as "brand" at rest and "menu / close" while engaged.
 */
function HamburgerLogo() {
  const open = useSyncExternalStore(subscribeSidePanel, isSidePanelOpen, isSidePanelOpen);
  return (
    <button
      className={`jz-logo-btn${open ? ' jz-logo-btn--open' : ''}`}
      onClick={() => toggleSidePanel()}
      aria-label={open ? 'Close workspace menu' : 'Open workspace menu'}
      aria-expanded={open}
      title="Workspace & boards"
    >
      <span className="jz-logo-glyph jz-logo-glyph--brand" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="jz-logo-glyph jz-logo-glyph--menu" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Title block: editable board name (large) with a dropdown caret for the
 * board switcher, and a clickable workspace pill below.
 */
function TitleBlock() {
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const boardId = useSyncExternalStore(subscribeBoards, getActiveBoardId, getActiveBoardId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board?.name ?? 'Untitled');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the draft in sync if the underlying board name changes (e.g. switch).
  useEffect(() => {
    if (!editing) setDraft(board?.name ?? 'Untitled');
  }, [board?.name, editing]);

  // Auto-focus + select when entering edit mode.
  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== board?.name) renameBoard(boardId, next);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(board?.name ?? 'Untitled');
    setEditing(false);
  };

  return (
    <div className="jz-title-block">
      {editing ? (
        <input
          ref={inputRef}
          className="jz-title-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={commit}
          onPointerDown={stopEventPropagation}
          spellCheck={false}
          maxLength={120}
        />
      ) : (
        <button
          className="jz-title-name-btn"
          onClick={() => setEditing(true)}
          title="Click to rename"
        >
          <span className="jz-title-name">{board?.name ?? 'Untitled'}</span>
        </button>
      )}
      <LastSaved />
    </div>
  );
}

function LastSaved() {
  const editor = useEditor();
  const [status, setStatus] = useState<'saved' | 'saving'>('saved');

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;

    // tldraw fires store.listen on every mutation — use it to detect edits.
    const unsub = editor.store.listen(
      () => {
        setStatus('saving');
        if (debounce) clearTimeout(debounce);
        // tldraw's IndexedDB persist is ~instant; 800 ms covers any lag.
        debounce = setTimeout(() => setStatus('saved'), 800);
      },
      { scope: 'document', source: 'user' },
    );

    return () => {
      unsub();
      if (debounce) clearTimeout(debounce);
    };
  }, [editor]);

  return (
    <span className="jz-last-saved">
      {status === 'saving' ? 'Saving…' : 'Autosaved'}
    </span>
  );
}

/**
 * Global tidy — one tap masonry-packs every card on the board in place (gaps
 * closed, columns preserved; see agents/tidyBoard.ts). Sits beside the zoom
 * controls. Dims to a disabled state when there's nothing to tidy (<2 cards),
 * so it reads as "available only when it'd do something".
 */
function TidyButton() {
  const editor = useEditor();
  const { tidyBoard } = useTidyBoard();
  // Track card count reactively so the button enables/disables as cards land.
  const enabled = useValue('topbar-can-tidy', () => canTidyBoard(editor), [editor]);
  return (
    <button
      className="jz-tidy-btn"
      onClick={() => tidyBoard(undefined, { frame: true })}
      disabled={!enabled}
      title="Tidy up the board"
      aria-label="Tidy up the board"
    >
      <TidyGlyph />
    </button>
  );
}

/** Masonry mark — three columns of differing heights, the "tidy" idea at a glance. */
function TidyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="6" height="10" rx="1.5" />
      <rect x="3" y="15" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="11" width="6" height="10" rx="1.5" />
    </svg>
  );
}

/**
 * Zoom dropdown — the only zoom UI in the chrome. Shows current %, opens a
 * menu with the standard tldraw zoom actions and shortcut hints.
 */
function ZoomDropdown() {
  const editor = useEditor();
  const zoom = useValue('topbar-zoom', () => editor.getZoomLevel(), [editor]);
  const pct = Math.round(zoom * 100);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.jz-zoom-dd-wrap')) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const close = () => setOpen(false);
  const zoomTo = (level: number) => {
    // tldraw's camera is applied before scale (screen = (page + cam) · z), so
    // keeping page point `c` centered requires cam = screenCenter/z − c.
    const c = editor.getViewportPageBounds().center;
    const vp = editor.getViewportScreenBounds();
    editor.setCamera(
      { x: vp.w / 2 / level - c.x, y: vp.h / 2 / level - c.y, z: level },
      { animation: { duration: 200 } },
    );
  };
  const zoomToSelection = () => {
    const sel = editor.getSelectedShapeIds();
    if (sel.length === 0) editor.zoomToFit();
    else editor.zoomToSelection();
  };

  return (
    <div className="jz-zoom-dd-wrap" onPointerDown={stopEventPropagation}>
      <button
        className={`jz-zoom-dd${open ? ' jz-zoom-dd--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Zoom"
        aria-label="Zoom"
      >
        <ZoomGlass />
        <span className="jz-zoom-dd-pct">{pct}%</span>
        <ChevronDown className="jz-zoom-dd-caret" />
      </button>
      {open ? (
        <div className="jz-zoom-menu" role="menu">
          <button className="jz-zoom-item" onClick={() => { editor.zoomIn(); close(); }}>
            <span>Zoom in</span><kbd>⌘+</kbd>
          </button>
          <button className="jz-zoom-item" onClick={() => { editor.zoomOut(); close(); }}>
            <span>Zoom out</span><kbd>⌘−</kbd>
          </button>
          <button className="jz-zoom-item" onClick={() => { editor.zoomToFit(); close(); }}>
            <span>Zoom to fit</span><kbd>⌘1</kbd>
          </button>
          <button className="jz-zoom-item" onClick={() => { zoomToSelection(); close(); }}>
            <span>Zoom to selection</span><kbd>⌘2</kbd>
          </button>
          <div className="jz-zoom-divider" aria-hidden />
          <button className="jz-zoom-item" onClick={() => { zoomTo(0.5); close(); }}>
            <span>Zoom to 50%</span>
          </button>
          <button className="jz-zoom-item" onClick={() => { editor.resetZoom(); close(); }}>
            <span>Zoom to 100%</span><kbd>⌘0</kbd>
          </button>
          <button className="jz-zoom-item" onClick={() => { zoomTo(2); close(); }}>
            <span>Zoom to 200%</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ZoomGlass() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

/** Crisp down-chevron — used by the zoom dropdown (the old "▾" glyph read as
 *  a fat dot in the warm-paper UI). */
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Sun ⇄ moon icon button. The icon scales+rotates briefly on flip; the
 * animation is suppressed when the user prefers reduced motion.
 */
function ThemeToggleButton() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);
  const isDark = theme === 'dark';
  return (
    <button
      className="jz-theme-toggle"
      onClick={toggleTheme}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
    >
      {/* Wrapper keys on theme so the icon remounts and re-runs its CSS
       *  keyframe each toggle — that's the micro-animation. */}
      <span key={theme} className="jz-theme-icon" data-theme={theme}>
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
    </svg>
  );
}
