/**
 * Kick off a card's TL;DR. Called from ingestion the moment a dropped card has
 * something readable — the link's page text, the video's transcript, the
 * uploaded PDF/sheet's assetId — so the gist fills in on its own while the user
 * keeps working. Sets the card to a shimmering `loading` state immediately, then
 * swaps in the summary (or quietly clears it if there's nothing to say).
 *
 * Best-effort: a deleted/undone card mid-flight, a thin source, or no available
 * model all resolve to no strip — never an error the user has to dismiss.
 */

import type { Editor, TLShape, TLShapeId, TLShapePartial } from 'tldraw';
import type { TldrStatus } from '../shapes/TldrStrip';

export type TldrKind = 'link' | 'youtube' | 'pdf' | 'sheet';

export interface TldrRequest {
  kind: TldrKind;
  title?: string;
  text?: string;
  assetId?: string;
}

/** Patch just the two TL;DR props on a card, whatever its type. */
function setTldr(
  editor: Editor,
  id: TLShapeId,
  type: TLShape['type'],
  props: { tldr?: string; tldrStatus?: TldrStatus },
): void {
  // Cross-type patch (link/youtube/pdf/sheet all carry these props): the shared
  // partial can't discriminate on a union type, so cast to the union partial.
  editor.updateShape({ id, type, props } as TLShapePartial);
}

export function startTldr(editor: Editor, id: TLShapeId, type: TLShape['type'], req: TldrRequest): void {
  if (!editor.getShape(id)) return;
  setTldr(editor, id, type, { tldrStatus: 'loading' });

  void fetch('/api/tldr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ tldr?: string }>) : null))
    .then((d) => {
      if (!editor.getShape(id)) return; // deleted or undone while generating
      const tldr = typeof d?.tldr === 'string' ? d.tldr.trim() : '';
      setTldr(editor, id, type, tldr ? { tldr, tldrStatus: 'ready' } : { tldrStatus: 'error' });
    })
    .catch(() => {
      if (editor.getShape(id)) setTldr(editor, id, type, { tldrStatus: 'error' });
    });
}
