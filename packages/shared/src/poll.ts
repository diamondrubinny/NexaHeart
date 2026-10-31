// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { isPlainLine } from './signals.js';

/**
 * Phase 76d: a prompt poll on the profile. A question and 2-3 answers, in the member's own words.
 * Someone who likes the profile can pick one; the pick arrives with the like. No counts, no results.
 */
export const POLL_QUESTION_MAX = 120;
export const POLL_ANSWER_MAX = 40;
export const POLL_ANSWERS_MIN = 2;
export const POLL_ANSWERS_MAX = 3;

export const profilePollSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(3)
      .max(POLL_QUESTION_MAX)
      .refine(isPlainLine, 'Plain text only'),
    answers: z
      .array(z.string().trim().min(1).max(POLL_ANSWER_MAX).refine(isPlainLine, 'Plain text only'))
      .min(POLL_ANSWERS_MIN)
      .max(POLL_ANSWERS_MAX)
      .refine((a) => new Set(a.map((x) => x.toLowerCase())).size === a.length, {
        message: 'Each answer once',
      }),
  })
  .strict();
export type ProfilePoll = z.infer<typeof profilePollSchema>;

/** My poll, or null when I have none. */
export const myPollSchema = z.object({ poll: profilePollSchema.nullable() });
