/**
 * Machine runner — the bridge between an on-canvas machine block and the Ask
 * pipeline. It lives in the overlay (so it can use Ask without the shape needing
 * to), listens for a block's Run request, then runs that machine's analysis on
 * the typed subject. The answer streams in as a normal draft card beside the
 * block; the block's status flips running → done.
 */

import { useEffect } from 'react';
import { useEditor } from 'tldraw';
import { useAsk } from '../ask/useAsk';
import { useCompose } from '../agents/useCompose';
import { MACHINES, resolveMachineOptions } from '../machines/catalog';
import { getMachineRun, subscribeMachineRun } from '../machines/runStore';
import { useSyncExternalStore } from 'react';
import type { AskShape } from '@jarwiz/shared';
import type { MachineCardShape } from '../shapes';

export function MachineRunner() {
  const editor = useEditor();
  const { ask } = useAsk();
  const { run: compose } = useCompose();
  const req = useSyncExternalStore(subscribeMachineRun, getMachineRun, getMachineRun);

  useEffect(() => {
    if (!req) return;
    const shape = editor.getShape(req.id);
    if (!shape || shape.type !== 'machine-card') return;
    const p = (shape as MachineCardShape).props;
    const machine = MACHINES.find((m) => m.id === p.machineId);
    const subject = p.subject.trim();
    if (!machine || !subject) return;

    // Optional outputs the user ticked on the block (defaults when untouched).
    const options = resolveMachineOptions((shape.meta as { options?: unknown }).options, machine);

    editor.updateShape<MachineCardShape>({ id: req.id, type: 'machine-card', props: { status: 'running' } });
    // The machine block is an input, not an artefact — once it has fanned out its
    // card(s) it has served its purpose, so it removes itself (owner call: the
    // block should disappear after the cards land), leaving just the output.
    const finish = () => {
      if (editor.getShape(req.id)) editor.deleteShape(req.id);
    };

    // The skill (system prompt + research budget) lives server-side. A 'board'
    // machine fans out into several cards beside the block (compose); everything
    // else lands as one card (ask). Either way the subject + machine id go up.
    if (machine.output === 'board') {
      void compose(subject, { machineId: machine.id, anchorId: req.id, options }).finally(finish);
    } else {
      void ask(subject, [req.id], {
        machineId: machine.id,
        forceShape: machine.output as AskShape,
        logLabel: `${machine.name}: ${subject}`,
      }).finally(finish);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce]);

  return null;
}
