/**
 * Side-panel open/close state — a tiny external store so the hamburger logo,
 * the board-name caret, and Escape/click-outside can all drive the same panel.
 */

let _open = false;
const _listeners = new Set<() => void>();

export function isSidePanelOpen(): boolean {
  return _open;
}

export function openSidePanel(): void {
  if (_open) return;
  _open = true;
  _listeners.forEach((cb) => cb());
}

export function closeSidePanel(): void {
  if (!_open) return;
  _open = false;
  _listeners.forEach((cb) => cb());
}

export function toggleSidePanel(): void {
  _open = !_open;
  _listeners.forEach((cb) => cb());
}

export function subscribeSidePanel(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
