// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { isPlainLine } from './signals.js';

/**
 * Phase 76g: my song on the profile, in my own words. No music service is connected: no account
 * linking, no player, no third-party script; it's plain text.
 */
export const ANTHEM_FIELD_MAX = 80;

export const anthemInputSchema = z
  .object({
    title: z.string().trim().min(1).max(ANTHEM_FIELD_MAX).refine(isPlainLine, 'Plain text only'),
    artist: z.string().trim().min(1).max(ANTHEM_FIELD_MAX).refine(isPlainLine, 'Plain text only'),
  })
  .strict();
export type AnthemInput = z.infer<typeof anthemInputSchema>;

/** The song as shown on a profile; `id` is what a like on it refers to. */
export const anthemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  artist: z.string(),
});
export type Anthem = z.infer<typeof anthemSchema>;

export const myAnthemSchema = z.object({ anthem: anthemSchema.nullable() });
