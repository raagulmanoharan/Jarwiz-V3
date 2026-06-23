# WORKFLOW.md — how we build Jarwiz

A practical playbook for a UX designer (Raagul) building Jarwiz into a
world-class product with Claude as the engineering partner. **Read this
end-to-end once.** After that, the cheat sheet at the top is enough day-to-day.

> If you're Claude reading this in a fresh session: this file is the source of
> truth. Don't invent new conventions. If something here is wrong, propose a
> change to this doc rather than going around it.

---

## TL;DR cheat sheet

| You want to… | You say to Claude | What happens |
|---|---|---|
| Start a new feature | "Let's build [thing]" | Claude creates a branch like `feat/<short-name>`, switches to it, and starts work. |
| See where I am | "Where am I?" | Claude shows you the branch, what's different from `main`, and what's uncommitted. |
| Try something risky without losing my place | "Spin up a worktree to try [X]" | Claude opens a parallel working copy in `~/jarwiz-worktrees/<name>` so the main canvas stays untouched. |
| Save progress | "Save this" | Typecheck → commit → push. One commit, descriptive message. |
| Ship to PR | "Open a PR for this" | Claude rebases on `main`, pushes, opens a **draft** PR with a screenshot. |
| Merge to main | "Merge it" | Claude verifies CI/typecheck is green, then merges via the PR. |
| I broke something | "Something's wrong" | Claude diagnoses; if you want to bail, "discard my changes" → Claude confirms what will be lost, then resets. |
| Deploy to prod | "Deploy" | Not wired up yet — see [Production](#production) below. |

---

## The mental model

Think of Git like Figma version history, but more powerful and more strict:

- **Branch** = a named copy of the project. `main` is the published version.
  Every other branch is a draft.
- **Commit** = "Save As" with a label. You can rewind to any commit.
- **Push** = upload your draft to GitHub so it's backed up + reviewable.
- **Pull Request (PR)** = "Ready for review/merge." A page on GitHub that shows
  the diff between your branch and `main`.
- **Merge** = your draft becomes part of `main`. The published version updates.
- **Worktree** = a second working folder on disk pointing at a different branch.
  Like having two Figma files open side-by-side, but they share the same
  history.

You never need to memorize git commands. Claude runs them. Your job is to
**name what you want** and **decide when to merge.**

---

## The branch-per-feature rule

**One feature = one branch = one PR.** Always. Even when it feels like
overkill.

Why this matters more than it seems:
- If you mess up, you can throw away one branch without losing the others.
- Each feature gets reviewed (by you, reading the diff) before it joins `main`.
- If two features turn out to conflict, you discover it at merge time, not
  five features deep.
- Future-you, reading `git log` six months from now, sees a clean story.

### Branch naming (Claude picks these — you don't have to)

| Prefix | Used for | Example |
|---|---|---|
| `feat/` | New feature or visible UI | `feat/clarify-panel-redesign` |
| `fix/` | Bug fix | `fix/agent-cursor-flicker` |
| `polish/` | Tweaks, copy, spacing, motion | `polish/topbar-hover-states` |
| `docs/` | Docs-only changes | `docs/update-roadmap` |
| `experiment/` | Throwaway try-it-out (often deleted) | `experiment/voice-input` |
| `chore/` | Tooling, deps, config | `chore/upgrade-tldraw` |

### The default loop

1. **Start clean on main:**
   ```
   You: "Let's build a redesigned Clarify panel."
   Claude: switches to main → pulls latest → creates feat/clarify-panel-redesign
           → switches to it → ready.
   ```
2. **Build in small chunks.** Every meaningful step ends with a commit. A good
   commit is a thought you'd put on a sticky note: "Add Clarify panel skeleton",
   "Wire up first-question field", "Style step indicator."
3. **Push often.** Each push is a backup. If your laptop dies you lose nothing
   that's pushed.
4. **Open a draft PR early.** PRs are not "I'm done." They're "here's a place
   to see what I'm doing." Draft = not ready to merge. Mark "Ready for review"
   only when you actually want it merged.
5. **Merge when it's good.** Squash-merge keeps `main`'s history clean: the
   whole feature shows up as one commit with the PR title.
6. **Delete the branch.** Claude does this automatically after merge. The work
   lives in `main` now.

---

## When to use a worktree

A **worktree** is a second working folder on the same repo. Use one when:

- You want to try something risky **without disrupting** your current work.
- You want to compare two designs side-by-side in two browser tabs.
- A reviewer asks "what about [other approach]?" and you want to spike it
  without throwing away your current branch.
- You're mid-feature and a hot fix needs to ship from `main` *now*.

You probably **don't** need a worktree for normal feature work — just commit
your current branch and switch with `git switch`. Worktrees are for when you
need *both at once*.

### How to use one (you say, Claude does)

```
You: "Spin up a worktree from main called 'try-spotlight-summon' so I can
      try a different summon UI without losing what I have."

Claude: creates ~/jarwiz-worktrees/try-spotlight-summon, branch
        experiment/try-spotlight-summon, runs npm install if needed,
        starts a second dev server on ports 5174 / 3002 if your main is
        running. Tells you which folder + URL.
```

When you're done:

```
You: "Throw away the spotlight worktree."
Claude: confirms which one, removes the folder, deletes the branch.
```

If the experiment was good, instead say "Merge the spotlight worktree into my
feature branch."

### Worktree house rules

- **Never run two worktrees of `main` at once.** They can't both push without
  fighting. Use feature branches in worktrees.
- **Each worktree is a separate `node_modules`.** First start in a fresh
  worktree needs `npm install`. Claude handles this.
- **Dev ports collide.** If the main session is on 5173/3001, a parallel
  worktree must use different ports (Claude sets these).

---

## Commit hygiene (Claude's job, but you should know)

Every commit Claude makes should:
- ✅ Compile (`npm run typecheck` passes)
- ✅ Build (`npm run build` passes)
- ✅ Have a single-thought message: imperative, lowercase-ish, no period:
  - Good: `add clarify panel skeleton`
  - Good: `fix agent cursor flicker after card delete`
  - Bad: `WIP`, `stuff`, `final final v2`
- ❌ Never `--no-verify`. If a pre-commit hook fails, fix the underlying issue.

If Claude is about to commit something that doesn't typecheck, **stop it** —
that's a bug in the workflow.

---

## The "I broke something" recovery menu

In order of how much you lose:

| You say… | What happens | What's lost |
|---|---|---|
| "Undo my last save (commit)" | Soft reset: changes stay in the working dir, just unstaged. | Nothing real. |
| "Throw away my unsaved changes" | Hard discard of uncommitted edits. **Claude confirms first.** | Everything since the last commit. |
| "Roll this branch back to [point]" | Reset to a specific commit. **Claude confirms first.** | Everything after that commit on this branch. |
| "Nuke this branch and start over" | Delete branch + start fresh from main. **Claude confirms first.** | The whole branch's work, if not merged. |
| "Restore [file] to how it was on main" | Checkout one file from `main`. | Just that file's changes. |

**Claude's safety rules:**
- Never run `git push --force`, `git reset --hard`, `git branch -D`, or
  `git clean -fd` without explaining in plain English what will be lost and
  getting a "yes."
- If your uncommitted work would be destroyed, stash it first ("save a backup")
  before the destructive op.

---

## Testing (what we have, what we don't)

Honest state of testing in Jarwiz right now:

- **No automated test suite.** No Jest, no Vitest, no Playwright e2e in CI.
- **Typecheck is the main net.** `npm run typecheck` catches a surprising
  amount of "did I break the wire protocol?" issues.
- **Build is the second net.** `npm run build` catches Vite/bundling issues.
- **Manual UI testing is the third net.** Open the canvas, do the thing,
  check it works.

So when Claude says "this is done":

1. **Typecheck + build green** — required. No exceptions.
2. **Manual flow walkthrough** — Claude lists the exact clicks for you to
   verify. You do them in the browser.
3. **Screenshot if visible** — Claude grabs a screenshot via `scripts/screens.mjs`
   for the PR. (Sandbox-flaky — Claude will say if it failed.)

**Future:** When we add critical flows (multi-user sync, agent run lifecycle),
add Playwright e2e tests for *just* those flows. Not aiming for 80% coverage
— aiming for "the 3 user journeys can never silently break."

---

## Reviewing your own PRs (the secret weapon)

Before merging, **read the diff on GitHub** like you'd review a Figma file
before shipping it:

- Does every file change make sense?
- Any leftover `console.log`, `TODO`, dead code?
- The PR title — would future-you understand what shipped?
- The screenshot — does it match what you intended?

If anything's off, you say "Claude, in this PR, [the X thing] looks wrong —
fix it." Claude pushes a follow-up commit to the same branch.

---

## Documentation as a habit

Three documents pay rent every session:

1. **`docs/ROADMAP.md`** — the plan. Updated when scope changes.
2. **`docs/HISTORY.md`** — what happened. Appended at the end of each feature
   while context is fresh. Claude writes this; you skim it.
3. **`docs/DECISIONS.md`** — *why* we chose X over Y. Append when a
   non-obvious tradeoff happens (e.g. "kept tldraw 5.1 instead of upgrading
   because Y").

If Claude finishes a feature and didn't update at least HISTORY, you can say
"add a history note for what we just did."

---

## Production <a id="production"></a>

**Today, Jarwiz only runs on your laptop.** There is no production deploy.

When you're ready to put it on the internet (signed-in beta with real users),
the rough plan — *plan, not done* — is:

1. **Pick a host:**
   - `apps/web` (the canvas) → Vercel or Cloudflare Pages (static + edge).
   - `apps/server` (the agent runtime) → Fly.io, Render, or Railway (long-
     lived Node process, supports SSE).
2. **Environment split:**
   - `main` branch → auto-deploy to a **staging** URL (e.g.
     `staging.jarwiz.app`). Every PR also gets a preview URL.
   - A `production` tag (or `prod` branch) → deploy to the **live** URL.
3. **Secrets:**
   - `ANTHROPIC_API_KEY` lives only on the server host, never in code.
   - Optionally swap the Claude sidecar for the API key in prod.
4. **Domain:** buy `jarwiz.app` or similar; point at the web host.
5. **Auth + persistence:** today the canvas is local-only / yjs-sync. For real
   users you'll need accounts (Clerk/Auth.js) and a saved-state backend.
6. **Observability:** Sentry for errors, basic page analytics, server logs.

We'll lay this in piece by piece — **don't do it before you have something
worth deploying.** Premature production is how solo projects die.

---

## Common situations

### "I want to try a new agent design but keep the current one too"

→ Worktree. `"Spin up a worktree to try [name]."`

### "Can we ship this without a PR? It's tiny."

No. PRs are cheap. Even a one-line fix goes through a PR so the timeline of
`main` reads cleanly. Exception: docs-only and you're 100% sure — but even
then, do it.

### "Claude, the screen looks broken after your change."

You: describe what looks wrong. Claude: opens dev tools logs, diagnoses,
proposes a fix. **Never accept "I think it's fixed" without you verifying in
the browser.**

### "I want to undo the last 3 hours of work."

You: "Roll my branch back to before [the thing]." Claude finds the commit,
confirms what's lost, resets. Pushed branches need a force-push, which Claude
flags explicitly.

### "Two features are tangled, how do I separate them?"

This is messy in git. Claude can do it (`git cherry-pick`, interactive rebase)
but ask first — sometimes the easier answer is "leave it tangled, merge as
one feature, separate next time."

---

## Where this doc lives

- `docs/WORKFLOW.md` — this file (the durable playbook).
- `CLAUDE.md` → "Working with the owner" section — short version for Claude
  every session, pointing here.

If something here gets out of date, edit it. This doc beats memory.
