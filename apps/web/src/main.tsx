import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'tldraw/tldraw.css';
import './styles/tokens.css';
import './styles/index.css';
import { App } from './App';
import { applyStoredTheme } from './ui/theme';
import { handleFreshStart } from './boards/freshStart';

// Paint the stored theme before React renders so the first frame isn't a flash
// of the default theme.
applyStoredTheme();

// Route the marketing site's "Try it free" door (?start=1) before React
// renders — the active board decides tldraw's persistenceKey at first paint.
handleFreshStart();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
