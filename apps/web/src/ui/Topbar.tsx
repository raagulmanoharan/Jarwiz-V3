import { useEffect, useState, useSyncExternalStore } from 'react';
import { getActiveBoard, subscribeBoards } from '../boards/boardStore';
import { BoardSwitcher } from '../boards/BoardSwitcher';
import { getTheme, subscribeTheme, toggleTheme } from './theme';

/**
 * Canvas chrome — top bar (Flora-aligned).
 *
 *   Left cluster:   ◆ logo · title block (board name / workspace)
 *   Right cluster:  green "Ask Jarwiz" CTA · Share Project · ⋯ profile menu
 *
 * Reference: Flora.app's app bar. We diverge in two places, intentionally:
 *
 *  1. The green CTA reads "Ask Jarwiz" (Flora reads "Generate"). Tapping it
 *     focuses the bottom PromptBar — we keep one typing surface, not two.
 *  2. A small ⋯ profile menu hosts the theme toggle. Flora has neither; we
 *     park it here until a proper settings sheet lands.
 *
 * Drop list (was here, now gone): agent presence avatars, export menu, help
 * button, undo/redo group. Those move to a Cmd-K palette later.
 */
export function Topbar() {
  return (
    <div className="jz-topbar">
      <div className="jz-topbar-left">
        <LogoMark />
        <TitleBlock />
      </div>
      <div className="jz-topbar-right">
        <AskCta />
        <ShareProject />
        <ProfileMenu />
      </div>
    </div>
  );
}

function LogoMark() {
  // Graphical mark — diamond/spark glyph in the brand ink. Kept inline so it
  // theme-flips automatically (currentColor on stroke).
  return (
    <div className="jz-logo" aria-label="Jarwiz">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

function TitleBlock() {
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const [open, setOpen] = useState(false);
  const title = board?.name ?? 'Untitled board';

  return (
    <div className="jz-title-block">
      <button
        className={`jz-title-row${open ? ' jz-title-row--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Switch boards"
      >
        <span className="jz-title-name">{title}</span>
        <span className="jz-title-caret" aria-hidden>▾</span>
      </button>
      <div className="jz-title-sub">Personal workspace</div>
      {open && <BoardSwitcher onClose={() => setOpen(false)} />}
    </div>
  );
}

function AskCta() {
  // Flora's green generate pill. We give it the same affordance shape but a
  // different action: focus the PromptBar input rather than launch our own
  // typing surface (one prompt surface, one place to type).
  const focusPromptBar = () => {
    const el = document.querySelector<HTMLTextAreaElement>('.jz-promptbar-input');
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };
  return (
    <button className="jz-ask-cta" onClick={focusPromptBar} title="Ask Jarwiz (focuses the prompt bar)">
      <span className="jz-ask-cta-spark" aria-hidden>✦</span>
      Ask Jarwiz
    </button>
  );
}

function ShareProject() {
  return (
    <button
      className="jz-share-project"
      title="Share this board (coming soon)"
      onClick={() => {
        // Stub — real sharing lands later. Logged so the user knows it's a
        // placeholder rather than silently doing nothing.
        console.info('[jarwiz] share is not wired up yet');
      }}
    >
      Share Project
    </button>
  );
}

function ProfileMenu() {
  // Known deviation from the Flora screenshot: a single ⋯ button holds the
  // theme toggle. Will move into a settings sheet once one exists.
  const [open, setOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.jz-profile-wrap')) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="jz-profile-wrap">
      <button
        className="jz-profile-dots"
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open ? (
        <div className="jz-profile-menu" role="menu">
          <button
            className="jz-profile-item"
            onClick={() => {
              toggleTheme();
              setOpen(false);
            }}
          >
            <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
            <span className="jz-profile-item-hint">{theme === 'dark' ? '☀' : '☾'}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
