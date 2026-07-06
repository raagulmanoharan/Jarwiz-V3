/**
 * The embed (?embed=1) composer — a minified stand-in for the real prompt bar,
 * used in the marketing site's live-preview iframe. It reuses the prompt-bar
 * styles so it looks identical, but every submit spawns a card CLIENT-SIDE
 * (no server), so the preview works on a static host with no API key. Typing +
 * Enter or tapping a suggestion drops a new card onto the canvas — the whole
 * interaction, and nothing else.
 */

import { useState, type CSSProperties } from 'react';
import { ArrowUp } from 'lucide-react';
import { createShapeId, stopEventPropagation, useEditor } from 'tldraw';

const SUGGESTIONS = ['Plan a weekend in Goa', 'Name my new app', 'Pros & cons of remote work'];

export function EmbedComposer() {
  const editor = useEditor();
  const [value, setValue] = useState('');

  const spawn = (raw: string) => {
    const prompt = raw.trim();
    if (!prompt) return;
    // Lay new cards out in a tidy grid anchored beside the seed card, so they
    // never pile up. Then reframe so the growing board stays in view.
    const i = editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'doc-card',
      x: -210 + col * 460,
      y: -150 + row * 250,
      props: {
        w: 420,
        h: 200,
        title: prompt,
        text: `## ${prompt}\n\n- A quick angle to start from\n- A second consideration worth weighing\n- The next step to take\n\nThis is a live preview. Connect an API key and Jarwiz researches the web and writes this card in full.`,
      },
    });
    editor.select(id);
    setValue('');
    requestAnimationFrame(() => {
      const b = editor.getCurrentPageBounds();
      if (b) editor.zoomToBounds(b, { inset: 60, targetZoom: 1, animation: { duration: 320 } });
    });
  };

  return (
    <div className="jz-promptbar-dock" onPointerDown={stopEventPropagation}>
      <div className="jz-promptbar-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="jz-pb-chip" title="Spawn a card" onClick={() => spawn(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="jz-promptbar" style={{ '--pb-max': '560px' } as CSSProperties}>
        <textarea
          className="jz-promptbar-input"
          value={value}
          rows={2}
          placeholder="Ask anything — a card appears on the canvas…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              spawn(value);
            }
          }}
        />
        <div className="jz-promptbar-footer">
          <div className="jz-promptbar-footer-left" />
          <button
            className="jz-promptbar-send"
            disabled={!value.trim()}
            onClick={() => spawn(value)}
            title="Send (Enter)"
          >
            <ArrowUp size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
