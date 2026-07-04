/**
 * Claude panel open/close state — mirrors sidePanelStore.ts.
 * The two panels are mutually exclusive in both directions: opening Claude
 * closes boards, and opening boards closes Claude (via the registration hook,
 * which avoids a module import cycle).
 */

import { closeSidePanel, registerSidePanelExclusive } from './sidePanelStore';

let _open = false;
const _listeners = new Set<() => void>();

const notify = () => _listeners.forEach((cb) => cb());

registerSidePanelExclusive(() => closeClaudePanel());

export function isClaudePanelOpen(): boolean {
  return _open;
}

export function openClaudePanel(): void {
  if (_open) return;
  closeSidePanel(); // mutually exclusive
  _open = true;
  notify();
}

export function closeClaudePanel(): void {
  if (!_open) return;
  _open = false;
  notify();
}

export function toggleClaudePanel(): void {
  if (_open) closeClaudePanel();
  else openClaudePanel();
}

export function subscribeClaudePanel(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
