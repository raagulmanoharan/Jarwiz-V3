/**
 * Renders the controls for in-flight agent tasks, anchored at the work: a
 * Cancel chip while it runs. The avatar (AgentCursorLayer) shows the agent
 * itself + status; this is just the running control, so an AI action is always
 * cancellable. Failures don't render here — they surface in the agent-error
 * banner above the composer (agentError.ts), the single home for errors.
 */

import { useSyncExternalStore, type CSSProperties } from 'react';
import { stopEventPropagation, useEditor, useValue } from 'tldraw';
import { getAgentTasks, subscribeAgentTasks, type AgentTask } from './agentTask';

export function AgentTaskLayer() {
  const editor = useEditor();
  const tasks = useSyncExternalStore(getAgentTasksSubscribe, getAgentTasks, getAgentTasks);

  const positioned = useValue(
    'agent-task-anchors',
    () => {
      const out: Array<{ task: AgentTask; x: number; y: number }> = [];
      for (const task of tasks.values()) {
        let x = 24;
        let y = 96;
        if (task.anchorId) {
          const b = editor.getShapePageBounds(task.anchorId);
          if (b) {
            const p = editor.pageToViewport({ x: b.midX, y: b.maxY });
            const vp = editor.getViewportScreenBounds();
            x = Math.max(90, Math.min(p.x, vp.w - 90));
            y = Math.max(40, Math.min(p.y + 14, vp.h - 44));
          }
        }
        out.push({ task, x, y });
      }
      return out;
    },
    [editor, tasks],
  );

  if (positioned.length === 0) return null;

  return (
    <>
      {positioned.map(({ task, x, y }) => {
        const style = { left: x, top: y } as CSSProperties;
        return (
          <div key={task.id} className="jz-task" style={style} onPointerDown={stopEventPropagation}>
            <span className="jz-task-label">{task.label}</span>
            {task.onCancel ? <button className="jz-task-btn jz-task-cancel" onClick={task.onCancel}>Cancel</button> : null}
          </div>
        );
      })}
    </>
  );
}

function getAgentTasksSubscribe(cb: () => void) {
  return subscribeAgentTasks(cb);
}
