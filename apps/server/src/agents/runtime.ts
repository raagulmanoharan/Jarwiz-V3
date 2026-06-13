/**
 * The Jarwiz agent runtime — a manual Anthropic agentic loop whose tools are
 * canvas actions. Executing a canvas tool means emitting an AgentEvent over
 * SSE; the client applies it to the tldraw store. See docs/ARCHITECTURE.md.
 *
 * Streaming design (the soul of the product): card content is NOT passed as
 * tool input. Instead, `begin_card` creates + opens a card, then the model
 * writes the card body as its plain streamed text output — which we forward
 * delta-by-delta as `card.delta` events the moment they arrive — and closes
 * it with `finish_card`. This gives true word-by-word streaming on the board
 * with zero buffering, and keeps tool inputs tiny. (The alternative —
 * streaming `input_json_delta` of a write_to_card tool — requires unescaping
 * partial JSON strings; the text-output channel is simpler and lossless.)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, AgentMeta, AgentRunRequest, CardKind } from '@jarwiz/shared';

export const AGENT_MODEL = 'claude-opus-4-8';
export const AGENT_MAX_TOKENS = 16_000;
/** Max assistant turns per run — cost control, see ARCHITECTURE.md. */
export const MAX_ITERATIONS = 12;

export type EmitFn = (event: AgentEvent) => void | Promise<void>;

/** A per-agent definition the generic runner executes. */
export interface AgentDefinition {
  meta: AgentMeta;
  /**
   * Frozen system prompt. Must be a static string (no interpolation) so the
   * `cache_control: ephemeral` breakpoint on the system block actually hits.
   * Volatile board context goes in the user turn via buildUserTurn.
   */
  systemPrompt: string;
  /** Anthropic server-side tools beyond the canvas tools (e.g. web_fetch). */
  serverTools?: Anthropic.Messages.ToolUnion[];
  /** Builds the volatile user turn from the run request (may prefetch). */
  buildUserTurn(request: AgentRunRequest): Promise<string>;
}

/* ─── Canvas tools (custom tools the runner executes by emitting events) ── */

const CANVAS_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'begin_card',
    description:
      'Create a new card on the board and open it for writing. Returns the new cardId. ' +
      'IMMEDIATELY after this tool returns, write the card body as your plain text ' +
      'output — it streams onto the board live, word by word — then call finish_card. ' +
      'Never write plain text output except as the body of an open card.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['doc', 'note'],
          description: 'doc = a markdown document card; note = a small sticky note',
        },
        x: {
          type: 'number',
          description:
            'Page-space x of the card top-left corner. Use the placement hint from the request.',
        },
        y: { type: 'number', description: 'Page-space y of the card top-left corner.' },
        title: { type: 'string', description: 'Short card title (shown in the doc card header).' },
      },
      required: ['kind', 'x', 'y'],
    },
  },
  {
    name: 'finish_card',
    description:
      'Close the card you opened with begin_card, after writing its body as text output.',
    input_schema: {
      type: 'object',
      properties: {
        cardId: { type: 'string', description: 'The cardId returned by begin_card.' },
      },
      required: ['cardId'],
    },
  },
  {
    name: 'create_link_card',
    description:
      'Place a finished link (source) card on the board in one step — for citing a web ' +
      'source you found. No streaming: the card shows its title, a one-line description, ' +
      'and the domain immediately. Returns the new cardId so you can connect_cards to it.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The source URL (https). Must be a real, fetched source.' },
        title: { type: 'string', description: 'The source title (the page/article/video title).' },
        description: {
          type: 'string',
          description: 'One short sentence on why this source is relevant to the idea.',
        },
        x: { type: 'number', description: 'Page-space x of the card top-left corner.' },
        y: { type: 'number', description: 'Page-space y of the card top-left corner.' },
      },
      required: ['url', 'title', 'x', 'y'],
    },
  },
  {
    name: 'create_note',
    description:
      'Place a finished sticky note on the board in one step — for a single idea, hook, ' +
      'angle, or name. Keep each note to one idea, a few words to a sentence. Returns the ' +
      'new cardId so you can connect_cards to it.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The note body — one idea, short.' },
        x: { type: 'number', description: 'Page-space x of the note top-left corner.' },
        y: { type: 'number', description: 'Page-space y of the note top-left corner.' },
      },
      required: ['text', 'x', 'y'],
    },
  },
  {
    name: 'create_table',
    description:
      'Place a finished TABLE on the board in one step. Use this — not a document — when ' +
      'the content is a 2-D matrix: parallel items compared across the same dimensions ' +
      '(options × criteria), a schedule, a scorecard, a spec sheet. Provide column headers ' +
      'and rows (each row has one cell per column, in order). Keep cells short (a few words). ' +
      'Returns the new cardId so you can connect_cards to it.',
    input_schema: {
      type: 'object',
      properties: {
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column headers — the dimensions each row is described on.',
        },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Rows; each is an array of cells matching the columns, in order.',
        },
        x: { type: 'number', description: 'Page-space x of the table top-left corner.' },
        y: { type: 'number', description: 'Page-space y of the table top-left corner.' },
        title: { type: 'string', description: 'Optional short caption (unused for now).' },
      },
      required: ['columns', 'rows', 'x', 'y'],
    },
  },
  {
    name: 'connect_cards',
    description:
      'Draw a provenance edge between two cards on the board (an arrow from the source ' +
      'card to the artifact that came from it).',
    input_schema: {
      type: 'object',
      properties: {
        fromCardId: { type: 'string', description: 'The card the arrow starts at (the source).' },
        toCardId: { type: 'string', description: 'The card the arrow points to (the artifact).' },
        label: { type: 'string', description: 'Optional short edge label, e.g. "summary".' },
      },
      required: ['fromCardId', 'toCardId'],
    },
  },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

/** Serialize emissions so streamed deltas and tool events never interleave. */
function serializeEmit(emit: EmitFn): (event: AgentEvent) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  return (event) => {
    chain = chain.then(() => emit(event));
    return chain;
  };
}

function friendlyApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The server Anthropic API key was rejected - check ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic rate limit hit - give it a moment and try again.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "Anthropic is overloaded right now - try again shortly.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status ?? "unknown"}): ${error.message}`;
  }
  return error instanceof Error ? error.message : "Agent run failed";
}

interface ToolInput {
  [key: string]: unknown;
}

/* ─── The runner ────────────────────────────────────────────────────────── */

/**
 * Run one agent end to end, emitting AgentEvents as the model works.
 * Always terminates the event sequence with `done` or `error` (unless the
 * client aborted, in which case nobody is listening anyway).
 */
export async function runAgentLoop(
  def: AgentDefinition,
  request: AgentRunRequest,
  rawEmit: EmitFn,
  signal: AbortSignal,
): Promise<void> {
  const emit = serializeEmit(rawEmit);
  const { meta } = def;

  // Run-scoped board state the tools manipulate.
  let openCardId: string | null = null;
  let cardCounter = 0;
  const knownCardIds = new Set<string>([
    request.source.cardId,
    ...(request.selection?.map((c) => c.cardId) ?? []),
  ]);

  const closeOpenCard = async () => {
    if (openCardId !== null) {
      await emit({ type: 'card.done', cardId: openCardId });
      openCardId = null;
    }
  };

  /** Execute one canvas tool call by emitting events; returns the tool result text. */
  const executeCanvasTool = async (
    name: string,
    input: ToolInput,
  ): Promise<{ result: string; isError?: boolean }> => {
    switch (name) {
      case 'begin_card': {
        const kind: CardKind = input.kind === 'note' ? 'note' : 'doc';
        const x = typeof input.x === 'number' ? input.x : request.placement.x;
        const y = typeof input.y === 'number' ? input.y : request.placement.y;
        const title = typeof input.title === 'string' ? input.title : undefined;
        await closeOpenCard(); // defensive: one open card at a time
        const cardId = `card_${++cardCounter}`;
        knownCardIds.add(cardId);
        await emit({ type: 'cursor', x, y });
        await emit({ type: 'card.create', cardId, kind, x, y, title });
        await emit({
          type: 'status',
          message: kind === 'doc' ? `${meta.name} is writing...` : `${meta.name} is jotting a note...`,
        });
        openCardId = cardId;
        return {
          result: JSON.stringify({
            cardId,
            next: 'Write the card body as plain text output now, then call finish_card.',
          }),
        };
      }
      case 'finish_card': {
        await closeOpenCard();
        return { result: 'ok' };
      }
      case 'create_link_card': {
        const url = typeof input.url === 'string' ? input.url : '';
        if (url === '') return { result: 'url is required', isError: true };
        const title = typeof input.title === 'string' ? input.title : url;
        const description = typeof input.description === 'string' ? input.description : undefined;
        const x = typeof input.x === 'number' ? input.x : request.placement.x;
        const y = typeof input.y === 'number' ? input.y : request.placement.y;
        await closeOpenCard();
        const cardId = `card_${++cardCounter}`;
        knownCardIds.add(cardId);
        await emit({ type: 'cursor', x, y });
        await emit({ type: 'card.create', cardId, kind: 'link', x, y, title, url, text: description });
        await emit({ type: 'status', message: `${meta.name} added a source` });
        return { result: JSON.stringify({ cardId }) };
      }
      case 'create_note': {
        const text = typeof input.text === 'string' ? input.text : '';
        if (text === '') return { result: 'text is required', isError: true };
        const x = typeof input.x === 'number' ? input.x : request.placement.x;
        const y = typeof input.y === 'number' ? input.y : request.placement.y;
        await closeOpenCard();
        const cardId = `card_${++cardCounter}`;
        knownCardIds.add(cardId);
        await emit({ type: 'cursor', x, y });
        await emit({ type: 'card.create', cardId, kind: 'note', x, y, text });
        await emit({ type: 'status', message: `${meta.name} jotted an idea` });
        return { result: JSON.stringify({ cardId }) };
      }
      case 'create_table': {
        const columns = Array.isArray(input.columns) ? input.columns.map((c) => String(c)) : [];
        if (columns.length === 0) return { result: 'columns is required', isError: true };
        const rows = Array.isArray(input.rows)
          ? input.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []))
          : [];
        const x = typeof input.x === 'number' ? input.x : request.placement.x;
        const y = typeof input.y === 'number' ? input.y : request.placement.y;
        const title = typeof input.title === 'string' ? input.title : undefined;
        await closeOpenCard();
        const cardId = `card_${++cardCounter}`;
        knownCardIds.add(cardId);
        await emit({ type: 'cursor', x, y });
        await emit({ type: 'card.create', cardId, kind: 'table', x, y, title, columns, rows });
        await emit({ type: 'status', message: `${meta.name} built a table` });
        return { result: JSON.stringify({ cardId }) };
      }
      case 'connect_cards': {
        const fromCardId = String(input.fromCardId ?? '');
        const toCardId = String(input.toCardId ?? '');
        if (!knownCardIds.has(fromCardId) || !knownCardIds.has(toCardId)) {
          return {
            result: `Unknown card id. Valid ids: ${[...knownCardIds].join(', ')}`,
            isError: true,
          };
        }
        const label = typeof input.label === 'string' ? input.label : undefined;
        await emit({ type: 'status', message: `${meta.name} is connecting it to the source...` });
        await emit({ type: 'edge.create', fromCardId, toCardId, label });
        return { result: 'ok' };
      }
      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
  };

  try {
    // Walk over to the source while we assemble the context.
    await emit({ type: 'status', message: `${meta.name} is looking at the source...` });
    await emit({
      type: 'cursor',
      x: request.source.x + request.source.w / 2,
      y: request.source.y + request.source.h / 2,
    });

    const userTurn = await def.buildUserTurn(request);
    if (signal.aborted) return;

    const client = new Anthropic();
    const tools: Anthropic.Messages.ToolUnion[] = [...CANVAS_TOOLS, ...(def.serverTools ?? [])];
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: userTurn }];

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (signal.aborted) return;

      const stream = client.messages.stream(
        {
          model: AGENT_MODEL,
          max_tokens: AGENT_MAX_TOKENS,
          thinking: { type: 'adaptive' },
          system: [
            {
              type: 'text',
              text: def.systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools,
          messages,
        },
        { signal },
      );

      // Forward streamed text into the open card the moment it arrives.
      stream.on('text', (delta) => {
        if (openCardId !== null && delta.length > 0) {
          void emit({ type: 'card.delta', cardId: openCardId, textDelta: delta });
        }
      });

      // Honest statuses for server-side tool activity (web_fetch runs on
      // Anthropic infra; we only see the blocks go by).
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'server_tool_use' && block.name === 'web_search') {
            void emit({ type: 'status', message: `${meta.name} is searching the web...` });
          } else if (block.type === 'server_tool_use' && block.name === 'web_fetch') {
            void emit({ type: 'status', message: `${meta.name} is reading the page...` });
          } else if (block.type === 'web_search_tool_result') {
            void emit({ type: 'status', message: `${meta.name} found sources - vetting...` });
          } else if (block.type === 'web_fetch_tool_result') {
            void emit({ type: 'status', message: `${meta.name} finished reading - thinking...` });
          }
        }
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        await closeOpenCard();
        await emit({
          type: 'error',
          message: `${meta.name} declined this request for safety reasons.`,
        });
        return;
      }

      if (message.stop_reason === 'pause_turn') {
        // Long-running server tool turn paused — re-send to resume.
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      if (message.stop_reason === 'max_tokens') {
        await closeOpenCard();
        await emit({
          type: 'status',
          message: `${meta.name} hit the output limit - the result may be truncated.`,
        });
        await emit({ type: 'done' });
        return;
      }

      const toolUses = message.content.filter(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
      );

      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
        // end_turn (or anything else): the run is complete.
        await closeOpenCard();
        await emit({ type: 'status', message: `${meta.name} is done` });
        await emit({ type: 'done' });
        return;
      }

      messages.push({ role: 'assistant', content: message.content });

      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const { result, isError } = await executeCanvasTool(
          toolUse.name,
          (toolUse.input ?? {}) as ToolInput,
        );
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: results });
    }

    // Iteration cap reached without a clean finish — say so honestly.
    await closeOpenCard();
    await emit({
      type: 'error',
      message: `${meta.name} ran out of steps (${MAX_ITERATIONS}) before finishing.`,
    });
  } catch (error) {
    if (signal.aborted) return; // client went away — nobody is listening
    await closeOpenCard().catch(() => {});
    await emit({ type: 'error', message: friendlyApiError(error) }).catch(() => {});
  }
}
