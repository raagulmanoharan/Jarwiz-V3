import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'tldraw/tldraw.css';
import './styles/tokens.css';
import './styles/index.css';
import { App } from './App';
import { applyStoredTheme } from './ui/theme';

// Paint the stored theme before React renders so the first frame isn't a flash
// of the default theme.
applyStoredTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
