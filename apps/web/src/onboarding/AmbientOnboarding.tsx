/**
 * Ambient onboarding — the "board is already alive" scene behind the intent
 * composer on a brand-new empty board. Collaborators (PM / Researcher /
 * Designer / Founder) sweep in from the edges *carrying* an illustrative card,
 * drop it, and linger hovering nearby; then the centre orb (the composer's ✦
 * spark) pulses and *births* one Jarwiz cursor per card in quick succession,
 * each gliding out along an organic curve to work its card — its tooltip
 * stepping through specific verbs while it drifts very subtly in place.
 *
 * It's a decorative overlay (pointer-events: none): the real cards, composer,
 * and rail live elsewhere. It mounts while `isOnboarding()` and hushes the
 * moment you engage the composer (`isOnboardingEngaged()`), then the PromptBar
 * glides the composer down into its dock and the board takes over.
 *
 * Motion is imperative (WAAPI + transform tweens) rather than React state — the
 * choreography is a self-contained script that runs once against refs, so a
 * re-render never restarts it. Honours prefers-reduced-motion with a static
 * arrangement.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  isOnboarding,
  isOnboardingEngaged,
  subscribeOnboarding,
} from '../ask/onboardingStore';
import { getPersona, subscribePersona, type Persona } from './personaStore';

interface AmbCard {
  key: string;
  fx: number;
  fy: number;
  persona: string;
  personaLabel: string;
  from: (w: number, h: number) => { x: number; y: number };
}

// four call-and-response pairs, one per corner, using the top and bottom bands.
// Geometry + cast only — what the cards SAY (and what Jarwiz does to them)
// comes from CONTENT, keyed on the visitor's persona pick.
const CARDS: AmbCard[] = [
  { key: 'sticky', fx: 0.14, fy: 0.25, persona: 'pm', personaLabel: 'PM', from: (_w, h) => ({ x: -80, y: 0.30 * h }) },
  { key: 'link', fx: 0.86, fy: 0.24, persona: 'research', personaLabel: 'Researcher', from: (w, h) => ({ x: w + 80, y: 0.22 * h }) },
  { key: 'img', fx: 0.14, fy: 0.77, persona: 'design', personaLabel: 'Designer', from: (_w, h) => ({ x: -80, y: 0.82 * h }) },
  { key: 'doc', fx: 0.86, fy: 0.76, persona: 'founder', personaLabel: 'Founder', from: (w, h) => ({ x: w + 80, y: 0.80 * h }) },
];

interface AmbContent {
  note: string;
  linkTitle: string;
  linkDomain: string;
  docTitle: string;
  docText: string;
  /** Per card (sticky/link/img/doc), the verb script its Jarwiz steps through. */
  verbs: [string[], string[], string[], string[]];
}

// The scene the visitor recognises as their own work. Picking an identity chip
// re-themes the texts live; the choreography (positions, cast) never changes.
const CONTENT: Record<Persona | 'default', AmbContent> = {
  default: {
    note: 'Onboarding feels empty — there’s no reason to stick around yet',
    linkTitle: 'Notion vs Linear vs Asana — which fits a small team?',
    linkDomain: 'toolfinder.co',
    docTitle: 'Product brief',
    docText: 'Give people a reason to stay — show intelligence in the first few seconds, before the blank canvas.',
    verbs: [
      ['Reading the note', 'Spotting the real gap', 'Drafting three fixes'],
      ['Opening the link', 'Weighing all three', 'Laying it out as a table'],
      ['Studying the screen', 'Tracing the flow', 'Redrawing it as a diagram'],
      ['Skimming the brief', 'Pulling the key points', 'Outlining next steps'],
    ],
  },
  product: {
    note: 'Launch slipped again — scope keeps growing mid-sprint',
    linkTitle: 'Notion vs Linear vs Asana — which fits a small team?',
    linkDomain: 'toolfinder.co',
    docTitle: 'Launch brief',
    docText: 'Ship the smallest thing that proves the bet — cut scope, not the deadline.',
    verbs: [
      ['Reading the note', 'Spotting the real gap', 'Drafting three fixes'],
      ['Opening the link', 'Weighing all three', 'Laying it out as a table'],
      ['Studying the screen', 'Tracing the flow', 'Redrawing it as a diagram'],
      ['Skimming the brief', 'Cutting it to a plan', 'Outlining next steps'],
    ],
  },
  research: {
    note: 'Three studies disagree — effect size shrinks with sample size',
    linkTitle: 'Remote work and productivity — a 2026 meta-analysis',
    linkDomain: 'journals.example.org',
    docTitle: 'Reading notes',
    docText: 'The strongest effects appear in self-reported data — the measured studies tell a quieter story.',
    verbs: [
      ['Reading the note', 'Comparing the claims', 'Flagging the outlier'],
      ['Opening the paper', 'Weighing the evidence', 'Building a comparison table'],
      ['Studying the figure', 'Tracing the method', 'Redrawing it as a diagram'],
      ['Skimming the notes', 'Clustering the themes', 'Drafting a summary'],
    ],
  },
  design: {
    note: 'Users bail on step 3 — the form asks too much too soon',
    linkTitle: 'Onboarding patterns that actually convert',
    linkDomain: 'nngroup.com',
    docTitle: 'Design crit notes',
    docText: 'The empty state is the first impression — show the product working before asking for anything.',
    verbs: [
      ['Reading the note', 'Spotting the friction', 'Sketching two fixes'],
      ['Opening the link', 'Pulling the patterns', 'Laying them out as a board'],
      ['Studying the screen', 'Tracing the flow', 'Redrawing it as a diagram'],
      ['Skimming the notes', 'Grouping the feedback', 'Outlining next steps'],
    ],
  },
};

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AmbientOnboarding() {
  const active = useSyncExternalStore(subscribeOnboarding, isOnboarding, isOnboarding);
  const engaged = useSyncExternalStore(subscribeOnboarding, isOnboardingEngaged, isOnboardingEngaged);
  // Keep the scene mounted through the fade-out after onboarding ends, so it
  // reads as the room bowing out rather than a hard cut.
  const [mounted, setMounted] = useState(active);
  useEffect(() => {
    if (active) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), 900);
    return () => window.clearTimeout(t);
  }, [active]);
  if (!mounted) return null;
  return <AmbientScene hushed={!active || engaged} />;
}

function AmbientScene({ hushed }: { hushed: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hushedRef = useRef(hushed);
  hushedRef.current = hushed;
  // A persona pick re-themes the scene LIVE: React swaps the card texts, and
  // the imperative verb loop reads through this ref on every step — the
  // choreography itself (positions, cast, timing) never restarts.
  const persona = useSyncExternalStore(subscribePersona, getPersona, getPersona);
  const content = CONTENT[persona ?? 'default'];
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let alive = true;
    const timers = new Set<number>();
    const sleep = (ms: number) =>
      new Promise<void>((res) => { const t = window.setTimeout(() => { timers.delete(t); res(); }, ms); timers.add(t); });
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const hushed = () => hushedRef.current;

    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    const cardEl = (key: string) => q(`[data-card="${key}"]`);
    const innerEl = (key: string) => cardEl(key)?.firstElementChild?.firstElementChild as HTMLElement | null;
    const curEl = (id: string) => q(`[data-cur="${id}"]`);
    const px = (fx: number, fy: number) => ({ x: fx * W(), y: fy * H() });

    // ── orb (the composer's ✦ spark) — where every Jarwiz is born ──────────
    const spark = document.querySelector<HTMLElement>('.jz-pb-intro-spark');
    const ring = q('[data-ring]');
    let orb = { x: 0.5 * W(), y: 0.34 * H() };
    const measureOrb = () => {
      if (spark) { const r = spark.getBoundingClientRect(); orb = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
      if (ring) { ring.style.left = orb.x + 'px'; ring.style.top = orb.y + 'px'; }
    };
    const pulseOrb = () => {
      if (spark) { spark.classList.remove('jz-pb-intro-spark--emit'); void spark.offsetWidth; spark.classList.add('jz-pb-intro-spark--emit'); }
      if (ring) { ring.classList.remove('jz-amb-go'); void ring.offsetWidth; ring.classList.add('jz-amb-go'); }
    };

    // ── low-level cursor + card movers ─────────────────────────────────────
    type Pt = { x: number; y: number };
    const trackedX = new WeakMap<HTMLElement, number>();
    const trackedY = new WeakMap<HTMLElement, number>();
    const setCur = (el: HTMLElement, x: number, y: number, ms: number, scale = 1) => {
      el.style.transitionDuration = ms / 1000 + 's, .5s';
      el.style.transform = `translate(${x - 4}px, ${y - 3}px) scale(${scale})`;
      trackedX.set(el, x); trackedY.set(el, y);
    };
    const moveCur = (el: HTMLElement, x: number, y: number, ms: number) => setCur(el, x, y, ms, 1);
    const showCur = (el: HTMLElement, on: boolean) => el.classList.toggle('jz-amb-show', on);
    const setStatus = (el: HTMLElement, text: string) => {
      const stt = el.querySelector<HTMLElement>('.stt');
      if (stt) stt.textContent = text || '';
      el.classList.toggle('jz-amb-working', !!text);
    };

    // organic travel — a gently bowed quadratic bézier; scales along the way
    const fly = (el: HTMLElement, from: Pt, to: Pt, dur: number, sign = 1, sFrom = 1, sTo = 1) => {
      const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist, ny = dx / dist;
      const bow = Math.min(120, dist * 0.24) * sign;
      const cx = (from.x + to.x) / 2 + nx * bow, cy = (from.y + to.y) / 2 + ny * bow;
      const N = 20; const frames: Keyframe[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, mt = 1 - t;
        const x = mt * mt * from.x + 2 * mt * t * cx + t * t * to.x;
        const y = mt * mt * from.y + 2 * mt * t * cy + t * t * to.y;
        const s = sFrom + (sTo - sFrom) * t;
        frames.push({ transform: `translate(${x - 4}px, ${y - 3}px) scale(${s})`, offset: t });
      }
      trackedX.set(el, to.x); trackedY.set(el, to.y);
      const anim = el.animate(frames, { duration: dur, easing: 'cubic-bezier(0.42,0,0.24,1)', fill: 'forwards' });
      return anim.finished.then(() => { try { anim.commitStyles(); } catch { /* not rendered */ } anim.cancel(); }).catch(() => {});
    };

    // card movers (by left/top centre; noanim = instant placement)
    const placeCardInstant = (key: string, x: number, y: number) => {
      const el = cardEl(key); if (!el) return;
      el.classList.add('jz-amb-noanim'); el.style.left = x + 'px'; el.style.top = y + 'px'; void el.offsetWidth; el.classList.remove('jz-amb-noanim');
    };
    const moveCard = (key: string, x: number, y: number) => { const el = cardEl(key); if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; } };

    // ── a collaborator carries a card in, drops it, and lingers ────────────
    const personaDrop = async (curId: string, c: AmbCard) => {
      const cur = curEl(curId); const el = cardEl(c.key); if (!cur || !el) return;
      const p = px(c.fx, c.fy); const f = c.from(W(), H());
      placeCardInstant(c.key, f.x, f.y);
      el.classList.add('jz-amb-in');
      moveCur(cur, f.x, f.y, 0); showCur(cur, true);
      await sleep(60);
      moveCur(cur, p.x + 18, p.y + 16, 950);
      moveCard(c.key, p.x, p.y);
      await sleep(940);
      el.classList.add('jz-amb-dropped');
      personaHover(cur, c);
    };
    const personaHover = (cur: HTMLElement, c: AmbCard) => {
      const p = px(c.fx, c.fy);
      const inner = innerEl(c.key);
      const h = inner ? inner.offsetHeight : 150, w = inner ? inner.offsetWidth : 200;
      const bx = p.x - w * 0.18, by = p.y - h / 2 - 26;
      moveCur(cur, bx, by, 800); trackedX.set(cur, bx); trackedY.set(cur, by);
      void (async () => {
        await sleep(760);
        let n = 0;
        while (alive) {
          if (hushed()) { await sleep(300); continue; }
          const hx = bx + (Math.random() - 0.5) * 46, hy = by + (Math.random() - 0.5) * 28;
          await fly(cur, { x: trackedX.get(cur) ?? bx, y: trackedY.get(cur) ?? by }, { x: hx, y: hy }, 1500 + Math.random() * 800, n % 2 ? 1 : -1);
          n++;
          await sleep(800 + Math.random() * 900);
        }
      })();
    };

    // ── one Jarwiz per card: born from the orb, then it stays and works ────
    const litCount: Record<string, number> = {};
    const lit = (key: string, d: number) => { litCount[key] = (litCount[key] || 0) + d; innerEl(key)?.classList.toggle('jz-amb-lit', litCount[key] > 0); };
    // Verbs are read through contentRef on every step, so a persona pick
    // swaps what each Jarwiz says mid-loop without restarting the motion.
    const verbsFor = (idx: number) => contentRef.current.verbs[idx] ?? [];
    const worker = async (curId: string, idx: number) => {
      const el = curEl(curId); const c = CARDS[idx]; if (!el || !c) return;
      const p = px(c.fx, c.fy);
      const tx = c.fx > 0.5 ? p.x - 96 : p.x + 8, ty = p.y + 10;
      // Re-measure at birth time: the first measure lands while the composer
      // is still gliding up to centre, so a stale orb puts the ring (and the
      // newborn cursor's first frame) in empty space above the composer.
      measureOrb();
      setCur(el, orb.x, orb.y, 0, 0.12); showCur(el, true);
      pulseOrb();
      await sleep(90);
      await fly(el, { x: orb.x, y: orb.y }, { x: tx, y: ty }, 1250, idx % 2 ? 1 : -1, 0.12, 1);
      if (!alive) return;
      lit(c.key, +1);
      setStatus(el, verbsFor(idx)[0] ?? '');
      let vi = 0, hops = 0;
      while (alive) {
        if (hushed()) { await sleep(300); continue; }
        const hx = tx + (Math.random() - 0.5) * 18, hy = ty + (Math.random() - 0.5) * 14;
        await fly(el, { x: trackedX.get(el) ?? tx, y: trackedY.get(el) ?? ty }, { x: hx, y: hy }, 1600 + Math.random() * 700, hops % 2 ? 1 : -1);
        hops++;
        const verbs = verbsFor(idx);
        if (hops % 2 === 0 && verbs.length > 1) { vi = (vi % (verbs.length - 1)) + 1; if (!hushed()) setStatus(el, verbs[vi] ?? ''); }
        await sleep(500 + Math.random() * 400);
      }
    };

    // ── the whole scene ────────────────────────────────────────────────────
    if (reduceMotion()) {
      measureOrb();
      CARDS.forEach((c, i) => {
        const p = px(c.fx, c.fy);
        placeCardInstant(c.key, p.x, p.y);
        cardEl(c.key)?.classList.add('jz-amb-in');
        const jz = curEl(`jz${i}`);
        if (jz) { const tx = c.fx > 0.5 ? p.x - 96 : p.x + 8, ty = p.y + 10; showCur(jz, true); setCur(jz, tx, ty, 0, 1); setStatus(jz, contentRef.current.verbs[i]?.[1] ?? ''); }
        lit(c.key, +1);
      });
      return () => { alive = false; timers.forEach((t) => window.clearTimeout(t)); };
    }

    void (async () => {
      measureOrb();
      // collaborators arrive from the edges and drop their cards, one by one
      for (let i = 0; i < CARDS.length; i++) { if (!alive) break; await personaDrop(`c-${CARDS[i]!.persona}`, CARDS[i]!); await sleep(150); }
      await sleep(300);
      if (!alive) return;
      // the orb fires the Jarwiz out in quick succession — tan-tan-tan-tan
      for (let i = 0; i < CARDS.length; i++) { if (!alive) break; void worker(`jz${i}`, i); await sleep(430); }
    })();

    const onResize = () => measureOrb();
    window.addEventListener('resize', onResize);
    return () => { alive = false; timers.forEach((t) => window.clearTimeout(t)); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div ref={rootRef} className={`jz-ambient${hushed ? ' jz-ambient--hushed' : ''}`} aria-hidden>
      <span className="jz-amb-ring" data-ring />

      {/* four illustrative "message" cards — texts re-theme with the persona */}
      <div className="jz-amb-item" data-card="sticky"><div className="jz-amb-body"><div className="jz-amb-note">{content.note}</div></div></div>
      <div className="jz-amb-item" data-card="link"><div className="jz-amb-body"><div className="jz-amb-card jz-amb-link"><div className="media" /><div className="lbody"><div className="ltitle">{content.linkTitle}</div><div className="lfoot"><span className="fav" /><span className="dom">{content.linkDomain}</span></div></div></div></div></div>
      <div className="jz-amb-item" data-card="img"><div className="jz-amb-body"><div className="jz-amb-card jz-amb-img"><div className="pic" /></div></div></div>
      <div className="jz-amb-item" data-card="doc"><div className="jz-amb-body"><div className="jz-amb-card jz-amb-doc"><div className="dtitle">{content.docTitle}</div><div className="dtext">{content.docText}</div></div></div></div>

      {/* collaborator cursors — carry cards in from the edges, then linger */}
      {CARDS.map((c) => (
        <div key={c.persona} className={`jz-amb-cur jz-amb-cur--persona jz-amb-cur--${c.persona}`} data-cur={`c-${c.persona}`}>
          <svg viewBox="0 0 24 24"><path className="arrow" d="M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z" /></svg>
          <div className="jz-amb-badge"><span className="nm">{c.personaLabel}</span></div>
        </div>
      ))}

      {/* Jarwiz cursors — born from the orb, one per card, tooltip = its verb */}
      {CARDS.map((_, i) => (
        <div key={i} className="jz-amb-cur jz-amb-cur--jarwiz" data-cur={`jz${i}`}>
          <svg viewBox="0 0 24 24"><path className="arrow" d="M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z" /></svg>
          <div className="jz-amb-badge"><span className="nm">Jarwiz</span><span className="st"><span className="dots" /><span className="stt" /></span></div>
        </div>
      ))}
    </div>
  );
}
