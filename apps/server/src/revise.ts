/**
 * Revise (Big Rocks 3.3 — conversational depth), now streamed. Given a doc's
 * markdown and a follow-up (+ prior turns), stream the FULL revised markdown so
 * the card rewrites live. Routes API → CLI sidecar → mock via streamText.
 */

import type { ReviseRequest, ReviseTurn } from '@jarwiz/shared';
import { streamText, type TextStreamEvent } from './textStream.js';

const SYSTEM_PROMPT = `You revise a markdown document in place in response to a follow-up from its author. The author is arguing with or pushing on the current draft; incorporate their point and return the FULL revised document.

Rules (follow exactly):
- Output ONLY the revised markdown document — no preamble, no "here's the revision", no code fences.
- Keep what still holds; change what the follow-up calls into question. Don't discard the document and start over unless explicitly told to.
- Address the follow-up substantively — add, correct, or sharpen. It's fine to add a short "## Revised" or "## Update" section if that's clearest, but prefer integrating it.
- Preserve the document's voice and markdown structure. Be concrete; never invent specifics you can't stand behind.`;

function buildUserTurn(req: ReviseRequest): string {
  const parts: string[] = [];
  if (req.thread && req.thread.length > 0) {
    parts.push('Discussion so far:');
    for (const t of req.thread) parts.push(`${t.role === 'you' ? 'Author' : 'You (agent)'}: ${t.text}`);
    parts.push('');
  }
  parts.push('Current document:', '"""', req.text || '(empty)', '"""', '');
  parts.push(`The author's follow-up: ${req.instruction}`, '', 'Return the full revised document.');
  return parts.join('\n');
}

function mock(req: ReviseRequest): string {
  const note = `\n\n## Revised\n\nIn response to "${req.instruction.slice(0, 120)}": this is where the agent would fold your point into the draft. (Demo mode — set ANTHROPIC_API_KEY for a real revision.)`;
  return (req.text || '# Document').trimEnd() + note;
}

export async function* streamRevision(
  req: ReviseRequest,
  signal: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  if (!req.instruction.trim()) {
    yield { type: 'done' };
    return;
  }
  yield* streamText({
    system: SYSTEM_PROMPT,
    user: buildUserTurn(req),
    signal,
    maxTokens: 4096,
    mock: () => mock(req),
  });
}

export type { ReviseTurn };
