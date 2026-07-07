/**
 * The response shapes the composer's "/" mode selector can pin. Mirrors the
 * server's AskShape plus 'board' (which fans an answer out into a set of cards
 * via compose, not a single card). Shared so the shape suggester and PromptBar
 * agree on the type.
 */

import type { AskShape } from '@jarwiz/shared';

export type ModeShape = AskShape | 'board';
