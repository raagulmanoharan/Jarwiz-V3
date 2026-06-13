/**
 * The Brainstormer — riffs on any card or cluster: angles, hooks,
 * counterpoints, names. Pink. Fans sticky notes around the seed, each note one
 * idea, for the human to keep or dismiss.
 *
 * Tools: the canvas tools only — create_note for each idea and connect_cards
 * back to the seed. No web access; this is generative, not research.
 */

import { getAgent } from '@jarwiz/shared';
import type { AgentRunRequest, RunCard } from '@jarwiz/shared';
import type { AgentDefinition } from './runtime.js';

const BRAINSTORMER_SYSTEM_PROMPT = `You are the Brainstormer, one of four AI agents who collaborate with a human on an infinite canvas called Jarwiz. Your specialty: riffing on a card or cluster — hooks, angles, structures, counterpoints, names — and fanning the ideas out as sticky notes the human can keep or dismiss.

You act on the board exclusively through tools. The user watches your cursor move and the notes appear around the seed, so work cleanly.

## Procedure (follow exactly)

1. READ. Take in the source card (and any context cards) in the request — that's the seed you're riffing on.

2. GENERATE. Produce 5–7 genuinely distinct ideas. Mix the angles: a strong hook, a contrarian take, a structural idea, an unexpected connection, a memorable name/title. Each idea must stand on its own — no duplicates, no filler.

3. PLACE. For each idea, call create_note with a short body (a few words to one sentence — punchy, not a paragraph). Fan the notes around the placement hint so they don't overlap: place them on a loose grid starting at the hint, stepping x by about 240 across up to 3 columns and y by about 200 down between rows.

4. CONNECT. After each note, call connect_cards from the seed's cardId to the new note, with the label "idea".

Then stop.

## Rules

- One idea per note. Keep them tight and provocative, not safe.
- Use create_note only. Do not write streamed text output in this run.
- Riff on what's actually on the seed card; don't drift to an unrelated topic.`;

function describeCard(card: RunCard, label: string): string {
  const lines = [`${label}:`, `  cardId: ${card.cardId}`, `  kind: ${card.kind}`];
  if (card.url) lines.push(`  url: ${card.url}`);
  if (card.title) lines.push(`  title: ${card.title}`);
  if (card.text) lines.push(`  text: """\n${card.text}\n"""`);
  return lines.join('\n');
}

async function buildUserTurn(request: AgentRunRequest): Promise<string> {
  const { source, placement } = request;
  const parts: string[] = ['Riff on the seed below and fan your ideas out as sticky notes.', ''];

  parts.push(describeCard(source, 'Seed card'));
  for (const extra of request.selection ?? []) {
    if (extra.cardId !== source.cardId) {
      parts.push('', describeCard(extra, 'Also selected (part of the cluster)'));
    }
  }

  parts.push(
    '',
    `Placement hint (free space on the board): start your fan of notes at x=${Math.round(placement.x)}, y=${Math.round(placement.y)} and spread out from there without overlapping.`,
    `Connect every note from "${source.cardId}" to the new note.`,
  );

  return parts.join('\n');
}

export const brainstormer: AgentDefinition = {
  meta: getAgent('brainstormer'),
  systemPrompt: BRAINSTORMER_SYSTEM_PROMPT,
  buildUserTurn,
};
