# Deployment — how people try Jarwiz without a terminal

The whole product ships from this repo in two pieces:

| Piece | Where it runs | How it deploys |
| --- | --- | --- |
| The app + landing page | GitHub Pages (free, static) | Automatic — every push to `main` (`.github/workflows/pages.yml`) |
| The agent server | Render free tier (or any Node host) | One-time setup below |

Live site: **https://raagulmanoharan.github.io/Jarwiz-V3/** — "Try it free"
opens the real app (`app/?demo=1`). Boards, uploads under 8 MB, and settings
all live in the visitor's browser (IndexedDB + localStorage); nothing is
stored on our side.

## The three states a visitor can land in

1. **No server configured** — the app runs as an offline playground: full
   canvas, browser persistence, seeded demo board, a quiet pill explaining
   that agents are off.
2. **Server up, no key** — agents answer with the scripted mock ("Demo
   mode"), and the pill offers **Add your API key**.
3. **Key added** — the visitor pastes their own Anthropic API key (key
   button, top right). It's stored **only in their browser** and sent
   per-request as an `x-anthropic-key` header; their key pays for their
   usage. Everything is live: Ask, Analyze, Autopilot, link previews.

## One-time setup: put the agent server on Render (~5 minutes)

1. Go to [render.com](https://render.com) → sign in **with GitHub**.
2. **New → Blueprint** → pick the `Jarwiz-V3` repo. Render reads
   `render.yaml` at the repo root and proposes a `jarwiz-agents` web service
   on the **free** plan. Accept.
3. When it finishes deploying, copy the service URL (looks like
   `https://jarwiz-agents.onrender.com`).
4. In GitHub: repo **Settings → Secrets and variables → Actions →
   Variables → New repository variable**. Name: `JARWIZ_API_BASE`, value:
   that URL.
5. Re-run the "Deploy site to GitHub Pages" workflow (Actions tab → the
   workflow → Run workflow). Done — the hosted app now talks to the server.

Do **not** set `ANTHROPIC_API_KEY` on the Render service: the hosted trial
is deliberately bring-your-own-key, so nobody's bill but the visitor's own is
ever on the line. (Setting it would make the server answer everyone with that
key.)

## Running a closed pilot (invited people, your key, capped spend)

The pilot gives a handful of invitees the **full live experience without
needing their own API key** — your key answers for them, metered so the
worst-case bill is a number you chose in advance.

1. On the Render service (Environment tab), set:
   - `ANTHROPIC_API_KEY` — your key (pilot only; without pilot codes this
     would serve *everyone*, so always pair it with the next line).
   - `JARWIZ_PILOT_CODES` — comma-separated invite codes you make up, one
     per person, e.g. `mira-x7k2,arjun-p3v9`. Memorable-but-unguessable.
   - Optional: `JARWIZ_PILOT_ACTIONS` (AI actions per person, default 100)
     and `JARWIZ_PILOT_TOTAL` (ceiling across everyone, default 1000).
2. Send each person their link:
   `https://raagulmanoharan.github.io/Jarwiz-V3/app/?pilot=mira-x7k2`
   Opening it once saves the invite in their browser; the code disappears
   from the address bar.

What invitees experience: everything live, and a quiet counter beside the
board title ("42 actions left") that updates as they work. Clicking it opens
the boards panel, where a card pinned to the bottom explains the demo's
limits and carries the **Get full Jarwiz access** button (a placeholder for
now — its destination is a product decision still to come). When a budget
runs out, asks answer with a friendly "demo actions used up — thank you for
testing" and the canvas keeps working. There is no key UI anywhere; the
server still honors an `x-anthropic-key` header, so power users with their
own key are possible later without redesign (and are never metered).

Worst-case spend ≈ `JARWIZ_PILOT_TOTAL` × ~3–5¢ per action (~$30–50 at the
defaults). Caveat: counts persist on the free tier's ephemeral disk, so a
redeploy resets them — the global ceiling still bounds each deploy's spend;
bump `JARWIZ_PILOT_TOTAL` down if you redeploy often mid-pilot.

## Beta access signups (the "Request access" bar)

The landing page's email bar POSTs to the agent server's
`POST /api/beta/signup`, which records the address and — when an email
provider is configured — sends the visitor a confirmation. The bar reaches the
server through the same `JARWIZ_API_BASE` repo variable the app uses (the Pages
workflow injects it into the landing page), so once the Render step above is
done, signups already flow.

To turn on the confirmation email, set these on the Render service
(Environment tab; put the key in the dashboard as a **secret**):

- `RESEND_API_KEY` — a [Resend](https://resend.com) API key (free tier is
  plenty for a beta list). No SDK is added; the server calls Resend's REST API.
- `JARWIZ_BETA_FROM` — the verified From address, e.g.
  `Jarwiz <hello@yourdomain.com>`. Resend requires a domain you've verified.
- `JARWIZ_BETA_NOTIFY` *(optional)* — an address to CC on each new signup, so
  you see them land in your own inbox.

Without these, nothing breaks: the address is still recorded (best-effort, on
the free tier's ephemeral disk) and the page shows "you're on the list" instead
of "check your inbox". With no `JARWIZ_API_BASE` at all, the bar falls back to
opening the visitor's mail app addressed to you — nothing is lost either way.

## Free-tier realities (fine for a trial, know them anyway)

- **Cold starts** — the free service sleeps after ~15 min idle; the first
  request wakes it in ~30–60 s. Until the probe succeeds, the app shows the
  playground pill; a reload after the wake-up flips it live.
- **Ephemeral disk** — files uploaded to the server (PDFs, spreadsheets)
  don't survive a redeploy. Images ≤ 8 MB avoid this entirely: with no server
  (state 1) they're inlined into the board in the visitor's browser. A
  persistent disk or R2/S3 is the upgrade path if this ever matters.
- **CORS is open by default** — a keyless BYOK server holds nothing worth
  stealing, but you can pin it to the Pages origin by setting
  `JARWIZ_ALLOWED_ORIGINS=https://raagulmanoharan.github.io` on the service.

## Local development — nothing changed

`npm run dev` still runs web (5173) + server (3001) with the vite proxy;
`ANTHROPIC_API_KEY` in `apps/server/.env` still works exactly as before (a
visitor-supplied key simply wins over it for that one request).
