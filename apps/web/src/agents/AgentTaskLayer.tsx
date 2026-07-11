/**
 * Renders the controls for in-flight (or failed) agent tasks, anchored at the
 * work. Running → a Cancel chip; error → a human message + Retry. The avatar
 * (AgentCursorLayer) shows the agent itself + status; this is just the controls,
 * so an AI action is always cancellable and never a silent dead end.
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
        if (task.status === 'error') {
          return (
            <div key={task.id} className="jz-task jz-task--error" style={style} onPointerDown={stopEventPropagation}>
              <span className="jz-task-err">{task.error ?? "That didn't go through."}</span>
              {task.onRetry ? <button className="jz-task-btn" onClick={task.onRetry}>Retry</button> : null}
            </div>
          );
        }
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
