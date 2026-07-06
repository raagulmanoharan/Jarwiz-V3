# scripts

## verify-m1.mjs

Headless end-to-end check of the Milestone 1 golden path against a running
dev server (`npm run dev`). Drives the real browser:

drop a YouTube link → "Summarize this?" offer appears → tap → the Summarizer's
cursor walks over, the dock shows live status, a summary card streams in word
by word, and an amber provenance edge binds it to the source.

Runs in mock mode (no `ANTHROPIC_API_KEY` needed). Uses the Playwright +
Chromium already present in the environment:

```sh
node scripts/verify-m1.mjs
```
