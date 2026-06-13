/**
 * @mention — address an agent the way you'd address a teammate. Type "@" in a
 * card and a picker of the agents appears; choosing one summons it on that card.
 * This is the participant grammar's core: agents are members you call on by
 * name, not menu items (see VISION "North star").
 *
 * State is the open mention (which card, current query); the screen-space
 * MentionMenu reads it and anchors to the card. The actual summon strips the
 * "@token" from the card text and fires a SummonRequest.
 */

import type { Editor, TLShapeId } from 'tldraw';
import { AGENTS, type AgentId, type AgentMeta } from '@jarwiz/shared';
import { requestSummon } from './summon';

export interface MentionState {
  cardId: TLShapeId;
  query: string;
}

let state: MentionState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeMention(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getMention(): MentionState | null {
  return state;
}

function setState(next: MentionState | null): void {
  state = next;
  notify();
}

/** The "@word" being typed just before the caret, or null if there isn't one. */
export function mentionQuery(value: string, caret: number): string | null {
  const upto = value.slice(0, caret);
  const m = /(?:^|\s)@(\w*)$/.exec(upto);
  return m ? (m[1] ?? '') : null;
}

/** Open/close the mention picker from a textarea's current value + caret. */
export function syncMention(cardId: TLShapeId, value: string, caret: number): void {
  const q = mentionQuery(value, caret);
  if (q === null) {
    if (state?.cardId === cardId) setState(null);
    return;
  }
  setState({ cardId, query: q });
}

export function closeMention(): void {
  if (state) setState(null);
}

export function filteredAgents(query: string): AgentMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...AGENTS];
  return AGENTS.filter((a) => a.name.toLowerCase().startsWith(q));
}

export function bestAgent(query: string): AgentMeta | undefined {
  return filteredAgents(query)[0];
}

/** Strip the trailing "@token" from the card text, summon the agent, close. */
export function commitMention(editor: Editor, cardId: TLShapeId, agentId: AgentId): void {
  const shape = editor.getShape(cardId);
  if (shape && typeof (shape.props as { text?: unknown }).text === 'string') {
    const text = (shape.props as { text: string }).text.replace(/@\w*\s*$/, '');
    editor.updateShape({
      id: cardId,
      type: shape.type,
      props: { text },
    } as Parameters<typeof editor.updateShape>[0]);
  }
  setState(null);
  requestSummon(agentId, cardId);
}
