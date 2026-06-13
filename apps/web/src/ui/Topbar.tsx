import { createShapeId, useEditor } from 'tldraw';
import { NOTE_CARD_SIZE, TABLE_CARD_SIZE, starterTableProps, type NoteCardShape, type TableCardShape } from '../shapes';
import { useCapabilities } from './useCapabilities';

/** Top-left chrome: the Jarwiz wordmark chip and a quick "new note" action. */
export function Topbar() {
  const editor = useEditor();
  const caps = useCapabilities();

  const handleNewNote = () => {
    const center = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.markHistoryStoppingPoint('create note');
    editor.createShape<NoteCardShape>({
      id,
      type: 'note-card',
      x: center.x - NOTE_CARD_SIZE.w / 2,
      y: center.y - NOTE_CARD_SIZE.h / 2,
      props: { ...NOTE_CARD_SIZE, text: '' },
    });
    editor.select(id);
    editor.setEditingShape(id);
    editor.setCurrentTool('select.editing_shape');
  };

  const handleNewTable = () => {
    const center = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.markHistoryStoppingPoint('create table');
    editor.createShape<TableCardShape>({
      id,
      type: 'table-card',
      x: center.x - TABLE_CARD_SIZE.w / 2,
      y: center.y - TABLE_CARD_SIZE.h / 2,
      props: starterTableProps(),
    });
    editor.select(id);
    editor.setEditingShape(id);
    editor.setCurrentTool('select.editing_shape');
  };

  return (
    <div className="jz-topbar">
      <div className="jz-wordmark">
        <span className="jz-spark" aria-hidden>
          ✦
        </span>
        Jarwiz
      </div>
      <button className="jz-new-note" onClick={handleNewNote}>
        + Note
      </button>
      <button className="jz-new-note" onClick={handleNewTable}>
        + Table
      </button>
      {caps?.live === false ? (
        <span
          className="jz-demo-badge"
          title="No API key configured — agents run a scripted demo, so output is illustrative rather than real."
        >
          Demo mode
        </span>
      ) : null}
    </div>
  );
}
