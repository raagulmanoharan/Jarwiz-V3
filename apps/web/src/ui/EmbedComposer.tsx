/**
 * The embed (?embed=1) composer — a minified stand-in for the real prompt bar,
 * used in the marketing site's live-preview iframe. It reuses the prompt-bar
 * styles so it looks identical.
 *
 * On a static host there's no server, so this is a friendly "cheat": the box
 * carries a fixed prompt and each suggestion maps to a hand-authored answer.
 * Sending, or tapping a suggestion, drops a polished card onto the canvas —
 * so the preview feels like the real thing without an API key.
 */

import { useState, type CSSProperties } from 'react';
import { ArrowUp } from 'lucide-react';
import { createShapeId, stopEventPropagation, useEditor } from 'tldraw';

interface Canned {
  label: string;
  prompt: string;
  title: string;
  text: string;
}

// One cohesive use case: planning a single product — a calm focus app. Every
// suggestion and the fixed prompt build out the SAME project, so the canvas
// tells one story instead of a grab-bag of unrelated answers.
const CANNED: Canned[] = [
  {
    label: 'Name the app',
    prompt: 'Name the app',
    title: 'Names for the app',
    text: '## Names for the app\n\n- **Cadence** — steady, rhythmic focus\n- **Deepwell** — go deep, stay deep\n- **Kindle** — spark and sustain attention\n- **Lattice** — structure for your day\n- **Northlight** — a clear direction\n\nCheck the .com and trademark, then test the top two with five users.',
  },
  {
    label: "Who's it for?",
    prompt: "Who's it for?",
    title: 'Target user',
    text: '## Target user\n\n**Maya, 29 — indie maker**\n\n- **Goal:** ship side projects without the day leaking away\n- **Frustration:** notifications and “quick checks” fracture her focus\n- **Wins her over:** a one-tap session that feels calm, and a weekly review she trusts\n\nSecondary: students in exam season and remote knowledge workers.',
  },
  {
    label: 'Competitors to watch',
    prompt: 'Competitors to watch',
    title: 'Competitors',
    text: '## Competitors\n\n- **Freedom** — cross-device blocking; powerful but heavy\n- **Forest** — gamified focus; loved, but shallow\n- **Opal** — polished screen-time control; iOS-first\n- **Cold Turkey** — hardcore blocking; not gentle\n\n**The gap:** a calm, review-first app that respects the user.',
  },
];

// The fixed prompt sitting in the box; sending it (or anything) seeds this card
// — the launch plan for the same focus app.
const FLAGSHIP: Canned = {
  label: 'Plan a launch week for the app',
  prompt: 'Plan a launch week for the app',
  title: 'Launch week',
  text: "## Launch week\n\n- **Mon** — Tease it: “protect your deep work” on socials + the waitlist\n- **Tue** — Publish the story and a 60-second demo\n- **Wed** — Product Hunt launch; rally early testers\n- **Thu** — Founder AMA; reply to every comment\n- **Fri** — Recap the wins, thank the first users, open feedback\n\nLine up five testimonials and three press contacts the week before.",
};

export function EmbedComposer() {
  const editor = useEditor();
  const [value, setValue] = useState(FLAGSHIP.prompt);

  // Drop a card, laid out in a tidy grid beside the seed, then reframe so the
  // growing board stays in view.
  const place = (title: string, text: string) => {
    const i = editor.getCurrentPageShapes().filter((s) => s.type === 'doc-card').length;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const id = createShapeId();
    editor.createShape({
      id,
      type: 'doc-card',
      x: -210 + col * 460,
      y: -150 + row * 400, // generous so a tall card never overlaps the row below
      props: { w: 420, h: 200, title, text },
    });
    editor.select(id);
    requestAnimationFrame(() => {
      const b = editor.getCurrentPageBounds();
      if (b) editor.zoomToBounds(b, { inset: 60, targetZoom: 1, animation: { duration: 320 } });
    });
  };

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    const hit =
      CANNED.find((c) => c.prompt.toLowerCase() === q.toLowerCase()) ??
      CANNED.find((c) => c.label.toLowerCase() === q.toLowerCase());
    const card = hit ?? FLAGSHIP;
    place(card.title, card.text);
    setValue(FLAGSHIP.prompt); // keep the fixed prompt ready
  };

  return (
    <div className="jz-promptbar-dock" onPointerDown={stopEventPropagation}>
      <div className="jz-promptbar-chips">
        {CANNED.map((c) => (
          <button key={c.label} className="jz-pb-chip" title="Spawn a card" onClick={() => place(c.title, c.text)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="jz-promptbar" style={{ '--pb-max': '560px' } as CSSProperties}>
        {/* Read-only: the preview carries a fixed prompt — send it, or tap a
            suggestion. Editing is reserved for the full app. */}
        <textarea
          className="jz-promptbar-input"
          value={value}
          rows={2}
          readOnly
          style={{ cursor: 'default' }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="jz-promptbar-footer">
          <div className="jz-promptbar-footer-left" />
          <button
            className="jz-promptbar-send"
            disabled={!value.trim()}
            onClick={submit}
            title="Send (Enter)"
          >
            <ArrowUp size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
