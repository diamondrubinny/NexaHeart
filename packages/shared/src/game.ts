// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { scamSignals } from './signals.js';

/**
 * Phase 76c: the Question Game in chat. A fixed, reviewed list of light questions (translated in
 * the apps as `game.q.<key>`); no AI. Each person answers; neither answer shows until both have.
 */
export const gameQuestions = [
  'perfect_day',
  'superpower',
  'comfort_food',
  'last_laugh',
  'small_joy',
  'travel_next',
  'song_on_repeat',
  'hidden_talent',
  'best_advice',
  'weekend_plan',
  'childhood_dream',
  'proud_of',
  'learn_next',
  'favourite_place',
  'tiny_habit',
  'kindness',
] as const;
export type GameQuestion = (typeof gameQuestions)[number];

/** A short answer: a line or two, like a message. */
export const GAME_ANSWER_MAX = 280;

export const startGameSchema = z
  .object({
    /** Client-generated id that makes retries idempotent, like a message's. */
    clientId: z.string().min(8).max(64),
    /** A question not yet asked in this chat; one is chosen when omitted. */
    question: z.enum(gameQuestions).optional(),
  })
  .strict();
export type StartGameInput = z.infer<typeof startGameSchema>;

export const gameAnswerSchema = z
  .object({ answer: z.string().trim().min(1).max(GAME_ANSWER_MAX) })
  .strict();
export type GameAnswerInput = z.infer<typeof gameAnswerSchema>;

/** A game card as one viewer may see it: the other answer only once both answered. */
export const gameViewSchema = z.object({
  id: z.uuid(),
  question: z.enum(gameQuestions),
  /** This viewer started it. */
  mine: z.boolean(),
  myAnswer: z.string().nullable(),
  /** Whether the other person answered (their words stay hidden until both did). */
  theyAnswered: z.boolean(),
  /** Set once both answered. */
  theirAnswer: z.string().nullable(),
  revealed: z.boolean(),
  /** Phase 77b: scam warnings on their revealed answer, as on a message. */
  scam: z.array(z.enum(scamSignals)),
});
export type GameView = z.infer<typeof gameViewSchema>;
