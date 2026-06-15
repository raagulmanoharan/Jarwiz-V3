/**
 * Upload a file's bytes to the server blob store and get back a stable URL.
 * The card stores only that URL — the bytes never enter the synced document.
 */

function randomId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}

export async function uploadAsset(file: Blob, prefix = 'asset'): Promise<{ assetId: string; url: string }> {
  const assetId = randomId(prefix);
  const res = await fetch(`/api/assets/${assetId}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error(`asset upload failed (${res.status})`);
  return { assetId, url: `/api/assets/${assetId}` };
}
