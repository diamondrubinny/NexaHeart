// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { promptKeySchema } from './profile.js';

/**
 * Phase 76h: a short video answer to a prompt. Re-encoded without metadata, and shown only after a
 * moderator approved it.
 */
export const MAX_VIDEO_SECONDS = 30;
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
/** The longest side of the re-encoded video, in pixels. */
export const VIDEO_MAX_SIDE = 720;

export const videoStatuses = ['quarantine', 'processing', 'review', 'clean', 'rejected'] as const;
export type VideoStatus = (typeof videoStatuses)[number];

/** Why a moderator (or the pipeline) refused a video; shown to its owner. */
export const videoRejectReasons = [
  'malware',
  'unsupported_format',
  'undecodable',
  'too_long',
  'nudity',
  'other_people',
  'not_the_member',
  'offensive',
  'banned_photo',
  'other',
] as const;
export type VideoRejectReason = (typeof videoRejectReasons)[number];

export const myVideoSchema = z.object({
  video: z
    .object({
      id: z.uuid(),
      promptKey: promptKeySchema,
      status: z.enum(videoStatuses),
      rejectReason: z.enum(videoRejectReasons).nullable(),
      durationMs: z.number().int().nullable(),
      /** Only once processed (my own preview, also while it waits for review). */
      url: z.string().nullable(),
      posterUrl: z.string().nullable(),
    })
    .nullable(),
});
export type MyVideo = z.infer<typeof myVideoSchema>;

/** On a profile: only an approved video. */
export const videoPromptSchema = z.object({
  id: z.uuid(),
  promptKey: promptKeySchema,
  url: z.string(),
  posterUrl: z.string(),
  durationMs: z.number().int(),
});
export type VideoPrompt = z.infer<typeof videoPromptSchema>;

export const adminVideoSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  displayName: z.string(),
  promptKey: promptKeySchema,
  durationMs: z.number().int().nullable(),
  url: z.string(),
  posterUrl: z.string(),
  submittedAt: z.string(),
});
export type AdminVideo = z.infer<typeof adminVideoSchema>;

export const videoDecisionSchema = z
  .object({
    approve: z.boolean(),
    reason: z.enum(videoRejectReasons).optional(),
  })
  .strict()
  .refine((v) => v.approve || v.reason !== undefined, {
    message: 'A rejection needs a reason',
    path: ['reason'],
  });
export type VideoDecision = z.infer<typeof videoDecisionSchema>;
