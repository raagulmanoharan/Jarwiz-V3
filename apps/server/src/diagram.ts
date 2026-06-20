/**
 * Diagram generation (canvas pivot P2 — the AI builds primitives).
 *
 * "Turn this into a flowchart": the model returns a small graph spec
 * { nodes, edges } and the CLIENT lays it out as native tldraw shapes +
 * connectors the user can then drag, restyle, and extend. Unlike the diagram
 * CARD (which renders fixed Mermaid), this produces real, editable primitives.
 *
 * Routes like table autopilot: real Anthropic (key present) → CLI sidecar (dev,
 * no key) → a scripted mock, all returning the same DiagramSpec shape.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AskSource, DiagramEdge, DiagramNode, DiagramRequest, DiagramSpec } from '@jarwiz/shared';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';

const DIAGRAM_MAX_NODES = 12;
const DIAGRAM_MAX_EDGES = 20;

const SYSTEM_PROMPT = `You turn an idea (and any provided context) into a small, clear flowchart graph. Return ONLY a JSON object of the form:
{"nodes":[{"id":"n1","label":"Short step","shape":"rectangle"}],"edges":[{"from":"n1","to":"n2","label":"optional"}]}

Rules (follow exactly):
- Output ONLY the JSON object. No prose, no markdown, no code fences.
- 3 to 8 nodes. Each label is a few words — a step, state, or decision. Never a sentence.
- Use "shape":"diamond" for a decision/branch node, "rectangle" for a step, "ellipse" for a start/end. Default to "rectangle".
- Edges connect node ids you defined. Add a short edge "label" only when it clarifies a branch (e.g. "yes"/"no"). Keep the graph a sensible left-to-right or top-down flow.
- Ground the flow in the provided context when given; otherwise infer a reasonable flow from the prompt.
- Node ids are stable opaque strings ("n1","n2",…).`;

function buildUserTurn(request: DiagramRequest): string {
  const parts: string[] = [];
  if (request.sources && request.sources.length > 0) {
    parts.push('Context to base the flowchart on:');
    for (const s of request.sources) parts.push('', formatSource(s));
    parts.push('');
  }
  parts.push(`Make a flowchart for: ${request.prompt.trim() || 'the context above'}`);
  return parts.join('\n');
}

function formatSource(s: AskSource): string {
  const head = s.title ? `${s.kind}: "${s.title}"` : s.kind;
  return `[${head}]\n${s.text ?? '(no text)'}`;
}

/** Tolerantly parse a DiagramSpec from a model's text reply, then clamp it. */
function parseSpec(raw: string): DiagramSpec {
  const text = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const parsed = JSON.parse(text) as { nodes?: unknown; edges?: unknown };
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];

  const cleanNodes: DiagramNode[] = [];
  for (const n of rawNodes) {
    if (cleanNodes.length >= DIAGRAM_MAX_NODES) break;
    const o = n as Record<string, unknown>;
    const id = String(o.id ?? '').trim();
    const label = String(o.label ?? '').trim();
    if (!id || !label) continue;
    const shape: DiagramNode['shape'] =
      o.shape === 'ellipse' || o.shape === 'diamond' ? o.shape : 'rectangle';
    cleanNodes.push({ id, label, shape });
  }

  const ids = new Set(cleanNodes.map((n) => n.id));
  const cleanEdges: DiagramEdge[] = [];
  for (const e of rawEdges) {
    if (cleanEdges.length >= DIAGRAM_MAX_EDGES) break;
    const o = e as Record<string, unknown>;
    const from = String(o.from ?? '').trim();
    const to = String(o.to ?? '').trim();
    if (!from || !to || !ids.has(from) || !ids.has(to)) continue;
    const label = o.label ? String(o.label).trim() : undefined;
    cleanEdges.push({ from, to, label });
  }

  if (cleanNodes.length === 0) throw new Error('empty diagram');
  return { nodes: cleanNodes, edges: cleanEdges };
}

/** A scripted stand-in so the feature is demoable with no API key. */
function mockSpec(request: DiagramRequest): DiagramSpec {
  const topic = request.prompt.trim().replace(/^make a flowchart (for|of)\s*/i, '').slice(0, 24) || 'Idea';
  return {
    nodes: [
      { id: 'n1', label: 'Start', shape: 'ellipse' },
      { id: 'n2', label: topic || 'Define', shape: 'rectangle' },
      { id: 'n3', label: 'Decision?', shape: 'diamond' },
      { id: 'n4', label: 'Ship it', shape: 'rectangle' },
      { id: 'n5', label: 'Done', shape: 'ellipse' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4', label: 'yes' },
      { from: 'n3', to: 'n2', label: 'no' },
      { from: 'n4', to: 'n5' },
    ],
  };
}

export async function generateDiagram(
  request: DiagramRequest,
  signal: AbortSignal,
): Promise<DiagramSpec> {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (hasKey) {
    const client = new Anthropic();
    const message = await client.messages.create(
      {
        model: AGENT_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildUserTurn(request) }],
      },
      { signal },
    );
    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseSpec(text);
  }

  if (sidecarAvailable()) {
    try {
      const text = await sidecarGenerate({ system: SYSTEM_PROMPT, user: buildUserTurn(request), signal });
      return parseSpec(text);
    } catch {
      if (signal.aborted) throw new Error('aborted');
      // else fall through to the scripted stand-in
    }
  }
  return mockSpec(request);
}
