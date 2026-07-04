/**
 * Claude side panel — a right-edge chat drawer for direct conversation.
 * Streams responses from /api/chat; keeps full message history in local state.
 * Board context (all doc-card text, up to a limit) is injected on the first
 * message of each session so Claude can ground answers in the canvas.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stopEventPropagation, useEditor, type Editor } from 'tldraw';
import { ArrowUp, X } from 'lucide-react';
import { readSSE } from '../agents/sse';
import { closeClaudePanel, isClaudePanelOpen, subscribeClaudePanel } from './claudePanelStore';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

type ChatEvent =
  | { type: 'delta'; textDelta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

let _msgId = 0;
const uid = () => String(++_msgId);

/** Snapshot the board's card text once, at send time — deliberately a plain
 *  function (not a reactive useValue) so an open panel costs nothing while
 *  the user edits the canvas. */
function collectBoardContext(editor: Editor): string {
  const shapes = editor.getCurrentPageShapes();
  const lines: string[] = [];
  for (const s of shapes) {
    const p = s.props as Record<string, unknown>;
    if (s.type === 'doc-card' || s.type === 'note-card') {
      const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : null;
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      if (title || text) {
        lines.push(title ? `[${title}] ${text}` : text);
      }
    }
  }
  return lines.slice(0, 20).join('\n\n').slice(0, 3000);
}

export function ClaudePanel() {
  const open = useSyncExternalStore(subscribeClaudePanel, isClaudePanelOpen, isClaudePanelOpen);
  if (!open) return null;
  return <ClaudePanelInner />;
}

function ClaudePanelInner() {
  const editor = useEditor();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  // Auto-scroll when messages grow.
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens.
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes (stopping any in-flight stream) — but only when the press
  // happens inside the panel or its input has focus. A window-wide Escape
  // would also fire when the user cancels a canvas edit or closes a dialog,
  // and must not tear down the chat then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target instanceof Node ? e.target : null;
      const inPanel = target ? panelRef.current?.contains(target) : false;
      const inputFocused = document.activeElement === inputRef.current;
      if (!inPanel && !inputFocused) return;
      abortRef.current?.abort();
      closeClaudePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');

    // Board context rides along only on the session's first message ("New
    // chat" resets `messages`, starting a fresh session), computed lazily
    // here rather than kept reactively up to date while the panel is open.
    const boardContext = messages.length === 0 ? collectBoardContext(editor) : '';

    const userMsg: Message = { id: uid(), role: 'user', text };
    const assistantMsg: Message = { id: uid(), role: 'assistant', text: '', streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    // Build full history for the request (excluding the streaming placeholder).
    const history = [...messages, userMsg].map((m) => ({ role: m.role, text: m.text }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          boardContext: boardContext || undefined,
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error ${res.status}`);
      }

      await readSSE<ChatEvent>(res.body, (event) => {
        if (event.type === 'delta' && event.textDelta) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, text: m.text + event.textDelta } : m,
            ),
          );
        } else if (event.type === 'done' || event.type === 'error') {
          const errText = event.type === 'error' ? `\n\n_Error: ${event.message}_` : '';
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, streaming: false, text: m.text + errText } : m,
            ),
          );
        }
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, text: '_Connection error. Is the server running?_' }
              : m,
          ),
        );
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
      );
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
    inputRef.current?.focus();
  };

  return (
    <aside
      ref={panelRef}
      className="jz-claude-panel"
      role="dialog"
      aria-label="Claude"
      onPointerDown={stopEventPropagation}
    >
      {/* Header */}
      <div className="jz-claude-header">
        <div className="jz-claude-header-left">
          <span className="jz-claude-title">Claude</span>
          {messages.length > 0 && (
            <button className="jz-claude-clear" onClick={clearChat} title="Clear conversation">
              New chat
            </button>
          )}
        </div>
        <button
          className="jz-claude-close"
          onClick={closeClaudePanel}
          aria-label="Close"
          title="Close (Esc)"
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* Messages */}
      <div className="jz-claude-messages">
        {messages.length === 0 ? (
          <div className="jz-claude-empty">
            <p className="jz-claude-empty-title">Ask me anything</p>
            <p className="jz-claude-empty-sub">I can see your board content and help you think through it.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`jz-claude-msg jz-claude-msg--${m.role}`}>
              <div className="jz-claude-msg-text">
                {m.text || (m.streaming ? null : null)}
                {m.streaming && <span className="jz-stream-caret" aria-hidden />}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="jz-claude-input-wrap">
        <textarea
          ref={inputRef}
          className="jz-claude-input"
          value={input}
          placeholder="Message Claude…"
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            if (e.key === 'Escape') { closeClaudePanel(); }
          }}
        />
        <button
          className="jz-claude-send"
          disabled={!input.trim() || streaming}
          onClick={() => void send()}
          title="Send (Enter)"
          aria-label="Send"
        >
          <ArrowUp size={15} strokeWidth={2.2} />
        </button>
      </div>
    </aside>
  );
}
