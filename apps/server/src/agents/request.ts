/**
 * Validation for the POST /api/agents/:id/run body (AgentRunRequest).
 *
 * Hand-rolled and strict on the fields the runtime relies on; throws
 * RunRequestError with a message safe to return as a 400.
 */

import type { AgentRunRequest, CardKind, RunCard } from '@jarwiz/shared';

export class RunRequestError extends Error {}

const CARD_KINDS: readonly CardKind[] = ['link', 'youtube', 'image', 'pdf', 'note', 'doc', 'table'];

const MAX_TEXT_CHARS = 8000;
const MAX_SELECTION = 12;
const MAX_BRIEF_CHARS = 1000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseRunCard(value: unknown, label: string): RunCard {
  if (typeof value !== 'object' || value === null) {
    throw new RunRequestError(`${label} must be an object`);
  }
  const card = value as Record<string, unknown>;

  if (typeof card.cardId !== 'string' || card.cardId === '') {
    throw new RunRequestError(`${label}.cardId must be a non-empty string`);
  }
  if (typeof card.kind !== 'string' || !(CARD_KINDS as readonly string[]).includes(card.kind)) {
    throw new RunRequestError(`${label}.kind must be one of: ${CARD_KINDS.join(', ')}`);
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (!isFiniteNumber(card[key])) {
      throw new RunRequestError(`${label}.${key} must be a finite number`);
    }
  }
  for (const key of ['url', 'title', 'text'] as const) {
    if (card[key] !== undefined && typeof card[key] !== 'string') {
      throw new RunRequestError(`${label}.${key} must be a string when present`);
    }
  }

  return {
    cardId: card.cardId,
    kind: card.kind as CardKind,
    x: card.x as number,
    y: card.y as number,
    w: card.w as number,
    h: card.h as number,
    url: card.url as string | undefined,
    title: typeof card.title === 'string' ? card.title.slice(0, 300) : undefined,
    text: typeof card.text === 'string' ? card.text.slice(0, MAX_TEXT_CHARS) : undefined,
  };
}

export function parseRunRequest(body: unknown): AgentRunRequest {
  if (typeof body !== 'object' || body === null) {
    throw new RunRequestError('Expected a JSON body: { source, placement, selection? }');
  }
  const raw = body as Record<string, unknown>;

  const source = parseRunCard(raw.source, 'source');

  const placementRaw = raw.placement;
  if (
    typeof placementRaw !== 'object' ||
    placementRaw === null ||
    !isFiniteNumber((placementRaw as Record<string, unknown>).x) ||
    !isFiniteNumber((placementRaw as Record<string, unknown>).y)
  ) {
    throw new RunRequestError('placement must be { x: number, y: number }');
  }
  const placement = {
    x: (placementRaw as Record<string, unknown>).x as number,
    y: (placementRaw as Record<string, unknown>).y as number,
  };

  let selection: RunCard[] | undefined;
  if (raw.selection !== undefined) {
    if (!Array.isArray(raw.selection)) {
      throw new RunRequestError('selection must be an array of cards');
    }
    selection = raw.selection
      .slice(0, MAX_SELECTION)
      .map((entry, i) => parseRunCard(entry, `selection[${i}]`));
  }

  let brief: string | undefined;
  if (raw.brief !== undefined) {
    if (typeof raw.brief !== 'string') {
      throw new RunRequestError('brief must be a string when present');
    }
    const trimmed = raw.brief.trim().slice(0, MAX_BRIEF_CHARS);
    brief = trimmed || undefined;
  }

  return { source, selection, placement, brief };
}
