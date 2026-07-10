/**
 * Upload a file to the server blob store and get back a stable URL. Two steps,
 * the Miro/Figma pattern: ask the server for an upload URL (presign), then send
 * the bytes directly to it. In dev the upload URL is our own PUT endpoint; in
 * prod it can be a signed S3/R2 URL with no client change. The card stores only
 * the returned GET URL — bytes never enter the synced document.
 *
 * Hosted playground (static build, no server): small files are inlined as data
 * URLs instead, so images still work and persist with the board in the browser.
 */

import { apiUrl } from './api';
import { backendDown } from './backend';

interface Presigned {
  assetId: string;
  uploadUrl: string;
  getUrl: string;
  method: string;
}

/** Hosted playground (no blob store): keep files this size or smaller fully in
 *  the browser as data URLs — they persist with the board in IndexedDB. Bigger
 *  than this and the board DB gets heavy, so we fail honestly instead. */
const INLINE_LIMIT_BYTES = 8 * 1024 * 1024;

export async function uploadAsset(file: Blob, prefix = 'asset'): Promise<{ assetId: string; url: string }> {
  if (backendDown()) return inlineAsset(file, prefix);

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

  // Cards embed this URL in <img>/viewer src, which doesn't go through the
  // fetch bridge — so a remote API base must be baked in here.
  return { assetId, url: apiUrl(getUrl) };
}

/** No server → the browser IS the blob store. The card stores a data URL, so
 *  the bytes live inside the board document (IndexedDB) and survive reloads. */
async function inlineAsset(file: Blob, prefix: string): Promise<{ assetId: string; url: string }> {
  if (file.size > INLINE_LIMIT_BYTES) {
    throw new Error('This file is too large for the hosted playground (8 MB max without a server).');
  }
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
  return { assetId: `local-${prefix}-${crypto.randomUUID()}`, url };
}
