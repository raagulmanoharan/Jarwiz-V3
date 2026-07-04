/**
 * Drop / paste ingestion — PDF-only while we perfect the PDF journey
 * (docs/PDF-JOURNEY.md). A dropped PDF uploads to the server blob store and
 * lands as a pdf-card holding just the asset URL; other content is ignored for
 * now. Drops land at the drop point; pastes at the viewport center.
 */

import { createShapeId, type Editor, type TLShapeId, type VecLike } from 'tldraw';
import { uploadAsset } from '../lib/uploadAsset';
import { logEvent } from '../log/eventLog';
import { PDF_CARD_SIZE, type PdfCardShape } from '../shapes';

const MULTI_FILE_CASCADE = 28;

export function registerIngestion(editor: Editor): void {
  editor.registerExternalContentHandler('files', ({ files, point }) => {
    void placeFiles(editor, files, resolvePoint(editor, point));
  });
}

/** Drops carry a page point; pastes do not — fall back to the viewport center. */
function resolvePoint(editor: Editor, point: VecLike | undefined): VecLike {
  if (point) return { x: point.x, y: point.y };
  const center = editor.getViewportPageBounds().center;
  return { x: center.x, y: center.y };
}

async function placeFiles(editor: Editor, files: File[], center: VecLike): Promise<void> {
  let placed = 0;
  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) continue;
    const offset = placed * MULTI_FILE_CASCADE;
    placePdf(editor, file, { x: center.x + offset, y: center.y + offset });
    placed += 1;
  }
}

function placePdf(editor: Editor, file: File, center: VecLike): void {
  const { w, h } = PDF_CARD_SIZE;
  const id = createShapeId();

  // Card appears immediately in an uploading state; the URL fills in when the
  // blob upload completes (or flips to an error state if it fails).
  editor.createShape<PdfCardShape>({
    id,
    type: 'pdf-card',
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h, src: '', assetId: '', name: file.name, pages: 0, status: 'uploading' },
  });

  void uploadAsset(file, 'pdf')
    .then(({ assetId, url }) => {
      updatePdf(editor, id, { src: url, assetId, status: 'ready' });
      // Select the card so its Ask affordance + content pills surface at once.
      // Select the card: its action bar (with the fixed "✦ Profile" — the
      // drop-moment offer) and content pills surface at once.
      if (editor.getShape(id)) {
        editor.select(id);
        logEvent(editor, { kind: 'pdf', label: `Added ${file.name}`, shapeIds: [id] });
      }
    })
    .catch(() => updatePdf(editor, id, { status: 'error' }));
}

function updatePdf(editor: Editor, id: TLShapeId, props: Partial<PdfCardShape['props']>): void {
  if (!editor.getShape(id)) return; // deleted or undone while uploading
  editor.updateShape<PdfCardShape>({ id, type: 'pdf-card', props });
}
