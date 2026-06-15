/**
 * Provenance map: which source PDF a response card came from, so a [p.N]
 * citation on the answer can flip that PDF reader to the cited page. Ephemeral
 * (session-scoped) — recorded when the Ask pipeline creates a response card.
 */

import type { TLShapeId } from 'tldraw';

const sourcePdf = new Map<string, TLShapeId>();

export function setResponsePdfSource(responseId: TLShapeId, pdfId: TLShapeId): void {
  sourcePdf.set(responseId, pdfId);
}

export function getResponsePdfSource(responseId: TLShapeId): TLShapeId | undefined {
  return sourcePdf.get(responseId);
}
