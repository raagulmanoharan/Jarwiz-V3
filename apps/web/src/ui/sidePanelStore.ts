/**
 * Side-panel open/close state — a tiny external store so the hamburger logo,
 * the board-name caret, and Escape/click-outside can all drive the same panel.
 */

let _open = false;
const _listeners = new Set<() => void>();

/** The two edge panels are mutually exclusive. claudePanelStore registers its
 *  close function here (registration, not an import, to avoid a module cycle). */
let _onOpenExclusive: (() => void) | null = null;
export function registerSidePanelExclusive(cb: () => void): void {
  _onOpenExclusive = cb;
}

export function isSidePanelOpen(): boolean {
  return _open;
}

export function openSidePanel(): void {
  if (_open) return;
  _open = true;
  _onOpenExclusive?.();
  _listeners.forEach((cb) => cb());
}

export function closeSidePanel(): void {
  if (!_open) return;
  _open = false;
  _listeners.forEach((cb) => cb());
}

export function toggleSidePanel(): void {
  _open = !_open;
  if (_open) _onOpenExclusive?.();
  _listeners.forEach((cb) => cb());
}

export function subscribeSidePanel(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
