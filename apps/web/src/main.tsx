import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'tldraw/tldraw.css';
import './styles/tokens.css';
import './styles/index.css';
import { App } from './App';
import { applyStoredTheme } from './ui/theme';
import { handleFreshStart } from './boards/freshStart';
import { probeBackend } from './lib/backend';
import { capturePilotCode, installApiBridge } from './lib/api';

// Paint the stored theme before React renders so the first frame isn't a flash
// of the default theme.
applyStoredTheme();

// Route the marketing site's "Try it free" door (?start=1) before React
// renders — the active board decides tldraw's persistenceKey at first paint.
handleFreshStart();

// Route every /api call to the configured agent server with the visitor's own
// key attached (BYOK), then settle "what can that server do for this visitor?"
// before anyone asks — the AI surfaces read the answer to degrade honestly
// instead of failing with raw 404s.
installApiBridge();
capturePilotCode();
probeBackend();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
