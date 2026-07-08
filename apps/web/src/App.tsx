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
// tldraw license key. This is a PUBLIC, domain-locked, signature-verified key —
// tldraw ships it in the client bundle by design, so it's safe to commit. With a
// valid (evaluation) license tldraw runs fully "licensed": no watermark, and off
// the unlicensed-production code path. An env override lets us swap it at build
// time without a code change.
const TLDRAW_LICENSE_KEY =
  import.meta.env.VITE_TLDRAW_LICENSE_KEY ??
  'tldraw-2026-10-15/WyJxSWVWdzRkOCIsWyIqIl0sMTYsIjIwMjYtMTAtMTUiXQ.kbXeMnnbA7b3yl5tzrPUQFUMHCIAXwux32h1OB1m53DMcWkX5L3g0RRdvbg6cnfDP+ucDho9QfIy/4d3YkDrnA';
import { useSync } from '@tldraw/sync';
import { PromptBar } from './ask/PromptBar';
import { CardActionBar } from './ask/CardActionBar';
import { ProvenanceLayer } from './ask/ProvenanceLayer';
import { ClarifyLayer } from './ask/ClarifyLayer';
import { CommentLayer } from './ask/CommentLayer';
import { setComments, toggleComment, commentSig } from './ask/comments';
import { MachineRunner } from './ui/MachineRunner';
import { PrototypeRunner } from './ui/PrototypeRunner';
import { DashboardRunner } from './ui/DashboardRunner';
import { DraftControls } from './ask/DraftControls';
import { RegenControls } from './ask/RegenControls';
import { SelectionAsk } from './ask/SelectionAsk';
import { Timeline } from './log/Timeline';
import { registerIngestion } from './ingest/registerIngestion';
import { AgentCursorLayer } from './agents/AgentCursorLayer';
import { AgentTaskLayer } from './agents/AgentTaskLayer';
import { cardShapeUtils } from './shapes';
import { getRestoreError, isRestoring, subscribeRestore } from './boards/backup';
import { getActiveBoard, getActivePersistenceKey, subscribeBoards } from './boards/boardStore';
import { isDemo, isEmbed, isUseCases } from './boards/demo';
import { seedDemoBoard } from './boards/demoSeed';
import { EmbedShowreel } from './ui/EmbedShowreel';
import { EmbedUseCases } from './ui/EmbedUseCases';
import { CardTitleTag } from './ui/CardTitleTag';
import { DocFocusOverlay } from './ui/DocFocusOverlay';
import { CardFocusOverlay } from './ui/CardFocusOverlay';
import { EmptyState } from './ui/EmptyState';
import { Topbar } from './ui/Topbar';
import { HelpLayer } from './ui/HelpLayer';
import { SidePanel } from './ui/SidePanel';
import { ErrorBoundary, Safe } from './ui/ErrorBoundary';
import { TidyContextMenu } from './ui/TidyContextMenu';
import { getTheme, subscribeTheme } from './ui/theme';

/**
 * Everything Jarwiz floats over the canvas, in one overlay slot: the Flora
 * chrome (topbar, rail, panels, prompt bar) plus the behavioural overlays that
 * make cards askable/refinable. All overlays are styled by the same token set,
 * so the light/dark toggle re-skins everything at once.
 */
function JarwizOverlay() {
  // Each overlay is guarded by its own `silent` boundary: if one throws, it
  // disappears quietly while the canvas and every sibling overlay keep working —
  // a single broken card or layer can't take down the whole surface.
  return (
    <>
      {/* Chrome — the Flora frame. */}
      <Safe label="Topbar"><Topbar /></Safe>
      <Safe label="SidePanel"><SidePanel /></Safe>
      <Safe label="ToolRail"><ToolRail /></Safe>
      <Safe label="PromptBar"><PromptBar /></Safe>
      <Safe label="AgentCursorLayer"><AgentCursorLayer /></Safe>
      <Safe label="HelpLayer"><HelpLayer /></Safe>

      {/* Behavioural overlays — the ask/refine loop on cards. (Provenance
          lineage renders in the OnTheCanvas slot below, behind the shapes.) */}
      <Safe label="EmptyState"><EmptyState /></Safe>
      <Safe label="CardTitleTag"><CardTitleTag /></Safe>
      <Safe label="CardActionBar"><CardActionBar /></Safe>
      <Safe label="ClarifyLayer"><ClarifyLayer /></Safe>
      <Safe label="CommentLayer"><CommentLayer /></Safe>
      <Safe label="MachineRunner"><MachineRunner /></Safe>
      <Safe label="PrototypeRunner"><PrototypeRunner /></Safe>
      <Safe label="DashboardRunner"><DashboardRunner /></Safe>
      <Safe label="DraftControls"><DraftControls /></Safe>
      <Safe label="RegenControls"><RegenControls /></Safe>
      <Safe label="SelectionAsk"><SelectionAsk /></Safe>
      <Safe label="AgentTaskLayer"><AgentTaskLayer /></Safe>
      <Safe label="Timeline"><Timeline /></Safe>
      {/* Last = on top: focus mode covers the whole board when open. */}
      <Safe label="DocFocusOverlay"><DocFocusOverlay /></Safe>
      <Safe label="CardFocusOverlay"><CardFocusOverlay /></Safe>
    </>
  );
}

/** The minified embed overlay (?embed=1): just the card title tags and the
 *  lightweight composer — every other capability is hidden. */
function EmbedOverlay() {
  // No CardTitleTag here: the title tags render at a constant screen size, so in
  // the showreel's zoomed-out establishing shot they'd tower over the shrunken
  // cards and collide. Cards carry their own titles in-body, which is enough.
  return (
    <>
      <Safe label="EmbedShowreel"><EmbedShowreel /></Safe>
    </>
  );
}

/** The use-cases overlay (?usecases=1): one board of four persona workspaces
 *  plus the Next/Back camera controller. */
function UseCasesOverlay() {
  return (
    <>
      <Safe label="EmbedUseCases"><EmbedUseCases /></Safe>
    </>
  );
}

/**
 * Calm the tldraw chrome. The canvas pivot (docs/CANVAS-PIVOT.md, P0) re-enables
 * the primitive toolbar — curated to FigJam essentials — and the style panel, so
 * shapes/text/connectors are creatable and tweakable. We still drop the menus,
 * debug chrome, and helper buttons to keep the surface quiet.
 */
/** Rendered inside tldraw's camera transform, behind the shapes — the
 *  provenance lineage lines tuck behind cards so only gap segments show. */
function CanvasBehind() {
  return <Safe label="ProvenanceLayer"><ProvenanceLayer /></Safe>;
}

const components: TLComponents = {
  InFrontOfTheCanvas: JarwizOverlay,
  OnTheCanvas: CanvasBehind,
  // Right-click on a card selection gets a "Tidy up" item (local masonry tidy);
  // every stock context-menu action still renders below it.
  ContextMenu: TidyContextMenu,
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

/** Embed mode swaps the overlay for the minified composer and drops the style
 *  panel — the canvas and the composer, nothing else. */
const embedComponents: TLComponents = {
  ...components,
  InFrontOfTheCanvas: EmbedOverlay,
  StylePanel: null,
};

/** Use-cases canvas: the persona-workspaces overlay, chrome hidden like embed. */
const useCasesComponents: TLComponents = {
  ...components,
  InFrontOfTheCanvas: UseCasesOverlay,
  StylePanel: null,
};

const handleMount = (editor: Editor) => {
  registerIngestion(editor);
  // Keep tldraw's own color scheme (canvas shapes, style panel, popovers) in
  // lockstep with the Jarwiz theme. tldraw ignores DOM attributes — this
  // preference is the only mechanism it reads.
  editor.user.updateUserPreferences({ colorScheme: getTheme() });
  subscribeTheme(() => editor.user.updateUserPreferences({ colorScheme: getTheme() }));
  // Suppress tldraw's blue selection chrome. updateThemes with a callback
  // deep-merges into the existing theme so no other colors are wiped out.
  editor.updateThemes((themes) => {
    const t = themes['default'];
    if (!t) return themes;
    // Hide all canvas-drawn selection chrome (box, corners, strokes).
    // Corner squares fill with `background`; setting it transparent hides them
    // without affecting the CSS-driven canvas background (.tl-background).
    t.colors.light.selectionStroke = 'transparent';
    t.colors.light.selectionFill  = 'transparent';
    t.colors.light.background     = 'transparent';
    t.colors.dark.selectionStroke  = 'transparent';
    t.colors.dark.selectionFill   = 'transparent';
    t.colors.dark.background      = 'transparent';
    // Mute the GREY stroke to a hairline weight-feel (generated flowcharts
    // draw in grey; the stock value #9398b0 read as a strong lavender border).
    // Shape labels stay readable because flow shapes set labelColor='black'.
    t.colors.light.grey.solid = '#c2beb4';
    t.colors.dark.grey.solid  = '#4e535b';
    return themes;
  });
  // Dev convenience + e2e hook: reach the editor from the console.
  (window as unknown as { editor: Editor }).editor = editor;
  // e2e / marketing-capture hook: stage a proactive comment on a card and open
  // it, without waiting on the server review pass. Inert unless called.
  (window as unknown as { __jzSeedComment?: (c: import('@jarwiz/shared').NoticeComment) => void }).__jzSeedComment = (c) => {
    setComments([c]);
    toggleComment(commentSig(c));
  };

  // Embedded demo: land the visitor on content. ?embed=1 is the minified
  // live-preview (one card + composer); ?demo=1 is the full seeded board.
  if (isEmbed()) {
    // The hero showreel is a pure autoplay loop — the visitor never drives it.
    // The preview lives in an iframe on the marketing page; without this the
    // canvas swallows the scroll wheel and zooms the board out of sight ("it
    // closes when I scroll on it"). Turn off wheel + drag camera moves so the
    // page scrolls normally over the preview and the board stays framed;
    // programmatic reframing (the overlay's camera control) still works.
    editor.setCameraOptions({ ...editor.getCameraOptions(), wheelBehavior: 'none', panSpeed: 0 });
  } else if (isUseCases()) {
    // The use-cases board IS meant to be explored: wheel-zoom is on by default,
    // and the hand tool makes a plain drag pan the board (map-style) instead of
    // brush-selecting. Keeping every card selected also keeps the dotted
    // provenance drawn while you pan. The Next/Back controller flies the camera
    // between workspaces on top of that.
    editor.setCurrentTool('hand');
  } else if (isDemo()) seedDemoBoard(editor);
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
      licenseKey={TLDRAW_LICENSE_KEY}
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
  const activePersistenceKey = useSyncExternalStore(
    subscribeBoards,
    getActivePersistenceKey,
    getActivePersistenceKey,
  );
  // The embedded showcases (?embed hero, ?usecases) must NOT persist. Both live
  // in iframes on the SAME marketing-page origin, so a shared persistenceKey
  // makes tldraw cross-sync them (IndexedDB + its cross-tab BroadcastChannel) —
  // the two boards overwrite each other's shapes (the hero shows use-cases
  // cards; positions jump when you scroll away and back). In-memory only keeps
  // each iframe isolated; both re-seed fresh on load anyway.
  const persistenceKey = isEmbed() || isUseCases() ? undefined : activePersistenceKey;
  // The hero showreel (?embed) is a pure autoplay loop, so we lock its canvas to
  // visitor input (pointer-events:none + no autofocus). The use-cases board is
  // meant to be explored, so it stays interactive (wheel-zoom + drag-pan).
  const lockCanvas = isEmbed();
  return (
    <Tldraw
      key={board?.id ?? 'legacy'}
      licenseKey={TLDRAW_LICENSE_KEY}
      persistenceKey={persistenceKey}
      assetUrls={tldrawAssetUrls}
      shapeUtils={cardShapeUtils}
      components={isUseCases() ? useCasesComponents : isEmbed() ? embedComponents : components}
      onMount={handleMount}
      className={lockCanvas ? 'jz-lockcanvas' : undefined}
      autoFocus={lockCanvas ? false : undefined}
    />
  );
}

/** A board is shared when the URL carries `?room=<id>` — a FigJam-style link.
 *  PARKED: multiplayer is disabled pending security hardening (unauthenticated
 *  WebSocket, no origin check, schema drift — docs/AUDIT.md P0.2/P0.4). Set
 *  VITE_JARWIZ_ENABLE_SYNC=1 (and JARWIZ_ENABLE_SYNC=1 on the server) to test. */
function roomFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (!import.meta.env.VITE_JARWIZ_ENABLE_SYNC) return null;
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

/** Shown while a backup is being restored. Rendering this INSTEAD of the
 *  board is load-bearing: it unmounts tldraw, which releases its IndexedDB
 *  connection so the restore can rewrite the board databases. */
function RestoreSplash() {
  const error = useSyncExternalStore(subscribeRestore, getRestoreError, getRestoreError);
  return (
    <div className="jz-restore-splash" role="status">
      {error ? (
        <>
          <p className="jz-restore-splash-error">{error}</p>
          <button className="jz-restore-splash-reload" onClick={() => window.location.reload()}>
            Reload
          </button>
        </>
      ) : (
        <p>Restoring your boards…</p>
      )}
    </div>
  );
}

export function App() {
  const room = roomFromUrl();
  const restoring = useSyncExternalStore(subscribeRestore, isRestoring, isRestoring);
  return (
    <div className="jarwiz-app">
      {/* Root backstop: anything that escapes an overlay's own guard (the canvas
       *  itself, a shape render, restore) lands on a branded reload screen
       *  instead of a white page. */}
      <ErrorBoundary variant="app" label="App">
        {restoring ? <RestoreSplash /> : room ? <SyncedBoard room={room} /> : <LocalBoard />}
      </ErrorBoundary>
    </div>
  );
}
