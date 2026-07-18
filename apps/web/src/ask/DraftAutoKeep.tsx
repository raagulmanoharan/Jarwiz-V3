/**
 * Auto-keep for streamed drafts. A finished answer used to float a Keep /
 * Discard bar under the card; now every draft is committed the moment it
 * finishes — cards land and stay, and you delete one to throw it away (owner
 * call: no per-card confirmation step). This is a headless watcher: it holds no
 * UI, it just finalizes the draft when its status flips to `done`, exactly as
 * clicking Keep used to. Errors never reach here — a failed run is discarded and
 * surfaced in the composer's agent-error banner (see useAsk `surfaceError`).
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useEditor } from 'tldraw';
import { getDraft, subscribeDraft } from './draft';
import { finalizeDraft } from './useAsk';

export function DraftAutoKeep() {
  const editor = useEditor();
  const draft = useSyncExternalStore(subscribeDraft, getDraft, getDraft);
  const status = draft?.status;

  useEffect(() => {
    // Commit the instant the run settles — same effect as the old Keep button,
    // now automatic. finalizeDraft is a no-op on an already-cleared draft, so a
    // re-render can't double-commit.
    if (status === 'done') finalizeDraft(editor);
  }, [editor, draft?.id, status]);

  return null;
}
