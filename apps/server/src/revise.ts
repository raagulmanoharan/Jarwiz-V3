/**
 * Revise (Big Rocks 3.3 — conversational depth). Given a doc card's current
 * markdown and a follow-up instruction (plus the prior discussion), return the
 * full revised markdown. The card is rewritten in place so a 3-turn argument
 * stays on one artifact instead of spawning orphans.
 *
 * Routes API → CLI sidecar → a scripted mock.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ReviseRequest, ReviseResult, ReviseTurn } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

const SYSTEM_PROMPT = `You revise a markdown document in place in response to a follow-up from its author. The author is arguing with or pushing on the current draft; incorporate their point and return the FULL revised document.

Rules (follow exactly):
- Output ONLY the revised markdown document — no preamble, no "here's the revision", no code fences.
- Keep what still holds; change what the follow-up calls into question. Don't discard the document and start over unless explicitly told to.
- Address the follow-up substantively — add, correct, or sharpen. It's fine to add a short "## Revised" or "## Update" section if that's the clearest way to reflect the new point, but prefer integrating it.
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

function mockRevise(req: ReviseRequest): string {
  const note = `\n\n## Revised\n\nIn response to "${req.instruction.slice(0, 120)}": this is where the agent would fold your point into the draft. (Demo mode — set ANTHROPIC_API_KEY for a real revision.)`;
  return (req.text || '# Document').trimEnd() + note;
}

export async function generateRevision(req: ReviseRequest, signal: AbortSignal): Promise<ReviseResult> {
  const instruction = req.instruction.trim();
  if (!instruction) return { text: req.text };

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (hasKey) {
    const client = new Anthropic();
    const message = await client.messages.create(
      {
        model: AGENT_MODEL,
        max_tokens: 4096,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserTurn(req) }],
      },
      { signal },
    );
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { text: text || req.text };
  }

  if (sidecarAvailable()) {
    try {
      const text = await sidecarGenerate({ system: SYSTEM_PROMPT, user: buildUserTurn(req), signal });
      return { text: text.trim() || req.text };
    } catch {
      if (signal.aborted) throw new Error('aborted');
    }
  }
  return { text: mockRevise(req) };
}

export type { ReviseTurn };
