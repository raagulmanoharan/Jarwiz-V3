/**
 * Ambient onboarding — the "board is already alive" scene behind the intent
 * composer on a brand-new empty board. The scene is SUMMONED by the persona
 * pick (owner call, 2026-07-12): it stays dark while "What brings you here?"
 * is up, then the chosen use case's own room assembles — collaborators who
 * belong to that world sweep in from the edges *carrying* that world's cards
 * (a checklist for a trip, a mini comparison table for a decision…), drop
 * them, and linger hovering nearby; then the centre orb (the composer's ✦
 * spark) pulses and *births* one Jarwiz cursor per card in quick succession,
 * each gliding out along an organic curve to work its card — its tooltip
 * stepping through verbs written for that card.
 *
 * It's a decorative overlay (pointer-events: none): the real cards, composer,
 * and rail live elsewhere. It mounts once `isOnboarding()` AND a persona has
 * been chosen (including "just exploring" → the default scene), and hushes
 * the moment you engage the composer (`isOnboardingEngaged()`), then the
 * PromptBar glides the composer down into its dock and the board takes over.
 *
 * Motion is imperative (WAAPI + transform tweens) rather than React state — the
 * choreography is a self-contained script that runs once against refs, so a
 * re-render never restarts it. The scene is keyed on the persona, so its cast,
 * card kinds, and texts are fixed for the run. Honours prefers-reduced-motion
 * with a static arrangement.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  isOnboarding,
  isOnboardingEngaged,
  subscribeOnboarding,
} from '../ask/onboardingStore';
import { getPersona, hasChosenPersona, subscribePersona, type Persona } from './personaStore';

// ── the four stage slots: corner positions + entry edges + cursor hue ────────
// Geometry only — WHO stands in a slot and WHAT they carry comes from SCENES.
interface AmbSlot {
  key: string;
  fx: number;
  fy: number;
  from: (w: number, h: number) => { x: number; y: number };
}

const SLOTS: AmbSlot[] = [
  { key: 's0', fx: 0.14, fy: 0.25, from: (_w, h) => ({ x: -80, y: 0.30 * h }) },
  { key: 's1', fx: 0.86, fy: 0.24, from: (w, h) => ({ x: w + 80, y: 0.22 * h }) },
  { key: 's2', fx: 0.14, fy: 0.77, from: (_w, h) => ({ x: -80, y: 0.82 * h }) },
  { key: 's3', fx: 0.86, fy: 0.76, from: (w, h) => ({ x: w + 80, y: 0.80 * h }) },
];

// ── what a slot holds: a card face + the collaborator who carries it in ─────
type AmbKind = 'note' | 'link' | 'img' | 'doc' | 'list' | 'table';

interface AmbSceneCard {
  kind: AmbKind;
  /** The collaborator badge on the cursor that carries this card in. */
  cast: string;
  /** note text */
  text?: string;
  /** link / doc / list / table heading */
  title?: string;
  /** link domain */
  domain?: string;
  /** doc body */
  body?: string;
  /** checklist rows */
  items?: Array<{ t: string; done?: boolean }>;
  /** mini-table rows (label, value) */
  rows?: Array<[string, string]>;
  /** The verb script this card's Jarwiz steps through. */
  verbs: string[];
}

type AmbScene = [AmbSceneCard, AmbSceneCard, AmbSceneCard, AmbSceneCard];

// The room each use case summons: its own cast, its own KINDS of cards (a
// trip gets a day-plan checklist; a decision gets a mini comparison table),
// its own texts and verbs. The choreography (slots, timing) is shared.
const SCENES: Record<Persona | 'default', AmbScene> = {
  default: [
    { kind: 'note', cast: 'PM', text: 'Onboarding feels empty — there’s no reason to stick around yet', verbs: ['Reading the note', 'Spotting the real gap', 'Drafting three fixes'] },
    { kind: 'link', cast: 'Researcher', title: 'Notion vs Linear vs Asana — which fits a small team?', domain: 'toolfinder.co', verbs: ['Opening the link', 'Weighing all three', 'Laying it out as a table'] },
    { kind: 'img', cast: 'Designer', verbs: ['Studying the screen', 'Tracing the flow', 'Redrawing it as a diagram'] },
    { kind: 'doc', cast: 'Founder', title: 'Product brief', body: 'Give people a reason to stay — show intelligence in the first few seconds, before the blank canvas.', verbs: ['Skimming the brief', 'Pulling the key points', 'Outlining next steps'] },
  ],
  product: [
    { kind: 'note', cast: 'PM', text: 'Launch slipped again — scope keeps growing mid-sprint', verbs: ['Reading the note', 'Spotting the real gap', 'Drafting three fixes'] },
    { kind: 'table', cast: 'Engineer', title: 'Tool shortlist', rows: [['Linear', 'fast, opinionated'], ['Notion', 'flexible, slower'], ['Asana', 'mature, heavier']], verbs: ['Scanning the shortlist', 'Weighing all three', 'Marking a winner'] },
    { kind: 'img', cast: 'Designer', verbs: ['Studying the screen', 'Tracing the flow', 'Redrawing it as a diagram'] },
    { kind: 'doc', cast: 'Founder', title: 'Launch brief', body: 'Ship the smallest thing that proves the bet — cut scope, not the deadline.', verbs: ['Skimming the brief', 'Cutting it to a plan', 'Outlining next steps'] },
  ],
  research: [
    { kind: 'note', cast: 'Researcher', text: 'Three studies disagree — effect size shrinks with sample size', verbs: ['Reading the note', 'Comparing the claims', 'Flagging the outlier'] },
    { kind: 'link', cast: 'Advisor', title: 'Remote work and productivity — a 2026 meta-analysis', domain: 'journals.example.org', verbs: ['Opening the paper', 'Weighing the evidence', 'Building a comparison table'] },
    { kind: 'table', cast: 'Analyst', title: 'Effect by sample size', rows: [['n = 1,200', 'd = 0.42'], ['n = 8,400', 'd = 0.19'], ['n = 22,000', 'd = 0.07']], verbs: ['Scanning the numbers', 'Tracing the shrink', 'Charting the trend'] },
    { kind: 'doc', cast: 'Co-author', title: 'Reading notes', body: 'The strongest effects appear in self-reported data — the measured studies tell a quieter story.', verbs: ['Skimming the notes', 'Clustering the themes', 'Drafting a summary'] },
  ],
  design: [
    { kind: 'note', cast: 'Researcher', text: 'Users bail on step 3 — the form asks too much too soon', verbs: ['Reading the note', 'Spotting the friction', 'Sketching two fixes'] },
    { kind: 'img', cast: 'Designer', verbs: ['Studying the screen', 'Tracing the flow', 'Redrawing it as a diagram'] },
    { kind: 'list', cast: 'PM', title: 'Crit follow-ups', items: [{ t: 'Cut step 3 to two fields', done: true }, { t: 'Move signup after the value' }, { t: 'Rethink the empty state' }], verbs: ['Reading the list', 'Grouping the fixes', 'Sequencing the work'] },
    { kind: 'doc', cast: 'Engineer', title: 'Design crit notes', body: 'The empty state is the first impression — show the product working before asking for anything.', verbs: ['Skimming the notes', 'Grouping the feedback', 'Outlining next steps'] },
  ],
  trip: [
    { kind: 'note', cast: 'Partner', text: 'Five days, three cities everyone recommends — we can’t do it all', verbs: ['Reading the note', 'Spotting the overlap', 'Cutting it to one city'] },
    { kind: 'link', cast: 'Friend', title: '48 hours in Kyoto — a first-timer’s guide', domain: 'theculturetrip.com', verbs: ['Opening the guide', 'Picking the keepers', 'Laying out a day plan'] },
    { kind: 'img', cast: 'Local guide', verbs: ['Studying the photo', 'Placing it on the map', 'Slotting it into day two'] },
    { kind: 'list', cast: 'Planner', title: 'Day one', items: [{ t: 'Drop bags at the ryokan', done: true }, { t: 'Fushimi Inari before the crowds' }, { t: 'Evening: izakaya alley' }], verbs: ['Skimming the plan', 'Checking the timings', 'Filling the gaps'] },
  ],
  talk: [
    { kind: 'note', cast: 'Organiser', text: 'Twenty minutes, forty slides — the story is buried in there', verbs: ['Reading the note', 'Finding the one idea', 'Cutting the rest'] },
    { kind: 'list', cast: 'Mentor', title: 'Talk beats', items: [{ t: 'Cold open: the outage story', done: true }, { t: 'One idea: systems beat heroics' }, { t: 'Close: what we’d undo' }], verbs: ['Reading the beats', 'Tightening the order', 'Cutting one slide'] },
    { kind: 'img', cast: 'Designer', verbs: ['Studying the slide', 'Tracing the arc', 'Redrawing it as a storyboard'] },
    { kind: 'doc', cast: 'Co-speaker', title: 'Talk outline', body: 'One idea per talk. Everything on every slide either serves it or steals from it.', verbs: ['Skimming the outline', 'Tightening the beats', 'Drafting the close'] },
  ],
  decide: [
    { kind: 'note', cast: 'Partner', text: 'Two good offers, one week to answer — gut says one, spreadsheet says the other', verbs: ['Reading the note', 'Naming the real question', 'Framing the trade-off'] },
    { kind: 'link', cast: 'Friend', title: 'How to make hard decisions without regret', domain: 'fs.blog', verbs: ['Opening the link', 'Weighing the criteria', 'Building a scorecard'] },
    { kind: 'table', cast: 'Advisor', title: 'The two offers', rows: [['Salary', 'A, by 15%'], ['Growth', 'B, clearly'], ['Commute', 'B, by an hour']], verbs: ['Scanning the table', 'Tracing what matters', 'Marking the deltas'] },
    { kind: 'doc', cast: 'Mentor', title: 'Decision notes', body: 'List what you can’t undo. The reversible parts are noise — decide those fast, spend the week on the rest.', verbs: ['Skimming the notes', 'Splitting reversible calls', 'Outlining a verdict'] },
  ],
};

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AmbientOnboarding() {
  const active = useSyncExternalStore(subscribeOnboarding, isOnboarding, isOnboarding);
  const engaged = useSyncExternalStore(subscribeOnboarding, isOnboardingEngaged, isOnboardingEngaged);
  // The pick summons the room: nothing plays behind "What brings you here?" —
  // answering it (or "just exploring") is what brings the collaborators in,
  // crisp and centre-stage rather than blurred behind the modal.
  const chosen = useSyncExternalStore(subscribePersona, hasChosenPersona, hasChosenPersona);
  const persona = useSyncExternalStore(subscribePersona, getPersona, getPersona);
  const show = active && chosen;
  // Keep the scene mounted through the fade-out after onboarding ends, so it
  // reads as the room bowing out rather than a hard cut.
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), 900);
    return () => window.clearTimeout(t);
  }, [show]);
  if (!mounted) return null;
  // Keyed on the persona: the scene's cast and cards are fixed for the run.
  const p = persona ?? 'default';
  return <AmbientScene key={p} scene={SCENES[p]} persona={p} hushed={!show || engaged} />;
}

/** One card face by kind — echoes the real cards' chrome at postcard scale. */
function CardFace({ c }: { c: AmbSceneCard }) {
  switch (c.kind) {
    case 'note':
      return <div className="jz-amb-note">{c.text}</div>;
    case 'link':
      return (
        <div className="jz-amb-card jz-amb-link">
          <div className="media" />
          <div className="lbody">
            <div className="ltitle">{c.title}</div>
            <div className="lfoot"><span className="fav" /><span className="dom">{c.domain}</span></div>
          </div>
        </div>
      );
    case 'img':
      return <div className="jz-amb-card jz-amb-img"><div className="pic" /></div>;
    case 'doc':
      return (
        <div className="jz-amb-card jz-amb-doc">
          <div className="dtitle">{c.title}</div>
          <div className="dtext">{c.body}</div>
        </div>
      );
    case 'list':
      return (
        <div className="jz-amb-card jz-amb-list">
          <div className="htit">{c.title}</div>
          {c.items?.map((it, i) => (
            <div key={i} className={`li${it.done ? ' done' : ''}`}><span className="bx" /><span>{it.t}</span></div>
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="jz-amb-card jz-amb-table">
          <div className="htit">{c.title}</div>
          <div className="trows">
            {c.rows?.map(([k, v], i) => (
              <div key={i} className="tr"><span className="tk">{k}</span><span className="tv">{v}</span></div>
            ))}
          </div>
        </div>
      );
  }
}

function AmbientScene({ scene, persona, hushed }: { scene: AmbScene; persona: Persona | 'default'; hushed: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hushedRef = useRef(hushed);
  hushedRef.current = hushed;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let alive = true;
    const timers = new Set<number>();
    const sleep = (ms: number) =>
      new Promise<void>((res) => { const t = window.setTimeout(() => { timers.delete(t); res(); }, ms); timers.add(t); });
    // The scene's stage is its own container (the canvas area), NOT the
    // window — with the Boards panel docked, the two differ by the panel's
    // width, and window-based fractions painted cards over the panel.
    const W = () => root.clientWidth || window.innerWidth;
    const H = () => root.clientHeight || window.innerHeight;
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
      if (spark) {
        // Client rect → scene-local: the scene's origin is the canvas area's
        // corner, which sits right of the window's when the panel is docked.
        const r = spark.getBoundingClientRect();
        const base = root.getBoundingClientRect();
        orb = { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
      }
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
    const personaDrop = async (curId: string, s: AmbSlot) => {
      const cur = curEl(curId); const el = cardEl(s.key); if (!cur || !el) return;
      const p = px(s.fx, s.fy); const f = s.from(W(), H());
      placeCardInstant(s.key, f.x, f.y);
      el.classList.add('jz-amb-in');
      moveCur(cur, f.x, f.y, 0); showCur(cur, true);
      await sleep(60);
      moveCur(cur, p.x + 18, p.y + 16, 950);
      moveCard(s.key, p.x, p.y);
      await sleep(940);
      el.classList.add('jz-amb-dropped');
      personaHover(cur, s);
    };
    const personaHover = (cur: HTMLElement, s: AmbSlot) => {
      const p = px(s.fx, s.fy);
      const inner = innerEl(s.key);
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
    const verbsFor = (idx: number) => sceneRef.current[idx]?.verbs ?? [];
    const worker = async (curId: string, idx: number) => {
      const el = curEl(curId); const s = SLOTS[idx]; if (!el || !s) return;
      const p = px(s.fx, s.fy);
      const tx = s.fx > 0.5 ? p.x - 96 : p.x + 8, ty = p.y + 10;
      // Re-measure at birth time: the first measure lands while the composer
      // is still gliding up to centre, so a stale orb puts the ring (and the
      // newborn cursor's first frame) in empty space above the composer.
      measureOrb();
      setCur(el, orb.x, orb.y, 0, 0.12); showCur(el, true);
      pulseOrb();
      await sleep(90);
      await fly(el, { x: orb.x, y: orb.y }, { x: tx, y: ty }, 1250, idx % 2 ? 1 : -1, 0.12, 1);
      if (!alive) return;
      lit(s.key, +1);
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
      SLOTS.forEach((s, i) => {
        const p = px(s.fx, s.fy);
        placeCardInstant(s.key, p.x, p.y);
        cardEl(s.key)?.classList.add('jz-amb-in');
        const jz = curEl(`jz${i}`);
        if (jz) { const tx = s.fx > 0.5 ? p.x - 96 : p.x + 8, ty = p.y + 10; showCur(jz, true); setCur(jz, tx, ty, 0, 1); setStatus(jz, verbsFor(i)[1] ?? ''); }
        lit(s.key, +1);
      });
      return () => { alive = false; timers.forEach((t) => window.clearTimeout(t)); };
    }

    void (async () => {
      measureOrb();
      // collaborators arrive from the edges and drop their cards, one by one
      for (let i = 0; i < SLOTS.length; i++) { if (!alive) break; await personaDrop(`c${i}`, SLOTS[i]!); await sleep(150); }
      await sleep(300);
      if (!alive) return;
      // the orb fires the Jarwiz out in quick succession — tan-tan-tan-tan
      for (let i = 0; i < SLOTS.length; i++) { if (!alive) break; void worker(`jz${i}`, i); await sleep(430); }
    })();

    const onResize = () => measureOrb();
    window.addEventListener('resize', onResize);
    return () => { alive = false; timers.forEach((t) => window.clearTimeout(t)); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`jz-ambient jz-ambient--${persona}${hushed ? ' jz-ambient--hushed' : ''}`}
      aria-hidden
    >
      <span className="jz-amb-ring" data-ring />

      {/* four illustrative cards — kinds and texts belong to the chosen use case */}
      {SLOTS.map((s, i) => (
        <div key={s.key} className="jz-amb-item" data-card={s.key}>
          <div className="jz-amb-body"><CardFace c={scene[i]!} /></div>
        </div>
      ))}

      {/* collaborator cursors — the use case's own cast carries its cards in */}
      {SLOTS.map((s, i) => (
        <div key={s.key} className={`jz-amb-cur jz-amb-cur--persona jz-amb-cur--${s.key}`} data-cur={`c${i}`}>
          <svg viewBox="0 0 24 24"><path className="arrow" d="M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z" /></svg>
          <div className="jz-amb-badge"><span className="nm">{scene[i]!.cast}</span></div>
        </div>
      ))}

      {/* Jarwiz cursors — born from the orb, one per card, tooltip = its verb */}
      {SLOTS.map((s, i) => (
        <div key={s.key} className="jz-amb-cur jz-amb-cur--jarwiz" data-cur={`jz${i}`}>
          <svg viewBox="0 0 24 24"><path className="arrow" d="M4.5 2.8 L20.4 9.6 L13.4 11.9 L10.7 18.8 Z" /></svg>
          <div className="jz-amb-badge"><span className="nm">Jarwiz</span><span className="st"><span className="dots" /><span className="stt" /></span></div>
        </div>
      ))}
    </div>
  );
}
