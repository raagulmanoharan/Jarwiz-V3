/**
 * BYOK key settings — the one place a visitor manages their Anthropic API key.
 *
 * The hosted trial's agent server holds no key of its own; the visitor pastes
 * theirs here and it lives ONLY in this browser (localStorage — see lib/api.ts),
 * riding along on each request. Saving re-probes the server so the whole app
 * flips from scripted demo to live agents without a reload.
 *
 * The topbar button appears only when it's relevant: the server is keyless
 * (demo mode) or a key is already stored (so it can be changed/removed) —
 * local dev with a server-side key never shows extra chrome.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation } from 'tldraw';
import { KeyRound } from 'lucide-react';
import { getApiKey, getPilotCode, setApiKey, setPilotCode, subscribeApiKey } from '../lib/api';
import { getBackendSnapshot, reprobeBackend, subscribeBackend } from '../lib/backend';

// External open/close store so other surfaces (the PromptBar's demo-mode
// notice) can pop this open without prop-drilling through the chrome.
let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribeOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isOpen = () => open;

export function openApiKeySettings(): void {
  setOpen(true);
}

export function ApiKeyButton() {
  const backend = useSyncExternalStore(subscribeBackend, getBackendSnapshot, getBackendSnapshot);
  const storedKey = useSyncExternalStore(subscribeApiKey, getApiKey, getApiKey);
  const pilotCode = useSyncExternalStore(subscribeApiKey, getPilotCode, getPilotCode);
  const popped = useSyncExternalStore(subscribeOpen, isOpen, isOpen);
  const [draft, setDraft] = useState('');

  // Keep the pilot count honest while the popover is up — the probe result
  // is from page load, and actions spend budget as they work.
  useEffect(() => {
    if (popped && getPilotCode()) reprobeBackend();
  }, [popped]);

  // Close on click-away (same pattern as the zoom dropdown).
  useEffect(() => {
    if (!popped) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.jz-key-wrap')) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [popped]);

  const relevant = Boolean(storedKey) || Boolean(pilotCode) || backend.mode === 'demo';
  if (!relevant) return null;

  const live = backend.mode === 'api' || backend.mode === 'sidecar';
  const save = () => {
    const key = draft.trim();
    if (!key) return;
    setApiKey(key);
    setDraft('');
    reprobeBackend();
    setOpen(false);
  };
  const remove = () => {
    setApiKey(null);
    reprobeBackend();
  };

  return (
    <div className="jz-key-wrap" onPointerDown={stopEventPropagation}>
      <button
        className={`jz-key-btn${storedKey || pilotCode ? ' jz-key-btn--set' : ''}`}
        onClick={() => setOpen(!popped)}
        title={storedKey ? 'Manage your Anthropic API key' : 'Add your Anthropic API key'}
        aria-label={storedKey ? 'Manage your Anthropic API key' : 'Add your Anthropic API key'}
        aria-expanded={popped}
      >
        <KeyRound size={15} strokeWidth={1.8} aria-hidden />
      </button>
      {popped ? (
        <div className="jz-key-pop" role="dialog" aria-label="Anthropic API key">
          {pilotCode ? (
            <div className="jz-key-pilot">
              <div className="jz-key-pop-title">Pilot access</div>
              <p className="jz-key-pop-sub">
                {backend.pilot
                  ? backend.pilot.used >= backend.pilot.limit
                    ? 'Your pilot budget is used up — thank you for testing! Add your own key below to keep going.'
                    : `${backend.pilot.limit - backend.pilot.used} of ${backend.pilot.limit} AI actions left on your invite.`
                  : 'Invite saved in this browser.'}
              </p>
            </div>
          ) : null}
          <div className="jz-key-pop-title">Your Anthropic API key</div>
          <p className="jz-key-pop-sub">
            {storedKey
              ? live
                ? 'Key saved in this browser — agents are live.'
                : 'Key saved in this browser.'
              : pilotCode && live
                ? 'Optional — your own key removes the pilot cap. It stays in this browser only, and is never stored on the server.'
                : 'Agents are running a scripted demo. Paste your own key and they come alive — it stays in this browser only, and is never stored on the server.'}
          </p>
          {storedKey ? (
            <div className="jz-key-row">
              <code className="jz-key-masked">{maskKey(storedKey)}</code>
              <button className="jz-key-remove" onClick={remove}>Remove</button>
            </div>
          ) : (
            <div className="jz-key-row">
              <input
                className="jz-key-input"
                type="password"
                placeholder="sk-ant-…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') setOpen(false);
                }}
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
              <button className="jz-key-save" onClick={save} disabled={!draft.trim()}>
                Save
              </button>
            </div>
          )}
          <p className="jz-key-pop-hint">
            Get a key at{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            . Usage bills to your key.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function maskKey(key: string): string {
  return key.length <= 12 ? '••••••••' : `${key.slice(0, 10)}…${key.slice(-4)}`;
}
