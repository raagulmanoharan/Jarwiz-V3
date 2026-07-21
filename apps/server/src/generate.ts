/**
 * One-shot buffered generation — the non-streaming sibling of textStream.ts.
 * Several endpoints (notice, compose, discover, machine boards) need the model's
 * full reply as a single string, with the same API → CLI-sidecar fallback and,
 * optionally, the deep web-research tool loop. That block was copy-pasted four
 * times (`review`/`planText`/`groundedSearch`/`research`); it lives here once.
 *
 * `web` gates the research toolset: omit it for a snappy single pure-reasoning
 * call; pass `{ tools, maxTurns }` to run the pause_turn continuation loop (and
 * flip the sidecar into its web-enabled mode).
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_MODEL } from './agents/runtime.js';
import { sidecarAvailable, sidecarGenerate } from './sidecar.js';
import { anthropic, hasModelKey } from './model.js';

export interface GenerateTextOptions {
  system: string;
  user: string;
  signal: AbortSignal;
  maxTokens: number;
  /** Sidecar hard-timeout (ms) — deep web passes need a much larger budget. */
  sidecarTimeoutMs: number;
  /** Enable the web-research tool loop; omit for a single tool-less call. */
  web?: { tools: Anthropic.ToolUnion[]; maxTurns: number };
}

/** Generate the model's full reply as one string. API key first, else the CLI
 *  sidecar; throws if neither is available. */
export async function generateText(opts: GenerateTextOptions): Promise<string> {
  const { system, user, signal, maxTokens, sidecarTimeoutMs, web } = opts;
  if (hasModelKey()) {
    const client = anthropic();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
    let text = '';
    const maxTurns = web ? web.maxTurns : 0;
    for (let turn = 0; turn <= maxTurns; turn++) {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: AGENT_MODEL,
        max_tokens: maxTokens,
        system,
        messages,
      };
      if (web) params.tools = web.tools;
      const msg = await client.messages.create(params, { signal });
      text += msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content });
    }
    return text;
  }
  if (sidecarAvailable()) {
    return sidecarGenerate({ system, user, signal, web: Boolean(web), timeoutMs: sidecarTimeoutMs });
  }
  throw new Error('No model available (set ANTHROPIC_API_KEY or install the Claude CLI).');
}
