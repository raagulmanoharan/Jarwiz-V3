/**
 * Tool rail — Flora-style vertical nav column on the left edge.
 *
 * Top:    ⊕  Plus (primary create, prominent filled circle)
 *            Cursor / Select
 *            Text
 *            Upload
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
      <RailTool icon={<CursorIcon />} label="Select (V)" active={toolId === 'select'} onClick={() => editor.setCurrentTool('select')} />
      <RailTool icon={<HandIcon />} label="Pan (H)" active={toolId === 'hand'} onClick={() => editor.setCurrentTool('hand')} />
      <RailTool icon={<TextIcon />} label="Text (T)" active={toolId === 'text'} onClick={() => editor.setCurrentTool('text')} />
      <RailTool icon={<UploadIcon />} label="Upload" active={false} onClick={() => console.info('[jarwiz] upload coming soon')} />
      <RailTool icon={<FolderIcon />} label="Files" active={false} onClick={() => console.info('[jarwiz] files coming soon')} />
      <RailTool icon={<HelpIcon />} label="Help" active={false} onClick={() => console.info('[jarwiz] help coming soon')} />
    </div>
  );
}


function RailTool({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`jz-rail-tool${active ? ' jz-rail-tool--active' : ''}`}
      title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function CursorIcon() {
  return <svg {...S}><path d="M5 3l14 9-7 1-4 7z" /></svg>;
}

function HandIcon() {
  return (
    <svg {...S}>
      <path d="M18 11V8a2 2 0 0 0-4 0v3" />
      <path d="M14 10V6a2 2 0 0 0-4 0v4" />
      <path d="M10 10.5V5a2 2 0 0 0-4 0v9" />
      <path d="m7 15-1.8-1.8a2 2 0 0 0-2.8 2.8L7 21h6c1.5 0 3-1 3.7-2.4l.3-.6c.4-.8.7-1.7.7-2.6V11a2 2 0 0 0-4 0v3" />
    </svg>
  );
}

function TextIcon() {
  return <svg {...S}><path d="M4 6h16M12 6v13M9 19h6" /></svg>;
}

function UploadIcon() {
  return (
    <svg {...S}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FolderIcon() {
  return <svg {...S}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>;
}

function HelpIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
