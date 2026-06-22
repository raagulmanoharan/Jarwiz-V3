# Glossary

One-sentence definitions of every Jarwiz-specific concept. Read this before diving into the codebase; these are the words we use daily that mean nothing to someone new.

---

**affinity clustering** — A specific ask output shape where sticky notes are automatically sorted into labelled theme columns; produced when the prompt asks to "cluster & summarise" a selection of notes.

**agent** — One of the four named AI collaborators (Researcher, Summarizer, Brainstormer, Writer) that run on the server, emit events over SSE, and place artifacts directly on the canvas rather than returning chat replies.

**AgentEvent** — The typed server-sent event union that drives all agent-to-canvas communication; variants include `status`, `cursor`, `card.create`, `card.delta`, `card.done`, `edge.create`, `done`, and `error`.

**AgentRunRequest** — The payload sent from the client to `/api/agents/:id/run`: a source card, optional selection cards for context, a placement hint (x, y), and an optional brief (steering instruction from the user).

**artifact** — Anything an agent places on the canvas during a run — a doc card, a cluster of notes, a table, or a link card; the output is always a shape in tldraw, not a message in a chat window.

**ask** — The general-purpose prompt pipeline (`/api/ask`) that handles freeform questions typed into the prompt bar; distinct from an agent run in that it handles clarification, affinity, table, and diagram output shapes and is grounded to selected cards.

**AskEvent** — The typed SSE event union for the `/api/ask` pipeline; includes `clarify`, `card.create`, `card.delta`, `card.title`, `table.cell`, `affinity.cluster`, `affinity.note`, `card.done`, `done`, and `error`.

**AskShape** — The output shape the ask pipeline will produce for a given prompt: one of `doc`, `table`, `list`, `diagram`, or `affinity`; chosen by the model before streaming begins.

**based on** — The "Based on" button in the card action bar that reveals which source cards contributed to a given artifact, rendering the provenance edge into a readable attribution list.

**begin_card / finish_card** — The two canvas tools (used by agent system prompts) that open and close a streaming doc or note card; text the model emits between them is streamed live to the canvas via `card.delta` events.

**board** — A named workspace backed by its own tldraw persistence key; boards are stored in localStorage and IndexedDB, with metadata (name, id, `isNew` flag) kept in `jz-boards-v1`.

**BoardEntry** — The new-board onboarding dialog shown when a board's `isNew` flag is true; collects a name and optional starting template, then marks the board as used.

**brief** — An optional plain-English steering instruction appended to an agent run request that adjusts tone, focus, or length without changing the agent's core behavior; surfaced as a text box when summoning an agent.

**buildUserTurn** — The per-agent function that serializes the current canvas context (source card, selection, placement hint) into a volatile user-turn message sent to Claude on each run; the system prompt is frozen separately for prompt caching.

**calm by default** — A design principle meaning Jarwiz never shows unsolicited panels, badges, or animations that aren't directly triggered by user action or an agent event; the canvas should feel like a quiet room that springs to life when work is happening.

**canvas tool** — Any of the six tools Claude can invoke during an agent run to place artifacts: `begin_card`, `finish_card`, `create_link_card`, `create_note`, `create_table`, `connect_cards`; the runtime executes them by emitting `AgentEvent`s, not by calling the API.

**card** — A Jarwiz shape placed on the tldraw canvas; one of eight types: `link-card`, `youtube-card`, `image-card`, `pdf-card`, `note-card`, `doc-card`, `table-card`, `diagram-card`.

**card.delta** — The SSE event that carries an incremental text chunk from the model during a streaming agent run; applied by the client in real time to update a doc or note card's body.

**CardKind** — The string enum describing a card's content type as understood by agents: `'link' | 'youtube' | 'image' | 'pdf' | 'note' | 'doc' | 'table'`; maps to (but is not identical to) the tldraw shape type.

**clarify** — A mid-run SSE event from the ask pipeline that surfaces an ambiguity to the user as a multiple-choice question before streaming begins; the user picks an option and the run continues.

**cluster** — See *affinity clustering*.

**connect_cards** — The canvas tool that creates a directed provenance arrow (tldraw arrow shape) from one card to another; color-coded by agent identity and optionally labeled (e.g. "drawn from", "idea", "source").

**coachmark** — A small dismissible prompt that appears in the prompt bar area after a board has accumulated ≥5 cards, suggesting the user try the agent board-scan features.

**cursor event** — An `AgentEvent` of type `cursor` that carries `{x, y}` page-space coordinates, causing the agent's avatar to glide to that position on the canvas during a run.

**demo mode** — The fallback state when no `ANTHROPIC_API_KEY` is configured on the server; agent runs execute a scripted mock loop that emits the same `AgentEvent` shapes as a real run but with pre-written content; indicated by a "Demo mode" badge in the topbar.

**discuss** — A conversational refinement mode available on doc cards via the "💬 Discuss" action; opens a threaded exchange that can rewrite the card in place.

**doc card (`doc-card`)** — A markdown-capable canvas card used for longer-form agent output; has a title (Fraunces serif) and a body that supports streaming via `card.delta`.

**DocCardShapeUtil** — The tldraw shape util that renders and manages `doc-card` shapes, including the live streaming caret during agent runs.

**draft** — The unconfirmed state of an ask response; the new card(s) exist on the canvas but are visually marked as pending until the user accepts ("✓") or discards ("✗") them.

**empty state** — The decorative overlay shown on a non-new board that has zero shapes; displays a hero line ("Start a new idea.") and affordance hints; hidden on brand-new boards (BoardEntry handles those).

**grounding** — Providing one or more canvas cards as context for a prompt; the selected cards are serialized and included in the user turn, so the model's answer is anchored to their content rather than generated from scratch.

**idMap** — The client-side `Map<string, TLShapeId>` maintained during an agent run that translates the server's short ids (e.g. `"card_1"`) to real tldraw shape ids; necessary because tldraw generates UUIDs internally.

**ingestion** — The flow for bringing external content onto the canvas; currently handles PDF files (drag-and-drop or paste) by uploading to the server, creating a `pdf-card`, and resolving the asset URL.

**isNew** — A boolean flag on a `Board` object that is `true` until the user completes or dismisses the BoardEntry onboarding dialog; used to suppress the empty state overlay and to gate the first-run tour auto-launch.

**iteration cap** — The per-run hard limit of 12 tool-use iterations in the agent runtime, preventing runaway loops and controlling cost.

**jz- prefix** — The CSS class namespace for all Jarwiz-specific styles; every component class starts with `jz-` (e.g. `jz-topbar`, `jz-card-chip`). Never use unprefixed classes that could collide with tldraw's internals.

**link card (`link-card`)** — A canvas card that displays a URL preview with title, description, favicon, and Open Graph image; created by the Researcher agent via `create_link_card`.

**mock loop** — The server-side scripted demo path (`apps/server/src/agents/mock.ts`) that emits the same `AgentEvent` shapes as a real Anthropic tool-use loop, but with hardcoded content per agent; runs when no API key is present.

**note card (`note-card`)** — A compact sticky-note card used for Brainstormer output and quick user notes; holds plain text, color-coded by affinity cluster in clustering mode.

**onboarding dialog** — See *BoardEntry*.

**persistence key** — The tldraw string identifier used to isolate a board's IndexedDB storage; first board uses the legacy key `jarwiz-pdf-v2`; subsequent boards use `jz-tldraw-{id}`.

**placement hint** — The `{x, y}` coordinate pair sent to an agent in the user turn, computed client-side as the nearest free space to the right of the source card; tells the agent where to start placing artifacts without overlapping existing content.

**presence** — The real-time visual indicators that show which agents are active: Figma-style avatar chips in the dock, cursor glides on the canvas, status messages ("Searching…", "Writing…"), and the live streaming caret inside an open doc card.

**prompt bar** — The fixed input strip at the bottom of the canvas where the user types freeform questions, sees grounding chips for selected cards, and accesses the agent board-scan menu.

**prompt caching** — The Anthropic API feature used to reduce cost and latency for agent runs; each agent's frozen system prompt gets `cache_control: { type: 'ephemeral' }` so Claude doesn't re-process it on repeated calls.

**provenance** — The traceable link between an artifact and the source cards that generated it; rendered on the canvas as a directed arrow, and surfaced in the UI as the "Based on" action.

**RunCard** — The serialized representation of a tldraw shape sent to the server: `{ cardId, kind, x, y, w, h, url?, title?, text? }`; the canonical format by which canvas state is communicated to agents.

**seed card** — The primary selected card that an agent run is initiated from; appears as the `source` field in `AgentRunRequest`; agents connect their output artifacts back to the seed via `connect_cards`.

**selection ask** — The "✦ Ask about this passage" affordance that appears when text is selected inside a PDF card; runs the ask pipeline grounded to the highlighted passage with automatic citation.

**server tool** — An Anthropic API tool available to specific agents for reaching outside the canvas: `web_search_20260209` (Researcher) and `web_fetch_20260209` (Researcher, Summarizer, Writer). Brainstormer has none.

**sidecar** — A local Claude CLI process the server can delegate agent runs to when no API key is configured but `claude` is available in the PATH; allows real (not mock) responses without a cloud key.

**streaming caret** — The blinking cursor rendered inside a doc or note card while an agent is writing into it; driven by the `streaming.ts` external store, which tracks which card id is actively receiving `card.delta` events.

**table card (`table-card`)** — A canvas card that renders a structured grid with column headers; produced when the ask pipeline or an explicit "As a table" transform chooses the `table` output shape.

**token ceiling** — The per-run `maxTokens` limit (16,000) set in the agent runtime to control cost and prevent unbounded generation.

**topbar** — The fixed top-left chrome strip containing the Jarwiz wordmark, the active board chip (opens BoardSwitcher), the Demo mode badge (when live is false), and the help "?" button.

**tour** — The 8-step guided walkthrough auto-launched once for first-time users (after BoardEntry resolves); replayable via "Take the guided tour" in the help panel; managed by the `help.ts` store.

**wire protocol** — The typed SSE event format defined in `packages/shared/src/protocol.ts`; consumed by both the web client and any external integrations. Changing the protocol requires rebuilding `packages/shared`.

**workspace** — Synonym for *board* in user-facing copy; "My workspace" is the default name for the first board.
