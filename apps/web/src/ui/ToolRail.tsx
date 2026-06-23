/**
 * Tool rail — Flora-style vertical nav column on the left edge.
 * Icons from lucide-react (consistent stroke weight, same family throughout).
 *
 * Cursor → Hand → Text → Upload → Folder → HelpCircle
 */

import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { MousePointer2, Hand, Type, Upload, Folder, HelpCircle } from 'lucide-react';

const ICON_SIZE = 18;
const ICON_PROPS = { size: ICON_SIZE, strokeWidth: 1.7 };

export function ToolRail() {
  const editor = useEditor();
  const toolId = useValue('rail-tool', () => editor.getCurrentToolId(), [editor]);

  return (
    <div className="jz-rail" onPointerDown={stopEventPropagation}>
      <RailTool label="Select (V)" active={toolId === 'select'} onClick={() => editor.setCurrentTool('select')}>
        <MousePointer2 {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Pan (H)" active={toolId === 'hand'} onClick={() => editor.setCurrentTool('hand')}>
        <Hand {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Text (T)" active={toolId === 'text'} onClick={() => editor.setCurrentTool('text')}>
        <Type {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Upload" active={false} onClick={() => console.info('[jarwiz] upload coming soon')}>
        <Upload {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Files" active={false} onClick={() => console.info('[jarwiz] files coming soon')}>
        <Folder {...ICON_PROPS} />
      </RailTool>
      <RailTool label="Help" active={false} onClick={() => console.info('[jarwiz] help coming soon')}>
        <HelpCircle {...ICON_PROPS} />
      </RailTool>
    </div>
  );
}

function RailTool({ children, label, active, onClick }: { children: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`jz-rail-tool${active ? ' jz-rail-tool--active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
