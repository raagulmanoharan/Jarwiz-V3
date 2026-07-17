# Thesys.dev — Study & Jarwiz Redesign Blueprint

A teardown of [thesys.dev](https://www.thesys.dev/) (captured 2026-07-17,
Chromium @ 1440×900 · 2× DSF) and a concrete plan to raise the Jarwiz marketing
site (`site/index.html`) to that standard. **This is a study + plan only — no
site changes yet.** Screenshots live in `/tmp/thesys/` (`home-sec-00…14`,
`home-full.png`, `company-*`, `startups-*`, `demo-*`).

> Capture note: Chromium couldn't reach the site until we forced **TLS 1.2** —
> the session's egress proxy re-terminates TLS and resets on Chromium's
> oversized TLS 1.3 ClientHello (post-quantum key share + ECH GREASE). `curl`
> worked because its ClientHello is small. Recorded here so the next session
> doesn't re-derive it.

---

## 1. What Thesys is (for framing)

Thesys sells **"Generative UI"** — infrastructure so that AI products respond
with *live interfaces* (charts, forms, dashboards, slides, reports) instead of
walls of text. Three products: **OpenUI Cloud** (the C1 API), **Reports API**
(shareable artifacts), **Agent Builder** (low-code agents). Tagline: *"The
Generative UI Company."*

The strategic overlap with Jarwiz is striking: **both argue that AI's output
should be a rendered artifact, not a text blob.** Thesys sells that as
developer infrastructure; Jarwiz sells it as an end-user canvas. Their homepage
is essentially the argument Jarwiz's "A card is worth a thousand words" section
already makes — so their narrative is directly, unusually transferable.

---

## 2. Content & structure (exact wording)

### Nav
- Left cluster (products): **OpenUI Cloud · Reports API · Agent Builder**
- Right cluster (audience): **Use cases · Resources · Pricing**
- Actions: **Schedule demo** (ghost) · **Sign up** (solid white)
- The two clusters are separated by thin vertical rules — products vs.
  everything-else. Only 6 links + 2 buttons. Deliberately lean.

### Hero
- Eyebrow pill: **"OpenUI Cloud is here. View Docs ›"** (announcement pill,
  links to a launch)
- H1: **"Make AI Apps respond with `Forms`"** — the last word **rotates**
  through `Forms → Charts → Dashboards → Slides → Reports` on a timer.
- Right-column subhead (offset, not centered): *"Thesys provides the
  Generative UI foundation for teams building AI products that go beyond
  text."*
- CTAs: **Try API** (solid) · **Schedule demo** (ghost)
- **Hero centerpiece = a live interactive before/after demo.** A single panel
  split **"AI Apps" | "AI Apps with Generative UI"**: left is plain prose
  ("Across all regions in 2025 (YTD)… R²=0.72…"), right is the *same answer*
  rendered as KPI tiles ($4.42Mn spend, $16.19Mn sales, 501.8% ROI) + a live
  bar chart. Below it a real prompt bar — *"Tell me about the correlation
  between our Ad spends and sales"* — and tabs **Charts · Cards · Dashboards ·
  Slides · Reports** that re-render the panel. This *is* the product, running,
  as the hero.

### Trust strip
- **"Trusted by the best AI-native teams"** + logo row. Logos captured:
  Ficells Labs, agent, Entelligence AI, Pointlabs, Chicago Global (DOM alts
  also list numero, payflow, sentisum, gradientflo — it's a rotating set).
- **"Read customer stories →"**

### "Introducing OpenUI" — the framework band
- H1: **"Introducing OpenUI"** / **"The state-of-the-art Generative UI
  framework, powering every Thesys product"**
- Live counters: **185,627 / month** (npm) · **8,065** (GitHub stars)
- Three product cards: **OpenUI [Cloud]** — "Production-ready generative UI";
  **Reports [API]** — "Automate reporting in AI products"; **Agent Builder** —
  "Low-code tool to build & deploy agents"
- **Six stat/benefit tiles** (this is their proof grid):
  - **3x faster renders** — "Compared to JSON renderers."
  - **67% fewer tokens** — "Compared to JSON-based UI generation."
  - **Compliance ready** — "Built for GDPR, SOC 2, and ISO 27001." (+ badges)
  - **Enterprise ready** — "Zero data retention, private deployment and more"
  - **Preferred by 83% of users** — "Compared to text-in, text-out AI."
  - **Build 10x faster** — "Drastically reduce time to market."

### Product section 1 — OpenUI Cloud (`Formerly C1 API`)
- H2: **"Make LLMs respond with production ready UI instead of plain text"**
- Sub: *"With OpenUI Cloud, turn model output into live charts, forms, cards,
  tables, dashboards, and workflows inside your app."*
- CTAs: Try API · Learn more
- Product mock: a dashboard (active users 148,320 +12.4%, retention curve,
  region donut) beside a **code snippet** (`const client = new OpenAI({ baseURL:
  'https://api.thesys.dev/v1/embed' })`) — shows "drop-in, OpenAI-compatible."
- Four feature cards: **Works with every stack** · **Handles errors &
  corrections** · **Bring your design system** · **Generates responsive UI**
- Customer proof line: *"Entelligence shipped Ask Ellie with Generative UI to
  help developers understand complex codebases faster."*

### Product section 2 — Reports API
- H2: **"Turn conversations and data into Shareable Artifacts"**
- Sub: *"Generate reports, dashboards, and presentations directly from
  conversations, files, and data. Users can create, stream, edit, and export
  artifacts seamlessly inside your product."*
- Product mock: a generated **company report** (23 offices, 1,456 employees,
  $157.2Mn revenue, numbered insight rows).
- Four feature cards: **Generate polished artifacts** · **Iterate
  conversationally** · **Customize to your brand** · **Download editable
  outputs** (PDF/PPT).
- Proof line: *"WisdomAI uses the Artifacts API to create shareable reports
  with enterprise-ready insights."*

### Product section 3 — Agent Builder
- H2: **"Launch AI agents that actually get work done"**
- Sub: *"Connect files, databases, websites, tools, and apps, then deploy
  agents that answer with charts, forms, reports, slides, and interactive UI."*
- CTA: **Build now**
- Product mock: the Agent Builder console (model picker `claude-3.5-sonnet`,
  instructions, Tools +2k Apps, a live "Compare Hamilton and Verstappen" agent
  rendering rich comparison cards).
- Four feature cards: **Agentic reasoning** · **Connect your data** ·
  **Interactive insights** · **Deploy anywhere**
- Proof line: *"Chicago Global is building agents with Generative UI that make
  financial market data easier to understand."*

### "Built for every use case" — accordion
- H2 + sub: *"Thesys helps your AI products turn responses into interfaces
  users can explore, share, and act on."*
- Vertical accordion, each row expands to a live UI preview:
  **AI Analytics Agent** · **AI Knowledge Search** · **Customer Support
  Agents** · **Personalized Dashboards** · **AI Reporting Agents**. (e.g.
  Customer Support expands to a real "I was charged twice" support form with
  Order number + payment-method chips + Submit.)

### FAQ
- H2: **"Frequently asked questions"** + *"If you can't find answers… join our
  Discord or mail us."*
- Q: How can I add Generative UI to my product? / automate report generation? /
  try without code? / work with my existing AI stack? / get started? / use my
  own design system? (accordion, first one open.)

### Closing CTA
- H2: **"Build AI-native experiences with Generative UI"**
- CTAs: **Try API** · **Try Agent Builder**

### "Ask your favourite AI" band (pre-footer — distinctive)
- **"Want to know more? Ask your favourite AI."** with buttons **Ask ChatGPT ·
  Ask Gemini · Ask Claude** (deep-links a pre-filled prompt about Thesys into
  each assistant). A very 2026, on-brand touch.

### Footer
- Product Hunt badges + **GDPR / ISO 27001 / SOC 2** compliance seals.
- Six columns: **Company** (Blogs, About, Careers, Contact us, Trust Center) ·
  **For Developers** (GitHub, API Status, Documentation, Join community) ·
  **Product** (OpenUI Cloud, Reports API, Agent Builder, Pricing) ·
  **Resources** (Startups, Enterprise, Partnership Program, Customers) ·
  **Legal** (DPA, Terms of use, Privacy policy, Terms of service) ·
  **Integrations** (n8n).
- Wordmark + **"The Generative UI Company"** · © 2026 Thesys Inc. · social (X,
  Discord, YouTube, LinkedIn) · 355 Bryant St, San Francisco, CA 94107.

### Subpages
- **/startups** — "Thesys for startups" (green "Startup Program" pill), *"…ship
  AI apps faster with free credits, priority support, and hands-on resources."*
  → **Apply now**. "Why apply for startup program?"
- **/company** — mission manifesto: *"We believe the future of human-computer
  interaction lies in **Generative UI**… It's not just improved functionality,
  it's about unlocking the true potential of AI."* / *"Our mission is to empower
  teams… transforming rigid, traditional interfaces into dynamic, personalized
  experiences."* Closes: **"We're building the interface for AI."**
- **/examples → demo.thesys.dev** — a **light-themed** demos launcher ("Demos by
  Thesys"): Analytics Co-pilot, Search, Chat, Compare, + a Playground/Agent
  Builder tool card. The one place the site flips to light — signalling "you're
  now in the product."

---

## 3. Deep analysis

### 3.1 Narrative arc (why it converts)
1. **Show, don't tell (hero).** No "AI platform for…" abstraction — the very
   first thing is the product doing its trick, live, as a before/after. The
   reader *gets it* in one glance: text-blob → interface.
2. **Name the enemy.** "instead of plain text", "beyond text", "text-in,
   text-out". A crisp villain (the chatbot text box) the whole page pushes
   against.
3. **Credibility injection early.** Logos + npm/GitHub counters + "3x / 67% /
   83% / 10x" proof grid, before deep explanation — earns the right to keep
   talking.
4. **Three products, one grammar.** OpenUI / Reports / Agent Builder each get
   the *identical* rhythm: H2 promise → offset subhead → live product mock →
   four feature cards → one real customer proof line. Repetition makes a broad
   platform feel legible instead of sprawling.
5. **"For every use case."** Widens from "what it is" to "what you'd build" —
   an accordion of live previews lets the reader self-identify.
6. **De-risk (FAQ) → convert (CTA) → concede the exit (Ask AI band).** Handles
   objections, then a clean dual CTA, then the witty "ask ChatGPT/Gemini/Claude"
   band that meets skeptics where they'll go anyway.

The engine: **every claim is immediately shown as working UI.** The page never
asks you to imagine the product — it renders it.

### 3.2 Structure (reusable outline)
```
Nav (products | audience | demo · signup)
Hero  ── rotating headline + offset subhead + 2 CTAs + LIVE interactive demo
Trust ── "Trusted by…" logos + "Read customer stories"
Framework band ── "Introducing X" + live counters + 3 product cards + 6 proof tiles
Product 1 ── promise H2 · subhead · live mock · 4 feature cards · customer proof
Product 2 ── (same rhythm)
Product 3 ── (same rhythm)
Use cases ── accordion of live previews
FAQ ── accordion
Closing CTA ── one line + dual CTA
"Ask your favourite AI" band
Footer ── compliance seals + 6 link columns + address/social
```
The **repeated product-section rhythm** is the most stealable structural idea.

### 3.3 Visual system (measured)
- **Palette (chrome is pure monochrome):**
  - Background **`#000000`** pure black (Jarwiz uses `#09090b`).
  - Text primary **`#ffffff`**; muted = **white @ 50%** (`rgba(255,255,255,.5)`)
    — they lean on *opacity*, not a separate grey token.
  - Cards **`#121212`**, hairline border **`rgba(255,255,255,.06)`**.
  - Primary button: **white bg / black text**, radius **100px** (full pill).
- **Colour appears ONLY inside product UI, never in the chrome:** chart bars in
  blue/indigo (~`#3B82F6`/`#818CF8`), green sparklines/retention (~`#22C55E`),
  an amber "Submit" (~`#E8C468`), a green "Startup Program" pill. The marketing
  frame stays black-and-white so the *rendered product* supplies all the color.
  This is the single biggest craft lesson.
- **Type:** **Inter Display** for headings, **Inter** for body (same family
  Jarwiz uses). Crucially, **H1 is weight 500 (medium), 60px, line-height 1.25,
  normal letter-spacing** — restrained and editorial. **No gradient text, no
  800 weight, no tight −0.04em tracking.** Body 18px / 1.5, muted. The whole
  site feels calm and confident because the type isn't shouting.
- **Spacing/grid:** very generous vertical rhythm; big black gutters; product
  mocks sit in large rounded-2xl panels that often **bleed off the right edge**
  (a peek-into-the-product device Jarwiz *already* uses in its bento).
- **Dark/light:** marketing site is committed dark; the **demo app flips to
  light** — a deliberate "you've entered the product" cue.
- **Motion/interaction:** (a) rotating hero word; (b) the hero demo is genuinely
  interactive (prompt bar + tabs re-render); (c) accordions with live UI
  previews; (d) live npm/GitHub counters; (e) restrained scroll reveals. Motion
  always demonstrates the product, never decorates.
- **The demo as centerpiece:** the hero is not a screenshot or looping video —
  it's the *actual* generative-UI output, interactive, above the fold. The
  entire page is then a series of "here it is doing X" panels.

### 3.4 Transferable vs. Thesys-specific
**Transferable to Jarwiz (adopt):**
- Hero = live product doing its trick (Jarwiz already embeds `app/?embed=1` —
  lean into it harder as *the* proof, with a before/after framing).
- The **before/after "text vs. rendered UI"** device — Jarwiz's "A card is
  worth a thousand words" is the same idea; make it the hero, not section 2.
- **Restrained editorial type** (medium weight, no gradient fills) — a big,
  cheap upgrade in perceived quality.
- **Colour only inside the cards/product, monochrome chrome** — Jarwiz is
  already mostly monochrome; go all the way and let the *agent identity hues*
  (blue/amber/pink/green) live only inside cards, exactly as VISION.md intends.
- **Repeated section rhythm** (promise → live mock → feature cards → proof).
- **Proof grid** of hard numbers/benefits.
- **Use-case accordion** with live previews (Jarwiz's `?usecases=1` board is
  perfect raw material).
- **Compliance/trust seals + real counters** (Jarwiz has the live GitHub star
  button already).
- **"Ask ChatGPT/Gemini/Claude" band** — witty, cheap, on-brand for an AI tool.

**Thesys-specific (do NOT copy):**
- Developer/API framing (`baseURL`, npm installs, "OpenAI-compatible") — Jarwiz
  is end-user, not infra. Keep code out.
- Three-product architecture — Jarwiz is one canvas; don't manufacture products.
- Enterprise-heavy proof (GDPR/SOC2/ISO, "zero data retention") — Jarwiz is a
  private beta; trust cues should be beta/craft/founder-signal, not compliance.
- Pure `#000` + white-only: Jarwiz's warm identity (the app's paper canvas
  `#f5eee2`, agent hues) is a *differentiator* — keep a warmer near-black and
  let the hues breathe inside cards rather than going clinical monochrome.

---

## 4. Redesign plan for `site/index.html`

Jarwiz's site is already good and shares Thesys's DNA (monochrome, Inter, live
embed, versus-panel, bento, use-case board). This is **elevation, not a
teardown** — reorder for a stronger arc, calm the type, and let the live
product carry more weight.

### 4.1 Proposed section order (before → after)
| # | Today | Proposed |
|---|---|---|
| 1 | Hero: headline + email capture + live `app` embed | **Hero**: rotating headline + subhead + CTA, **before/after "text vs. board" as the hero centerpiece** (promote today's §2), live embed directly under it |
| 2 | Wedge: "A card is worth a thousand words" (chat vs doc) | folded **into** the hero as the before/after |
| 3 | Bento: "right shape for every answer" | **Capability band**: keep the bento, add a **proof grid** (numbers/benefits) above it |
| 4 | Features (6 machines) | **How it works** (3 steps: describe → Jarwiz shapes it → keep/connect on the board) — new, mirrors Thesys's legibility |
| 5 | Use cases (`?usecases=1`) | **Use-case accordion** with live previews (reuse the board), each row self-identifying |
| 6 | Access (beta) | **Features** (the 6 "machines") as a calm grid |
| 7 | Footer | **Closing CTA** → **"Ask ChatGPT/Gemini/Claude about Jarwiz" band** → **fuller footer** |

### 4.2 The Jarwiz narrative, in this structure
1. **Hero — show the board thinking.** Headline stays in the "canvas, not a
   chat box" family; rotate the last word through the shapes Jarwiz makes
   (*a doc · a table · a diagram · a prototype · a dashboard · a board*) — the
   exact move Thesys uses. Under it, the **before/after**: a chatbot's wall of
   text vs. the Jarwiz card, side by side (today's wedge, promoted). Then the
   live embed. First screenful = the whole thesis, shown.
2. **Name the enemy.** Keep "not a chat box" / "instead of scrolling back
   through a thread" as the running foil.
3. **Proof early.** A grid of Jarwiz-true numbers/benefits (e.g. *"6 shapes,
   one canvas" · "0→finished artifact" · "every card stays live" · "cites its
   sources"*) — honest, not fabricated enterprise stats.
4. **Capability (bento).** Keep the beautiful bento; it's already best-in-class
   and on-thesis. Frame it with the repeated rhythm.
5. **How it works (3 steps).** Add the legibility beat Thesys has and Jarwiz
   lacks: describe → shape → connect. Uses `docs/VISION.md`'s golden path.
6. **Use-case accordion.** Convert the use-case board into an accordion of live
   previews (product / research / trip / talk / decision) so visitors
   self-identify — richer than one shared iframe.
7. **Features grid** (the machines) — calm, monochrome, one proof line each.
8. **Closing CTA + "Ask your favourite AI" band + footer.** Adopt the Ask-AI
   band verbatim in spirit (it's perfect for Jarwiz). Expand the footer toward
   Thesys's structure (Product / Resources / Company / Legal) as the site grows.

### 4.3 Specific visual changes (tokens & CSS)
Target: `site/index.html` `:root` (self-contained) — mirror into
`apps/web/src/styles/tokens.css` only if we want app parity.

- **Calm the headline type.** Today `h1` is `font-weight:800`, gradient fill,
  `letter-spacing:-0.04em`. Move toward Thesys's editorial restraint:
  - `h1` weight **600–650** (not 800), letter-spacing **−0.02em** (not −0.04),
    line-height ~**1.05–1.1**.
  - **Drop the gradient text fill** on `h1 .grad` (or reserve it for one hero
    word only). Solid `--ink` reads more premium.
  - Consider **Inter Display / Inter Tight** for headings to match their
    editorial feel (optional; Inter already loaded).
- **Muted text via opacity.** Introduce `--ink-2: rgba(245,245,247,.62)` /
  `--ink-3: rgba(245,245,247,.42)` (opacity-based) so muted copy sits on any
  card without a fixed grey — matches Thesys and is more robust.
- **Keep Jarwiz warmth (deliberate divergence).** Do **not** go pure `#000`.
  Keep `--bg:#09090b`; it's warmer and on-brand. The differentiator vs Thesys
  is that **Jarwiz's agent hues (blue/amber/pink/green) live inside the cards**
  — currently the site is all-white-accent. Reintroduce the identity hues as
  **card accents / connection lines only** (never in the chrome), per
  VISION.md. This is Jarwiz's answer to "colour only in the product."
- **Pills already match** (radius 999px, white primary / ghost). Keep.
- **Card system:** nudge card bg toward Thesys's flatter `#121212`-ish with
  `rgba(255,255,255,.06)` hairlines for a cleaner, less gradient-heavy look on
  the feature/step cards (the bento can keep its richer treatment).
- **Add the rotating hero word** (JS, honors `prefers-reduced-motion`) — small,
  high-impact, and Jarwiz already has the typed-caret machinery in the composer
  card to reuse.
- **Proof grid + How-it-works + accordion** are new components; build them with
  existing tokens (`--r-md`, `--hairline`, `--ink-*`) — no new primitives.

### 4.4 What to explicitly NOT do
- No code snippets / API framing / npm counters (wrong audience).
- No manufactured products or enterprise-compliance theatre.
- Don't flatten Jarwiz to clinical pure-monochrome — keep the warm base and let
  agent hues live in the cards. That's the intentional point of difference.

---

## 5. Recommendation / next step
Biggest wins, in order: **(1)** promote the before/after "text vs. board" into
the hero and let the live embed carry the proof; **(2)** calm the headline type
(drop gradient/800 weight); **(3)** reintroduce agent-identity hues *inside
cards only*; **(4)** add the proof grid + 3-step "how it works" for legibility;
**(5)** the "Ask ChatGPT/Gemini/Claude" band. Items 2–3 are near-free and lift
perceived quality immediately.

**Awaiting direction before touching `site/index.html`.**
