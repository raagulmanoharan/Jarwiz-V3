/**
 * The response shapes the composer's "/" mode selector can pin. Mirrors the
 * server's AskShape plus 'debrief' (the fixed meeting-debrief recipe: Decisions
 * / Action items / Risks from a transcript, auto-pinned when a transcript is
 * attached). Shared so the shape suggester and PromptBar agree on the type.
 */

import type { AskShape } from '@jarwiz/shared';

export type ModeShape = AskShape | 'debrief';
