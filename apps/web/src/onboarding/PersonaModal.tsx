/**
 * "What brings you here?" — the ask-once persona modal over the intent screen.
 * Three identity cards (icon + a few example asks) float above the live
 * ambient scene; one tap re-themes the whole first run (starter prompts, the
 * composer's self-typing examples, the ambient cards) and persists, so no
 * surface ever asks again. "Just exploring" (or Escape / clicking the
 * backdrop) is a first-class answer, not a failure — it lands the generic
 * experience and is remembered the same way.
 *
 * Shows only while the intent screen is up AND the visitor has never
 * answered — a returning user, on any pick including exploring, goes straight
 * to the board.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { BookOpen, PenTool, Rocket } from 'lucide-react';
import { isOnboarding, subscribeOnboarding } from '../ask/onboardingStore';
import { hasChosenPersona, setPersona, subscribePersona, type Persona } from './personaStore';

const CARDS: Array<{
  persona: Persona;
  icon: typeof Rocket;
  title: string;
  blurb: string;
}> = [
  {
    persona: 'product',
    icon: Rocket,
    title: 'Building a product',
    blurb: 'Break down a launch plan, compare tools for the team, or turn a PRD into a board.',
  },
  {
    persona: 'research',
    icon: BookOpen,
    title: 'Researching a topic',
    blurb: 'Map a research area, compare studies in a table, or digest a long report into a page.',
  },
  {
    persona: 'design',
    icon: PenTool,
    title: 'Designing an experience',
    blurb: 'Map a user flow, prototype an idea, or cluster research notes into personas.',
  },
];

export function PersonaModal() {
  const onboarding = useSyncExternalStore(subscribeOnboarding, isOnboarding, isOnboarding);
  const chosen = useSyncExternalStore(subscribePersona, hasChosenPersona, hasChosenPersona);
  const open = onboarding && !chosen;
  // Keep mounted briefly after a pick so the card can play its exit fade.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), 400);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPersona(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className={`jz-persona${open ? '' : ' jz-persona--leaving'}`}
      role="dialog"
      aria-modal="true"
      aria-label="What brings you here?"
      onClick={() => setPersona(null)}
    >
      <div className="jz-persona-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="jz-persona-head">What brings you here?</h2>
        <p className="jz-persona-sub">One tap tunes Jarwiz to your kind of work — you can always just start typing instead.</p>
        <div className="jz-persona-cards">
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <button key={c.persona} className="jz-persona-card" onClick={() => setPersona(c.persona)}>
                <span className="jz-persona-icon"><Icon size={20} strokeWidth={1.8} /></span>
                <span className="jz-persona-title">{c.title}</span>
                <span className="jz-persona-blurb">{c.blurb}</span>
              </button>
            );
          })}
        </div>
        <button className="jz-persona-skip" onClick={() => setPersona(null)}>Just exploring →</button>
      </div>
    </div>
  );
}
