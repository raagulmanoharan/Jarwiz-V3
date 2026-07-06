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

const CANNED: Canned[] = [
  {
    label: 'Plan a weekend in Goa',
    prompt: 'Plan a weekend in Goa',
    title: 'Weekend in Goa',
    text: '## Weekend in Goa\n\n**Day 1 — North Goa**\n- Morning: Chapora Fort + the Vagator viewpoint\n- Lunch: Thalassa, sunset-facing\n- Evening: Anjuna flea market, drinks at Curlies\n\n**Day 2 — slow & south**\n- Breakfast at Baba au Rhum\n- Beach day at Palolem — calm and swimmable\n- Sunset dolphin trip, dinner at a beach shack\n\nBest months are Nov–Feb. Rent a scooter and book shacks ahead on weekends.',
  },
  {
    label: 'Name my new app',
    prompt: 'Name my new app',
    title: 'Names for a new app',
    text: '## Names for a new app\n\n- **Cadence** — steady, rhythmic progress\n- **Throughline** — keeps everything connected\n- **Kindle** — spark and sustain focus\n- **Lattice** — structure that scales\n- **Northlight** — a clear direction\n\nCheck the .com and trademark before you commit, then test the top two with five users.',
  },
  {
    label: 'Pros & cons of remote work',
    prompt: 'Pros & cons of remote work',
    title: 'Remote work — pros & cons',
    text: '## Remote work — pros & cons\n\n**Pros**\n- Deep-focus time and no commute\n- Hire from anywhere — a wider talent pool\n- Lower office overhead\n\n**Cons**\n- Weaker spontaneous collaboration\n- Onboarding and culture take deliberate effort\n- Timezone drag on fast decisions\n\n**Verdict:** hybrid with two anchor days captures most of the upside.',
  },
];

// The fixed prompt sitting in the box; sending it (or anything) seeds this card.
const FLAGSHIP: Canned = {
  label: 'Plan a launch week for a new app',
  prompt: 'Plan a launch week for a new app',
  title: 'Launch week plan',
  text: "## Launch week plan\n\n- **Mon** — Tease on socials and the email list (“something’s coming”)\n- **Tue** — Publish the launch post and a short demo video\n- **Wed** — Product Hunt launch; rally the community\n- **Thu** — Founder AMA; reply to every comment\n- **Fri** — Recap the wins, thank early users, open a feedback loop\n\nLine up five testimonials and three press contacts the week before.",
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
      y: -150 + row * 250,
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
