/**
 * Cluster & summarise (Big Rocks 2.1 — synthesis is the moat).
 *
 * Takes the user's OWN sticky notes and synthesises backward: groups them into
 * 2–4 named themes and writes a short "themes emerged" summary. Distinct from
 * the affinity diagram (which starts from a prompt) — this absorbs the 30 minutes
 * a PM spends grouping stickies and naming clusters by hand.
 *
 * Routes API → CLI sidecar → scripted mock, returning the same ClusterResult.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClusterRequest, ClusterResult, ClusterTheme } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { anthropic, hasModelKey } from './model.js';

const MAX_THEMES = 5;

const SYSTEM_PROMPT = `You group a set of sticky notes into a small number of named themes, the way a PM does an affinity exercise. You are given the notes as a numbered list. Return ONLY a JSON object of the form:
{"themes":[{"name":"Short theme name","members":[0,2,5]}],"summary":"markdown synthesis"}

Rules (follow exactly):
- 2 to 4 themes. Each theme "name" is 2–4 words — the actual idea the notes share, never generic ("Group 1", "Miscellaneous").
- "members" are the 0-based indices of the notes in that theme. Assign every note to exactly one theme; do not invent indices.
- "summary" is short markdown: a "N themes emerged:" line, then one bullet per theme naming it and its through-line in a sentence. No preamble.
- Base themes on what the notes actually say. Output only the JSON object: no prose, no code fences.`;

function buildUserTurn(items: string[]): string {
  const list = items.map((t, i) => `${i}. ${t.replace(/\s+/g, ' ').trim()}`).join('\n');
  return `Group these ${items.length} sticky notes into themes:\n\n${list}`;
}

/** Tolerantly parse + clamp a ClusterResult; guarantees every item is assigned. */
function parseResult(raw: string, itemCount: number): ClusterResult {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(text) as { themes?: unknown; summary?: unknown };
  const rawThemes = Array.isArray(parsed.themes) ? parsed.themes : [];

  const assigned = new Set<number>();
  const themes: ClusterTheme[] = [];
  for (const t of rawThemes) {
    if (themes.length >= MAX_THEMES) break;
    const o = t as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) continue;
    const members: number[] = [];
    if (Array.isArray(o.members)) {
      for (const m of o.members) {
        const i = Math.trunc(Number(m));
        if (Number.isFinite(i) && i >= 0 && i < itemCount && !assigned.has(i)) {
          assigned.add(i);
          members.push(i);
        }
      }
    }
    if (members.length) themes.push({ name, members });
  }

  if (themes.length === 0) throw new Error('no themes');

  // Any unassigned notes join the last theme so nothing is silently dropped.
  const leftover: number[] = [];
  for (let i = 0; i < itemCount; i++) if (!assigned.has(i)) leftover.push(i);
  if (leftover.length) themes[themes.length - 1]!.members.push(...leftover);

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : `${themes.length} themes emerged:\n` + themes.map((t) => `- **${t.name}**`).join('\n');

  return { themes, summary };
}

/** Scripted stand-in so the feature is demoable with no API key: split in order. */
function mockResult(items: string[]): ClusterResult {
  const n = items.length;
  const groups = Math.min(3, Math.max(2, Math.round(n / 3)));
  const themes: ClusterTheme[] = Array.from({ length: groups }, (_, g) => ({
    name: `Theme ${g + 1}`,
    members: [] as number[],
  }));
  items.forEach((_, i) => themes[i % groups]!.members.push(i));
  const summary =
    `${groups} themes emerged:\n` +
    themes.map((t) => `- **${t.name}** — ${t.members.length} notes (demo: set ANTHROPIC_API_KEY for real synthesis).`).join('\n');
  return { themes, summary };
}

export async function generateClusters(
  request: ClusterRequest,
  signal: AbortSignal,
): Promise<ClusterResult> {
  const items = request.items.map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return { themes: [], summary: '' };

  const hasKey = Boolean(hasModelKey());
  if (hasKey) {
    const client = anthropic();
    const message = await client.messages.create(
      {
        model: AGENT_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserTurn(items) }],
      },
      { signal },
    );
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseResult(text, items.length);
  }

  if (sidecarAvailable()) {
    try {
      const text = await sidecarGenerate({ system: SYSTEM_PROMPT, user: buildUserTurn(items), signal });
      return parseResult(text, items.length);
    } catch {
      if (signal.aborted) throw new Error('aborted');
    }
  }
  return mockResult(items);
}
