/**
 * Shared model constant for the server's AI routes.
 *
 * Historical note: this file used to host a manual Anthropic tool-use loop
 * (`runAgentLoop`) driving the `POST /api/agents/:id/run` endpoint and the
 * `AgentEvent` wire protocol. That runtime was never wired to the web UI —
 * the live product reaches the model through `/api/ask` (see `ask.ts`) and its
 * own `AskEvent` protocol — so it was removed. What survives is the one thing
 * the live routes actually share: the model id.
 */

export const AGENT_MODEL = 'claude-opus-4-8';
