# Use case: the content creator's writers' room

*Owner brief (2026-07-05): "Support adding YouTube videos — imagine a content
creator adding a bunch of videos and asking to analyse the style etc to write
a similar script. Elaborate end to end; identify the gaps. Some human
intervention, some AI assistance."*

This doc walks the journey as the creator would live it, then audits every
beat against what Jarwiz can actually do today, and ends with the ranked gap
list and a build order. Hats worn: the creator, the UX designer, the
engineer, the skeptic.

---

## 1 · The persona

**Maya, 190k-subscriber YouTube educator.** Ships one 10–14 minute video a
week. Her scripts are the product; everything else (edit, thumbnail) is
downstream. When she plans a new video she does the same ritual every time:

1. Opens 4–8 reference videos — her own best performers plus two rivals
   whose pacing she envies.
2. Rewatches at 1.5×, pausing to note *how* they work: the cold-open hook,
   when the premise lands, segment lengths, where the sponsor read hides,
   the phrases she'd never say, the ones she wishes she'd written.
3. Distils a mental "voice spec" she can't quite articulate.
4. Writes a new script *in that voice* about the next topic — with fresh
   facts she researches separately.
5. Reads it aloud, cuts 20%, ships.

Steps 2–3 are hours of tab-switching between YouTube, a notes app, and a
doc. That's the job Jarwiz should absorb: **the board becomes her writers'
room** — references pinned as playable cards, the style analysis living
next to them as editable artifacts, the script drafted in the same place,
grounded in both.

## 2 · The journey on Jarwiz, beat by beat

**Beat 1 — Collect.** Maya pastes 6 YouTube URLs. Each lands as a playable
video card, auto-titled.
*Today:* works — `youtube-card` with embedded player, title tag.
*Gap:* the card holds only `videoId/url/title`. No transcript, no duration,
no channel, no "can Jarwiz actually read this?" signal.

**Beat 2 — "Analyse the style of these."** She rubber-bands the six cards
and asks.
*Today:* **broken at the root** — the ask pipeline doesn't map
youtube-cards to sources at all (`useAsk.toSource` has no youtube branch),
so the model literally doesn't know the videos exist. The irony: the server
already knows how to read captions (`fetchYouTubeText` scrapes the
transcript, honestly reports when there are none) — it's just only wired to
the old summarizer/suggest paths, not to Ask.
*What it should do:* per-video **style profile cards** (hook mechanics,
structure with rough timestamps, pacing, tone/vocabulary, recurring
devices, CTA placement) + one **cross-video synthesis**: what's constant
across her references (= the voice) vs what varies (= the topic). The
constant part is the spec.

**Beat 3 — Curate (the human intervention that matters most).** The
synthesis is a hypothesis, not truth. Maya deletes the row that's really
just MrBeast-envy, stickies "this is the sponsor pivot I actually use",
rewrites the tone line in her own words.
*Today:* mostly works already — cards are editable, stickies are the
annotation medium, tables have row delete, Keep/Discard covers regret.
*Gap:* nothing tells her *that* editing the profile is the mechanism — the
edited style card must be what grounds the next ask (it is, since asks
ground on selected cards — but the pills should coach it: "Draft a script
from this voice spec").

**Beat 4 — "Write a similar script about topic X."** She selects the
(curated) style card + maybe one reference video, and asks.
*Today:* the ask grounds on the style card fine; deep research can pull
current facts about X live (already shipped). Focus mode is already a
writing room; the refine bar already does "punchier / tighter".
*Gap:* script *shape*. A script isn't prose — it's beats with timings and
delivery notes (COLD OPEN → PREMISE → 3 SEGMENTS → CTA, "~90s", "hold up
the prop here"). Needs a script-aware system prompt (and possibly a
`/script` slash mode) rather than a new shape — the rich doc card
(sections, dividers, tables) can carry it.

**Beat 5 — Iterate & ship.** Read-aloud pass in focus mode, "cut 20%",
"rewrite the hook in the style of reference #2", export the text.
*Today:* refine-in-place + focus mode cover this well.
*Gap:* none blocking. (Copy-out is manual select-all; fine for v1.)

## 3 · The gaps, ranked

**G1 — Wire video cards into Ask. (small, unlocks everything)**
`toSource` maps youtube-card → `{kind:'youtube', url, title}`; server
`gatherContext` calls the existing `fetchYouTubeText` for youtube sources
(as it already extracts PDFs). Without G1 every other beat is theatre.

**G2 — Transcript depth + persistence. (medium)**
A 12-minute video ≈ 12–18k chars; today's fetch caps at 6k and re-scrapes
on every ask. Fetch once at paste time (like link-card page text), store on
the card (prop, or asset blob past ~30k), raise the per-video budget, and
keep rough timestamps (`[2:14]`) — style analysis is about *when* things
happen, not just what's said.

**G3 — Honesty badge on the card. (small, trust-critical)**
Captions exist or they don't (auto-captions count; ~a fifth of candidates
won't have any). The card should show "transcript ✓" / "audio not
readable — title & channel only", so Maya knows *before* she asks why one
video contributes nothing. Same honest-fallback text the server already
produces, surfaced as UI state. (NotebookLM has the same constraint; it
just fails quieter.)

**G4 — Style scan + multi-video synthesis. (medium)**
Six transcripts ≈ 80–100k chars — too much for one comfortable pass, and a
single blended answer hides which video contributed what. Map-reduce:
per-video profile cards (parallel, each grounded on ONE transcript), then a
synthesis card grounded on the profiles. This is a "Style" cousin of the
existing board scans, and the profile schema (hook / structure+timing /
pacing / tone / devices / CTA) is a system prompt, not new machinery.

**G5 — Script output mode. (small)**
A `SCRIPT_SYSTEM` steering doc answers into beats/timings/delivery notes
when the ask smells like script-writing (or `/script`). Rides the rich doc
card as-is.

**G6 — Video metadata beyond the transcript. (small, optional)**
Duration, views, publish date make "what's working" comparisons honest.
oEmbed gives title/author/thumbnail only; real stats need a YouTube Data
API key (server env, like ANTHROPIC_API_KEY). Ship without; add when a key
exists.

**G7 — Actually watching the video: frames + ASR. (medium — the recipe
exists)**
The reference implementation is `bradautomates/claude-video` (the "/watch"
skill — owner spotted it in the wild, 2026-07-05): give the model FRAMES
plus a timestamped transcript and it genuinely dissects editing style —
cuts, on-screen text, visual pacing. Its recipe, translated to our server:
- `yt-dlp` for captions first (also more robust than our hand-rolled
  `captionTracks` scrape — worth adopting for G1's fetch even alone), and
  for the video download only when frames are needed.
- `ffmpeg` keyframe extraction (`-skip_frame nokey` ≈ 0.5s for a 49-min
  video), duration-aware frame budgets (~30 frames ≤30s … 100 capped),
  and a cheap dedup pass (16×16 grayscale, mean-abs-diff vs last KEPT
  frame) so static footage doesn't bill duplicate images.
- Frames enter the ask as image blocks with `t=MM:SS` markers — our
  pipeline already ships vision inputs (images ride asks today); the work
  is raising MAX_IMAGES for video asks and storing frames as assets on
  the card.
- Whisper (Groq `whisper-large-v3` preferred) only as the caption-less
  fallback — needs a key, mono 16kHz mp3 (~480 kB/min).
Cost shape from their measurements: ~197 tokens/frame at 512px; transcript
often dominates on long videos. Server needs `yt-dlp` + `ffmpeg` installed
(not present in the dev sandbox; standard on a real host). Until this
lands, the badge (G3) keeps us honest about what we can't see.

## 4 · Who does what (the intervention split)

| Step | Human (Maya) | AI (Jarwiz) |
|------|--------------|-------------|
| Collect | picks the references — taste is hers | fetches transcripts, badges readability |
| Analyse | — | per-video profiles + cross-video synthesis, cited to videos |
| Curate | **the key act**: edits/deletes/stickies the voice spec | pills coach the next move |
| Research | approves direction | deep-research pass for topic facts (shipped) |
| Draft | prompt with intent | script in HER curated voice, beat-structured |
| Polish | read-aloud judgment, cut calls | refine-in-place, focus mode |

The design principle: **AI proposes the spec, the human owns the spec.**
Style is identity — Jarwiz must never silently decide what Maya's voice is;
it drafts the hypothesis and makes editing it effortless.

## 5 · Build order

- **Phase A (one session):** G1 + G3, G2's fetch-at-paste-time half.
  Outcome: select videos → ask anything → grounded answers with honest
  badges. This alone beats NotebookLM's video story (it can't research
  around the video; we can).
- **Phase B (one session):** G2 timestamps/budget + G4 style scan.
  Outcome: the writers'-room analysis, per-video + synthesis.
- **Phase C (small):** G5 script mode + pill coaching on profile cards.
- **Phase D (when justified):** G6 stats key, G7 ASR.
