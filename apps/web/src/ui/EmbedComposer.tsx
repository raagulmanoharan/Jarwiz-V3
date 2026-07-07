/**
 * The embed (?embed=1) composer — a minified stand-in for the real prompt bar,
 * used in the marketing site's live-preview iframe. It reuses the prompt-bar
 * styles so it looks identical.
 *
 * The hero's whole job is to *show the transformation*: a blank canvas becomes a
 * board of cards. So on load this auto-plays ONCE — the idea lands, the goal
 * types itself into the composer, and the agent fans a board of cards out across
 * the canvas — then it stops and hands the finished, live board to the visitor
 * to poke at (move cards, tap a suggestion, send the prompt). It deliberately
 * does NOT loop: a re-wipe would blank the canvas to black mid-view and yank the
 * board out from under anyone who started dragging a card.
 *
 * On a static host there's no server, so the answers are a friendly "cheat":
 * each suggestion maps to a hand-authored card. Sending drops a polished card
 * onto the canvas — so the preview feels like the real thing without an API key.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
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

// The card the idea starts as — what the visitor "brought" to the canvas.
const INTRO_GOAL = {
  title: 'The idea — Focus',
  text: '## Focus — a calm deep-work app\n\nOne-tap focus sessions, gentle nudges, and a weekly review of where your attention actually went.',
};
// The cards the agent fans out during the autoplay, in order.
const INTRO_BUILD: Canned[] = [...CANNED.slice(0, 2), FLAGSHIP];

export function EmbedComposer() {
  const editor = useEditor();
  const [value, setValue] = useState(FLAGSHIP.prompt);
  // Once the visitor interacts, the demo stops driving the canvas for good.
  const takenOver = useRef(false);
  const timers = useRef<number[]>([]);

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
    const b = editor.getCurrentPageBounds();
    if (b) editor.zoomToBounds(b, { inset: 60, targetZoom: 1, animation: { duration: 380 } });
  };

  // The autoplay: idea → type the goal → fan out the board → hold → loop.
  useEffect(() => {
    const after = (ms: number, fn: () => void) => {
      const t = window.setTimeout(fn, ms) as unknown as number;
      timers.current.push(t);
    };
    const clearTimers = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };

    const run = () => {
      if (takenOver.current) return;
      // Wipe to a blank canvas and drop the starting idea.
      const ids = [...editor.getCurrentPageShapeIds()];
      if (ids.length) editor.deleteShapes(ids);
      place(INTRO_GOAL.title, INTRO_GOAL.text);

      // Type the goal into the composer, then build the board card by card.
      const goal = FLAGSHIP.prompt;
      setValue('');
      let i = 0;
      const type = () => {
        if (takenOver.current) return;
        i += 1;
        setValue(goal.slice(0, i));
        if (i < goal.length) after(30, type);
        else after(480, build);
      };
      const build = () => {
        if (takenOver.current) return;
        INTRO_BUILD.forEach((c, k) => after(k * 820, () => !takenOver.current && place(c.title, c.text)));
        // Play runs ONCE: once the board is laid out, hand it to the visitor —
        // stop driving the canvas so nothing re-wipes and they can move cards,
        // tap a suggestion, or send the prompt on a real, live board.
        after(INTRO_BUILD.length * 820 + 600, () => {
          takenOver.current = true;
          setValue(FLAGSHIP.prompt); // leave the fixed prompt ready to send
        });
      };
      after(520, type);
    };

    after(300, run);
    return clearTimers;
  }, [editor]);

  // Hand the canvas to the visitor: stop the loop and leave whatever's on screen.
  const takeOver = () => {
    takenOver.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const spawn = (title: string, text: string) => {
    takeOver();
    place(title, text);
  };

  const submit = () => {
    takeOver();
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
          <button key={c.label} className="jz-pb-chip" title="Spawn a card" onClick={() => spawn(c.title, c.text)}>
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
          onFocus={takeOver}
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
