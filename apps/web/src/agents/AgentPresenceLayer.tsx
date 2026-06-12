import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMeta } from '@jarwiz/shared';
import { AgentDock } from './AgentDock';
import { AskAgentAffordance } from './AskAgentAffordance';

const TOAST_DURATION_MS = 2800;

/**
 * The agent presence layer — everything agent-shaped that floats over the
 * canvas. M0 ships the dock (idle) and the ask-an-agent affordance; the M1
 * runtime adds cursors, status chips, and SSE-driven streaming here without
 * touching the canvas layer.
 */
export function AgentPresenceLayer() {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimeout.current), []);

  const handlePickAgent = useCallback(
    (agent: AgentMeta) => {
      notify(`${agent.name} heard you — the agent runtime arrives in Milestone 1`);
    },
    [notify],
  );

  return (
    <>
      <AskAgentAffordance onPickAgent={handlePickAgent} />
      <AgentDock />
      {toast ? <div className="jz-toast">{toast}</div> : null}
    </>
  );
}
