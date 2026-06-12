import { useCallback } from 'react';
import { Tldraw, type Editor, type TLComponents } from 'tldraw';
import { AgentPresenceLayer } from './agents/AgentPresenceLayer';
import { registerIngestion } from './ingest/registerIngestion';
import { cardShapeUtils } from './shapes';
import { Topbar } from './ui/Topbar';

/** Everything Jarwiz floats over the canvas, in one overlay slot. */
function JarwizOverlay() {
  return (
    <>
      <Topbar />
      <AgentPresenceLayer />
    </>
  );
}

/**
 * Calm the tldraw chrome: keep selection and zoom/navigation, drop the
 * style panel, menus, debug chrome, and helper buttons.
 */
const components: TLComponents = {
  InFrontOfTheCanvas: JarwizOverlay,
  Toolbar: null, // the agent dock owns bottom-center; selection is the default tool
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

export function App() {
  const handleMount = useCallback((editor: Editor) => {
    registerIngestion(editor);
  }, []);

  return (
    <div className="jarwiz-app">
      <Tldraw
        persistenceKey="jarwiz-board"
        shapeUtils={cardShapeUtils}
        components={components}
        onMount={handleMount}
      />
    </div>
  );
}
