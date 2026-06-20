# Big Rocks — 3-Week PRD

> Source: PM brainstorming session, 19 June 2026.  
> Framing: an experienced PM discovers Jarwiz as a brainstorming buddy, uses it live, and gives brutal honest feedback.  
> Goal: close the gap between "genuinely interesting demo" and "tool I reach for first on any new project."

---

## North star

A PM opens Jarwiz at the start of a project, not at the end to tidy up notes.  
That means it has to be *safe* (nothing lost), *fast to start* (not a blank terror), and *useful on your actual inputs* (not toy examples).  
Every rock below is in service of one of those three things.

---

## Week 1 — Make it safe to invest in ✅ shipped

The single biggest drop-off risk: "I spent an hour here and I don't know if it'll be there tomorrow." Fix that first. Everything else is built on trust.

> **Status (shipped):** All three rocks landed. Multi-board with per-board
> localStorage persistence + a topbar switcher (create/switch/rename/delete);
> the "What are you working on?" onboarding dialog on new boards; and five
> starter templates. Backward-compatible — the existing canvas migrates to a
> "My workspace" board on the legacy persistence key, so nothing is lost on
> upgrade. Verified by `scripts/eval-week1.mjs` (8/8), including the critical
> persistence-isolation check (switching boards restores each board's own
> canvas).

### 1.1 Multi-board with names
**Problem:** One infinite canvas means everything from every project lives in one place. By week two it's chaos.  
**Requirement:** A board switcher — create, name, and switch between boards. Each board is a separate persistent canvas. Start with a simple list; no folders needed yet.  
**Success:** A user can have "Auth revamp" and "Onboarding v3" as separate boards and switch between them in under two clicks.  
**Rough size:** Medium. Needs a persistence layer per board + UI.

### 1.2 Empty canvas onboarding — the invitation
**Problem:** Opening Jarwiz shows dot paper and a dock. There's no invitation. New users stare at it and close it.  
**Requirement:** On a brand-new empty board, show a centred prompt: *"What are you working on?"* with a text input. Submitting it names the board AND drops a seeded doc card with the problem statement as the title, already in edit mode, autopilot ready.  
**Success:** First-time user goes from open → first doc → first Tab continuation without touching a menu.  
**Rough size:** Small. Mostly UI + wire into the board-naming flow.

### 1.3 Starter templates
**Problem:** Every PM uses the same five starting structures. They're recreating them from scratch every time.  
**Requirement:** A "Start from a template" option on empty boards (or via the command palette). Ship five:  
- Problem statement → bets → success metrics  
- JTBD canvas (situation / motivation / outcome)  
- Feature brief (why / who / what / not-this)  
- Competitive landscape (comparison table seeded with columns)  
- Retrospective (what worked / what didn't / what we'll try)  

Each template is a pre-seeded set of cards with placeholder text, laid out spatially, ready to be filled.  
**Success:** User picks "Feature brief," gets a canvas that looks like a real starting point in under 5 seconds.  
**Rough size:** Small per template. Medium total (need a template picker UI).

---

## Week 2 — Make synthesis the differentiating feature

The PM insight that's hardest to articulate but most true: *"Stop generating new content and get better at making sense of my content."* Generation is table stakes. Synthesis is the moat.

### 2.1 Cluster stickies → named themes
**Problem:** A brainstorm session ends with 18 stickies. A PM then spends 30 minutes grouping them by hand, naming the clusters, writing a "themes so far" summary. This is exactly what AI should absorb.  
**Requirement:** Select a group of note cards → "Cluster & summarise" action in the Ask layer. The agent groups them spatially into named clusters (affinity board pattern, already buildable with existing affinity output shape), then produces a summary doc card with "3 themes emerged: …".  
**This is different from the existing affinity diagram:** that starts from a prompt. This starts from *the user's own stickies* and synthesises backward.  
**Success:** 10 stickies in → named clusters + summary doc out, in under 10 seconds. PM doesn't need to write the synthesis themselves.  
**Rough size:** Medium. Needs a new Ask routing path for the "synthesise my stickies" intent.

### 2.2 Transparent context — show your work
**Problem:** "Tab continued my doc — grounded in a nearby sticky, apparently. But which one? I have no idea." The AI's reasoning is opaque. Opacity erodes trust.  
**Requirement:** When Autopilot or Ask uses board context, surface it visibly:  
- Autopilot: after a continuation that drew on context, show a small "↳ grounded in: [Card title]" citation line below the appended text (collapsed by default, tappable to expand).  
- Ask: the answer card header shows "Based on: [source 1] · [source 2]" with tappable links that select and zoom to the source card.  
**Success:** A user can always answer "why did it say that?" by looking at the card, not by guessing.  
**Rough size:** Medium. Autopilot citation is simpler (server already has context, add a metadata event). Ask sourcing needs a new card header component.

### 2.3 Conflict detection
**Problem:** "I have a 'must be fast' sticky and a 'must be comprehensive' sticky on the same board. The AI should flag that tension."  
**Requirement:** A passive "Scan for tensions" action — run across the whole board (or a selection), return a small card that lists specific contradictions found between cards. Not generic ("these might conflict") but specific ("Card A says P0 is speed; Card C says P0 is completeness — these can't both be true").  
**Success:** On a board with at least one real contradiction, the agent surfaces it by name. On a consistent board, it returns "No direct contradictions found" (not a false positive farm).  
**Rough size:** Medium. New agent / Ask route. Quality of output depends heavily on prompt engineering.

---

## Week 3 — Give the agents opinions

Right now the agents are smart assistants. They do what you ask. A genuinely useful thinking partner *pushes back*. This week is about making the AI a collaborator, not a tool.

### 3.1 Devil's Advocate agent
**Problem:** "I want an agent that specifically tears apart my assumptions — not one that agrees with me and adds bullet points."  
**Requirement:** A named agent (Devil's Advocate / "DA") accessible via @mention or the roster. Given any card or selection, it does one thing: finds the weakest assumption, the most likely failure mode, and the stakeholder most likely to object — and writes them as a doc card. It does not offer solutions. It does not soften. It ends with a question.  
**Voice:** Sharp, specific, no hedging. "You're assuming enterprise buyers will approve a $X price point without a pilot. What's your evidence for that?"  
**Success:** After running DA on a feature brief, the PM can articulate at least one assumption they hadn't written down.  
**Rough size:** Small-medium. Mostly system prompt + registration. Quality gating needed.

### 3.2 "What am I missing?" agent
**Problem:** "I've been working on a feature for an hour. I want an agent to look at my whole board and tell me what a senior PM would ask that I haven't answered yet."  
**Requirement:** A board-wide scan agent. Reads all cards, identifies the standard PM due-diligence questions that *aren't answered anywhere on the board*. Returns a short doc card: "3 things I don't see on this board: (1) success metrics, (2) rollback plan, (3) competitive response."  
**This is not "here's more content." It's "here's what's missing."**  
**Success:** On a board with a genuine gap (e.g., no success metrics), the agent calls it out by name. On a complete board, it finds genuine edge cases, not padding.  
**Rough size:** Medium. Board serialisation + prompt. Risk of hallucinating "missing" things — needs tight prompting.

### 3.3 Conversational depth — back-and-forth on a card
**Problem:** "I ask a question, I get a doc card. But I want to *argue with it*." The current Ask flow is one-shot. The comment thread exists but it's not surfaced as a dialogue.  
**Requirement:** Promote the comment thread pattern. When an Ask produces a doc card, show a "Discuss →" chip below it that opens the comment thread inline. The PM types a follow-up ("yes but what about enterprise customers?") and the same agent revises the card in place — not spawning a new one — appending a "revised:" section or rewriting if instructed.  
**This is the difference between a deliverable and a conversation.**  
**Success:** A user can have a 3-turn dialogue with an agent about a single doc card without leaving the card or spawning orphan cards.  
**Rough size:** Large. Needs the comment→revise loop wired into the Ask pipeline. Plan carefully before starting.

---

## What we're explicitly NOT doing in these 3 weeks

- **Export / share links** — backburner as agreed. Ship when the core is solid.  
- **Voice input** — right direction, wrong time. Needs infra (transcription, intent routing). Post-3-weeks.  
- **Mobile** — desktop-first until the core loop is proven.  
- **Integrations** (Jira, Notion, Amplitude) — high value, high complexity. Needs its own planning cycle.  
- **Collaboration / multiplayer** — the tldraw primitives are there; the product decisions around sessions and permissions aren't.

---

## Sequencing logic

```
Week 1 (trust)    →  Week 2 (synthesis)  →  Week 3 (opinions)
Multi-board           Cluster stickies       Devil's Advocate
Empty canvas CTA      Transparent context    What am I missing?
Templates             Conflict detection     Conversational depth
```

Each week builds on the last. Don't start Week 2 until multi-board and persistence feel solid — synthesis on a canvas you're afraid to close is worthless.

---

## Open questions (need answers before building)

1. **Persistence backend**: Is the current canvas saved to localStorage only? If yes, multi-board is just namespaced localStorage keys, which is fine for now but sets a ceiling. What's the plan for server-side persistence?  
2. **Devil's Advocate quality bar**: How do we know when it's good enough to ship? Propose: internal dog-food on 3 real PM briefs before it goes live.  
3. **Template ownership**: Who writes and curates the templates? They need to feel PM-grade, not generic. Suggest: write the first five ourselves, in-character as the PM persona from this session.  
4. **Conflict detection false positive rate**: This could be very annoying if it cries wolf. Needs a confidence threshold and a "skip this one" affordance.

---

*This document was seeded from a live PM roleplay session and edited for delivery. Keep it honest — the PM's voice is the product's conscience.*
