import { useSyncExternalStore } from 'react';
import {
  Tldraw,
  defaultBindingUtils,
  defaultShapeUtils,
  type Editor,
  type TLAssetStore,
  type TLComponents,
} from 'tldraw';
import { useSync } from '@tldraw/sync';
import { AskLayer } from './ask/AskLayer';
import { ClarifyLayer } from './ask/ClarifyLayer';
import { DraftControls } from './ask/DraftControls';
import { RegenControls } from './ask/RegenControls';
import { SelectionAsk } from './ask/SelectionAsk';
import { Timeline } from './log/Timeline';
import { registerIngestion } from './ingest/registerIngestion';
import { cardShapeUtils } from './shapes';
import { BoardEntry } from './boards/BoardEntry';
import { getActiveBoard, getActivePersistenceKey, subscribeBoards } from './boards/boardStore';
import { EmptyState } from './ui/EmptyState';
import { StickyDock } from './ui/StickyDock';
import { Topbar } from './ui/Topbar';

/**
 * Everything Jarwiz floats over the canvas, in one overlay slot. While we
 * perfect the PDF journey, the agent/cluster/comment surfaces are intentionally
 * left out — only the PDF flow is wired up (docs/PDF-JOURNEY.md).
 */
function JarwizOverlay() {
  return (
    <>
      <EmptyState />
      <BoardEntry />
      <Topbar />
      <AskLayer />
      <ClarifyLayer />
      <DraftControls />
      <RegenControls />
      <SelectionAsk />
      <StickyDock />
      <Timeline />
    </>
  );
}

/**
 * Calm the tldraw chrome: keep selection and zoom/navigation, drop the
 * style panel, menus, debug chrome, and helper buttons.
 */
const components: TLComponents = {
  InFrontOfTheCanvas: JarwizOverlay,
  Toolbar: null, // selection is the default tool; agents own presence
  StylePanel: null,
  MainMenu: null,
  PageMenu: null,
  MenuPanel: null,
  DebugPanel: null,
  DebugMenu: null,
  HelperButtons: null,
  QuickActions: null,
  ActionsMenu: null,
  HelpMenu: null,
  SharePanel: null,
  TopPanel: null,
};

const handleMount = (editor: Editor) => {
  registerIngestion(editor);
  // Dev convenience + e2e hook: reach the editor from the console.
  (window as unknown as { editor: Editor }).editor = editor;
};

/** Minimal asset store — our cards keep media in their own props, so tldraw's
 *  native uploads are unused; back it with data URLs in case they ever fire. */
const syncAssets: TLAssetStore = {
  async upload(_asset, file) {
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { src };
  },
  resolve(asset) {
    return (asset.props as { src?: string }).src ?? null;
  },
};

// Stable references — recreating these arrays each render makes useSync re-init
// in a loop (React #301). The synced schema needs the default shapes/bindings
// (arrow et al.) plus our cards, or the arrow-binding migration has no shape.
const syncShapeUtils = [...defaultShapeUtils, ...cardShapeUtils];
const syncBindingUtils = [...defaultBindingUtils];

/** A shared, live board: connect to the sync server room over WebSockets. */
function SyncedBoard({ room }: { room: string }) {
  const store = useSync({
    uri: syncUri(room),
    assets: syncAssets,
    shapeUtils: syncShapeUtils,
    bindingUtils: syncBindingUtils,
  });
  return (
    <Tldraw store={store} shapeUtils={cardShapeUtils} components={components} onMount={handleMount} />
  );
}

/** The default single-player board, persisted locally in the browser.
 *  Keyed on the active board id so tldraw remounts cleanly on switch. */
function LocalBoard() {
  const board = useSyncExternalStore(subscribeBoards, getActiveBoard, getActiveBoard);
  const persistenceKey = useSyncExternalStore(
    subscribeBoards,
    getActivePersistenceKey,
    getActivePersistenceKey,
  );
  return (
    <Tldraw
      key={board?.id ?? 'legacy'}
      persistenceKey={persistenceKey}
      shapeUtils={cardShapeUtils}
      components={components}
      onMount={handleMount}
    />
  );
}

/** A board is shared when the URL carries `?room=<id>` — a FigJam-style link. */
function roomFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('room');
}

/** WebSocket URI for a room. Talks straight to the sync server on :3001 in
 *  local/dev; same-origin (behind a proxy) otherwise. */
function syncUri(room: string): string {
  const { protocol, hostname, host } = window.location;
  const path = `/api/sync/${encodeURIComponent(room)}`;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `ws://${hostname}:3001${path}`;
  }
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}${path}`;
}

export function App() {
  const room = roomFromUrl();
  return <div className="jarwiz-app">{room ? <SyncedBoard room={room} /> : <LocalBoard />}</div>;
}
