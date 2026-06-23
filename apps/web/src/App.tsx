import { useSyncExternalStore } from 'react';
import {
  Tldraw,
  defaultBindingUtils,
  defaultShapeUtils,
  type Editor,
  type TLAssetStore,
  type TLComponents,
} from 'tldraw';
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite';
import { CanvasStylePanel } from './ui/CanvasToolbar';
import { ToolRail } from './ui/ToolRail';

// Self-host tldraw's UI icons, fonts, and translations (Vite bundles them) so the
// re-enabled toolbar / style panel render without reaching cdn.tldraw.com — which
// a self-hosted product (and restricted networks) can't depend on.
const tldrawAssetUrls = getAssetUrlsByImport();
import { useSync } from '@tldraw/sync';
import { PromptBar } from './ask/PromptBar';
import { registerIngestion } from './ingest/registerIngestion';
import { AgentCursorLayer } from './agents/AgentCursorLayer';
import { cardShapeUtils } from './shapes';
import { getActiveBoard, getActivePersistenceKey, subscribeBoards } from './boards/boardStore';
import { Topbar } from './ui/Topbar';
import { HelpLayer } from './ui/HelpLayer';

/**
 * Everything Jarwiz floats over the canvas, in one overlay slot. While we
 * perfect the PDF journey, the agent/cluster/comment surfaces are intentionally
 * left out — only the PDF flow is wired up (docs/PDF-JOURNEY.md).
 */
function JarwizOverlay() {
  return (
    <>
      {/* Canvas frame — the four chrome surfaces we're designing right now. */}
      <Topbar />
      <ToolRail />
      <PromptBar />
      <AgentCursorLayer />
      <HelpLayer />

      {/* Behavioural overlays — disabled while we design the chrome. Re-enable
       *  one at a time as we get back to them.
       *  <EmptyState />
       *  <BoardEntry />
       *  <CardActionBar />
       *  <ClarifyLayer />
       *  <DraftControls />
       *  <RegenControls />
       *  <SelectionAsk />
       *  <DiscussLayer />
       *  <AgentTaskLayer />
       *  <Timeline />
       */}
    </>
  );
}

/**
 * Calm the tldraw chrome. The canvas pivot (docs/CANVAS-PIVOT.md, P0) re-enables
 * the primitive toolbar — curated to FigJam essentials — and the style panel, so
 * shapes/text/connectors are creatable and tweakable. We still drop the menus,
 * debug chrome, and helper buttons to keep the surface quiet.
 */
const components: TLComponents = {
  InFrontOfTheCanvas: JarwizOverlay,
  Toolbar: null, // replaced by our right-edge ToolRail
  StylePanel: CanvasStylePanel,
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
    <Tldraw
      store={store}
      assetUrls={tldrawAssetUrls}
      shapeUtils={cardShapeUtils}
      components={components}
      onMount={handleMount}
    />
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
      assetUrls={tldrawAssetUrls}
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
