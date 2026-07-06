/**
 * Upload a file to the server blob store and get back a stable URL. Two steps,
 * the Miro/Figma pattern: ask the server for an upload URL (presign), then send
 * the bytes directly to it. In dev the upload URL is our own PUT endpoint; in
 * prod it can be a signed S3/R2 URL with no client change. The card stores only
 * the returned GET URL — bytes never enter the synced document.
 */

interface Presigned {
  assetId: string;
  uploadUrl: string;
  getUrl: string;
  method: string;
}

export async function uploadAsset(file: Blob, prefix = 'asset'): Promise<{ assetId: string; url: string }> {
  const presignRes = await fetch('/api/assets/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix }),
  });
  if (!presignRes.ok) throw new Error(`presign failed (${presignRes.status})`);
  const { assetId, uploadUrl, getUrl, method } = (await presignRes.json()) as Presigned;

  const putRes = await fetch(uploadUrl, {
    method: method || 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error(`asset upload failed (${putRes.status})`);

  return { assetId, url: getUrl };
}
