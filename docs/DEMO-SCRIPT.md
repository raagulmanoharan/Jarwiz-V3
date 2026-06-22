# The Five-Minute Demo Script

A word-for-word walkthrough for showing Jarwiz to a skeptic. Optimized for a product manager, investor, or potential hire who has five minutes and a healthy prior of "AI chat with extra steps." The goal is to make them *feel* something, not explain the architecture.

Run this against a production build with a real API key. The cold board is your best friend — start with nothing on the canvas.

---

## Before you start

**Setup (do this the night before):**
1. Create a fresh board called "Demo."
2. Have a PDF ready to drop — a real one you've read, ~10–20 pages. An analyst report, a strategy doc, or a dense article works best. Do not use a toy PDF; the reaction is better when the content is real.
3. Confirm Demo mode badge is NOT shown (API key is live).
4. Full-screen the browser, hide bookmarks bar, close other tabs.

**Mindset:** You are not giving a feature tour. You are telling a story about what it's like to work with AI that thinks *on the board* instead of hiding in a chat box.

---

## The script

### Cold open — the blank canvas (30 seconds)

Open the browser. The board is empty: warm paper, nothing else.

> "This is Jarwiz. It's a canvas — like Figma or FigJam, but every AI response lands as a card you can move, connect, and build on. There's no chat window. The thinking happens here, in the open."

*Pause. Let the emptiness speak.*

> "Let me show you what that actually means. I'll drop in something real."

---

### Drop the PDF (45 seconds)

Drag your PDF from the desktop onto the canvas. A card appears immediately — grey while uploading, then a crisp PDF card with the filename.

> "Jarwiz reads the whole document the moment it lands. But instead of presenting a summary nobody asked for, it waits. You decide what to do with it."

Select the PDF card by clicking it. A row of starter chips appears at the bottom prompt bar.

> "These chips are context-aware — they're the questions most likely to be useful given what the document is. I'll pick one."

Click **"What should I worry about here?"**

*A status pulse appears. Then the Writer avatar glides into frame, parks near the PDF, and a new doc card opens. Text streams in live, word by word.*

> "See what just happened. There's a cursor — that's the Writer agent. It's working on the board the same way you would. The answer isn't in a sidebar. It's a card, so I can move it, connect it to other cards, or hand it off to a different agent."

Wait for the stream to finish. The edge appears, connecting PDF → answer card.

> "That line is provenance. Click 'Based on' on the answer card and you see exactly which source generated it."

*(Optional: click "Based on" button on the card to show the source reference.)*

---

### Ground the follow-up (60 seconds)

The answer card is on the canvas. Now select it by clicking.

> "Now I've got the analysis. Say I want to go deeper on one specific thing — I just ask about it, grounded to this card."

Type in the prompt bar: **"What's the weakest assumption in here?"**

Another doc card streams in, connected to the previous one.

> "It knows the context because I selected the card first. This is what grounding means — the question inherits the card's content, not my memory of what I read. The board is the memory."

---

### Show the agents (60 seconds)

Click somewhere empty to deselect everything. Point to the Agents menu in the prompt bar (⚖ chip).

> "Once you've got a few cards, the interesting move is to let the agents look at the whole board — not just one card."

Click **⚖ Scan for tensions**.

*The Writer avatar appears. A doc card grows with a structured tensions analysis.*

> "This is an opinion, not a search result. The agent is reading all the cards simultaneously and naming what conflicts. It doesn't know anything the cards don't contain — but it can see patterns across them that you're too close to see."

*(If time allows, show one more agent — e.g. click the new card and hit "Go deeper" in the card action bar. Otherwise skip.)*

---

### The board is the artifact (30 seconds)

Pan out slightly so two or three cards are visible at once.

> "Most AI tools give you a conversation. When you close the tab, it's gone. This —"

*Gesture at the board.*

> "— is a workspace. You can name it, switch to another board, come back and it's exactly as you left it. The cards connect to show you how you got from A to B. You can add your own notes alongside the agent cards. It's not a chat log. It's a document you and the agents built together."

---

### Close (15 seconds)

> "Three things I want to leave you with. One: the AI is *present* — you can see it working. Two: the output is a *card*, not a message — it stays, you can move it, build on it, connect it. Three: the *board* is the shared memory — you and the agents both write to the same canvas."

Let them ask a question.

---

## Questions they will ask, and what to say

**"How is this different from ChatGPT with a whiteboard plugin?"**

> "ChatGPT's output is a message. Ours is an artifact with coordinates, provenance, and a type. The agent doesn't send you a link — it places a card at a specific location, with an edge connecting it to its source. The board is the shared working memory, not a way to display chat output."

**"What if the answer is wrong?"**

> "Same as with a junior analyst — you review it, you push back, you ask it to go deeper. The 'Based on' button shows you what the agent was looking at. The card is always editable. We're building for informed human oversight, not blind trust."

**"Can multiple people use the same board?"**

> "Yes, it's multiplayer. The sync is built on tldraw's CRDT layer — same technology as production FigJam sessions. You'd share a URL and you're both live on the same canvas."

**"Can I export this?"**

> "Export isn't the primary artifact — the board is. But the cards are plain text and Markdown inside, so it's trivial to copy out. We have a PDF export on the roadmap."

**"Which model does it use?"**

> "Claude Opus for all reasoning — the strongest multi-step model available. The agent loop is a proper tool-use loop, not a one-shot prompt. It can read URLs, run multiple search queries, and decide its own card placement."

**"Is my data sent to Anthropic?"**

> "Board content goes to Anthropic the same way any Claude API call does — under their standard data policy. Boards themselves are stored locally in IndexedDB in your browser. Nothing is on our servers except the agent run itself."

---

## Anti-patterns to avoid

- **Don't explain the architecture during the demo.** Save `AgentEvent`, SSE, tool-use loops for a follow-up technical conversation. They don't need to know how the cursor moves — they need to feel surprised that it does.
- **Don't use a toy PDF.** "Summarize this lorem ipsum" does not land. Use something real with actual stakes.
- **Don't rush the streaming.** The live text appearing word-by-word *is* the demo. Pause, point at it, let the moment breathe.
- **Don't apologize for what's missing.** If they ask about a feature that isn't built, say "not yet" and move on. Apologizing makes it feel half-baked even when what's there is genuinely impressive.
- **Don't show more than two agent runs in five minutes.** Depth beats breadth.
