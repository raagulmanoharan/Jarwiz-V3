# Jarwiz — Thinking Made Visual

**Jarwiz is an infinite canvas where live AI agents are your collaborators.**
Think FigJam, but the other cursors on the board aren't coworkers — they're a
research agent, a summarizer, a brainstormer, and a writer, working alongside
you to take an idea from zero to a finished artifact.

## Why this exists

People don't think in linear documents or chat threads. We chunk ideas,
spread them out, move them around, and discover correlations spatially —
that's why whiteboards, sticky notes, and mood boards survive every
generation of productivity software. Today's AI tools ignore this: they trap
the most powerful thinking aid ever built inside a chat box.

Jarwiz puts AI where thinking actually happens — **on the board, as a
presence, producing artifacts you can see, move, connect, and keep**. The
unit of collaboration is not a message; it's a card on the canvas.

The bar for every interaction: *it should just make sense*. Drop a YouTube
link, and of course the Summarizer offers to give you the gist. Select three
research cards and ask the Writer for a draft, and of course the script
appears as a document connected to its sources. Common sense, made visible.

## The cast (v1 agents)

Each agent has a name, an identity color, a visible cursor, and a specific
kind of artifact it produces. Agents never dump text into a chat pane — they
work on the canvas.

| Agent | Color | What it does | Artifact it produces |
|---|---|---|---|
| **Researcher** | Blue | Given an idea or card, searches the web and pulls relevant sources | A fan of link cards, each connected to the idea that spawned them |
| **Summarizer** | Amber | Watches for summarizable content (YouTube links, articles, PDFs) | A summary card connected to the source — "the gist" at a glance |
| **Brainstormer** | Pink | Riffs on any card or cluster: angles, hooks, counterpoints, names | Sticky-note cards fanned out around the seed, keep or dismiss each |
| **Writer** | Green | Synthesizes selected cards into long-form output | An editable document card (e.g. the script), linked to every source it drew from |

## The hybrid interaction model

Two ways agents act, and only two:

1. **Summoned.** Select any card, cluster, or region → "Ask an agent" →
   pick one. The agent walks over (cursor animates to the selection), works
   visibly, and leaves artifacts connected to what you selected.
2. **Offered.** When context makes the next step obvious (a YouTube link
   lands on the board), the relevant agent *raises its hand* — a small,
   dismissible suggestion chip near the new card ("Summarize this?"). One
   tap accepts. **Proactive output never lands on the board without your
   tap.** No clutter, no runaway spend, but the board still feels alive.

## Presence (the differentiator)

Agents are *visibly present*, full FigJam-style:

- **Named cursors** in the agent's color that move to where the agent works.
- **Streaming artifacts** — cards fill in word-by-word as the agent writes.
- **Status chips** — "Researcher is reading theverge.com…", "Writer is
  drafting…" — honest, specific, never fake progress.
- **The dock** — a calm strip showing who's on the board and what each
  agent is doing right now.

If we cut scope anywhere, it is not here. Presence is the product.

## The golden path (v1 acceptance scenario)

> *"I want to write a script for a YouTube video."*

1. You type the idea onto the canvas as a note: *"Video: why everyone is
   wrong about spaced repetition."*
2. You summon the **Researcher** on it. Its cursor walks over; link cards
   stream in — studies, articles, a competing video — each connected to your
   idea.
3. You drop a YouTube link you found yourself. The **Summarizer** raises its
   hand; one tap, and a summary card appears wired to the video.
4. You summon the **Brainstormer** on the cluster. Sticky notes fan out:
   hooks, structures, contrarian angles. You drag the keepers closer and
   delete the rest.
5. You select your idea, three sources, the summary, and two hooks, and
   summon the **Writer**. A document card streams in: a full script draft,
   linked back to every card it used.
6. You edit the script in place. Zero to 100, all on one board, and the
   board itself *is* the record of how you got there.

Every milestone is judged against this scenario.

## Design language

Inherited from the prototype and refined — this is a deliberate aesthetic,
keep it:

- **Warm paper canvas** (`#f5eee2`) — calm, analog, not another gray tool.
- **Soft white cards** — generous radius, layered shadows, restrained type.
- **Agent identity hues** (blue / amber / pink / green) used consistently
  for cursors, suggestion chips, card accents, and connection lines — you
  always know *who* made *what*.
- Motion is purposeful: cursors glide, cards stream, nothing bounces for
  attention.

## What v1 is not

- Not multiplayer (no human-to-human collaboration yet — the architecture
  keeps the seam open; tldraw is multiplayer-ready).
- No accounts, no cloud sync — boards persist locally (IndexedDB). The thin
  server holds API keys and runs agents, nothing else.
- No agent marketplace / custom agents — four agents, done deeply.
- No mobile.

## Principles to arbitrate disagreements

1. **Artifacts over messages.** If an agent's output could be a card, it
   must be a card.
2. **Consent over magic.** Proactive means *offering*, never *doing*.
3. **Presence is honest.** Status text reflects what the model is actually
   doing; no theatrical fake cursors.
4. **The board is the memory.** Connections between cards are first-class —
   they are how the user (and later, the agents) understand provenance.
5. **Calm by default.** When no agent is working, the board is silent paper.
