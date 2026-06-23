/**
 * Tool rail — Flora-style vertical nav column on the left edge.
 *
 * Top:    ⊕  Plus (primary create, prominent white circle)
 *            Hand (pan the canvas)
 *            Comment (stub)
 *            Search (stub)
 * Divider
 * Bottom: Folder (stub)
 *         Help (stub)
 */

import { stopEventPropagation, useEditor, useValue } from 'tldraw';

export function ToolRail() {
  const editor = useEditor();
  const toolId = useValue('rail-tool', () => editor.getCurrentToolId(), [editor]);

  return (
    <div className="jz-rail" onPointerDown={stopEventPropagation}>
      <PlusButton />
      <RailTool icon={<HandIcon />} label="Pan (H)" active={toolId === 'hand'} onClick={() => editor.setCurrentTool('hand')} />
      <RailTool icon={<CommentIcon />} label="Comment" active={false} onClick={() => console.info('[jarwiz] comments coming soon')} />
      <RailTool icon={<SearchIcon />} label="Search" active={false} onClick={() => console.info('[jarwiz] search coming soon')} />
      <span className="jz-rail-divider" aria-hidden />
      <RailTool icon={<FolderIcon />} label="Files" active={false} onClick={() => console.info('[jarwiz] files coming soon')} />
      <RailTool icon={<HelpIcon />} label="Help" active={false} onClick={() => console.info('[jarwiz] help coming soon')} />
    </div>
  );
}

function PlusButton() {
  return (
    <button
      className="jz-rail-plus"
      title="Create"
      aria-label="Create"
      onClick={() => console.info('[jarwiz] create menu coming soon')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

function RailTool({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`jz-rail-tool${active ? ' jz-rail-tool--active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function HandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 11V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-1.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L7 15.5c-.8-1.2.9-2.6 1.9-1.5L10 15" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}
