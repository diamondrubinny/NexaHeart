// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { promptKeySchema } from './profile.js';
import { isPlainLine } from './signals.js';
import { transcriptLangSchema } from './transcripts.js';

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
  /** Phase 77e: frames larger than the worker decodes. */
  'too_large',
  'nudity',
  'other_people',
  'not_the_member',
  'offensive',
  'banned_photo',
  'other',
] as const;
export type VideoRejectReason = (typeof videoRejectReasons)[number];

// ---------------------------------------------------------------- captions (phase 80)

/** At most this many timed lines, each at most this long. */
export const MAX_VIDEO_CUES = 40;
export const MAX_CUE_LENGTH = 200;

export const videoCueSchema = z.object({
  /** Milliseconds from the start of the video. */
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string().min(1).max(MAX_CUE_LENGTH),
});
export type VideoCue = z.infer<typeof videoCueSchema>;

/** What viewers get: the language the words are in, and the timed lines. */
export const videoCaptionsSchema = z.object({
  lang: transcriptLangSchema,
  cues: z.array(videoCueSchema).max(MAX_VIDEO_CUES),
});
export type VideoCaptions = z.infer<typeof videoCaptionsSchema>;

/**
 * pending: being made · done: there are lines · none: no speech found (or no sound) ·
 * failed: the model failed · off: the owner turned them off, or transcripts aren't allowed.
 */
export const captionStatuses = ['pending', 'done', 'none', 'failed', 'off'] as const;
export type CaptionStatus = (typeof captionStatuses)[number];

/** The owner corrects the words (the timing stays), or turns captions off with `null`. */
export const captionsInputSchema = z
  .object({
    lines: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(MAX_CUE_LENGTH)
          .refine(isPlainLine, { message: 'Plain text only' }),
      )
      .min(1)
      .max(MAX_VIDEO_CUES)
      .nullable(),
  })
  .strict();
export type CaptionsInput = z.infer<typeof captionsInputSchema>;

// eslint-disable-next-line no-control-regex -- removing control and bidi characters is the point
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

/** About two caption lines: longer chunks are split at word boundaries. */
export const CUE_TARGET_LENGTH = 84;

function splitLine(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    // A "word" longer than a line (no spaces) is cut.
    const pieces = word.match(new RegExp(`.{1,${CUE_TARGET_LENGTH}}`, 'gu')) ?? [];
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > CUE_TARGET_LENGTH) {
        parts.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Timed chunks from the speech model (seconds; the last end may be missing) as clean cues: plain
 * single-line text, inside the video, in order, bounded in number and length.
 */
export function normalizeCues(
  chunks: { start: number; end: number | null; text: string }[],
  durationMs: number,
): VideoCue[] {
  const cues: VideoCue[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (!text || !Number.isFinite(chunk.start)) continue;
    const previous = cues.at(-1);
    const startAt = Math.max(0, Math.min(Math.round(chunk.start * 1000), durationMs));
    // The model sometimes repeats itself from an earlier time: dropped. Overlaps are closed.
    if (previous && startAt < previous.start) continue;
    const start = previous ? Math.max(startAt, previous.end) : startAt;
    const rawEnd =
      chunk.end !== null && Number.isFinite(chunk.end) ? Math.round(chunk.end * 1000) : durationMs;
    const end = Math.max(start + 1, Math.min(rawEnd, Math.max(durationMs, start + 1)));
    // A long chunk becomes several short lines, the time shared by length.
    const parts = splitLine(text);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let from = start;
    let used = 0;
    for (const part of parts) {
      used += part.length;
      const to = Math.max(from + 1, start + Math.round(((end - start) * used) / total));
      cues.push({ start: from, end: to, text: part });
      from = to;
      if (cues.length === MAX_VIDEO_CUES) return cues;
    }
  }
  return cues;
}

const vttTime = (ms: number) => {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
};

/**
 * A WebVTT track from cues. The text is escaped (`&`, `<`, `>`), so it can't open tags, write
 * `-->` or start another cue; line breaks and control characters are removed.
 */
export function cuesToVtt(cues: VideoCue[]): string {
  const lines = ['WEBVTT', ''];
  for (const cue of cues) {
    const text = cue.text
      .replace(UNSAFE_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (!text) continue;
    lines.push(`${vttTime(cue.start)} --> ${vttTime(Math.max(cue.end, cue.start + 1))}`, text, '');
  }
  return lines.join('\n');
}

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
      /** Phase 80: the words of the video; `cues` only when the status is `done`. */
      captions: z.object({
        status: z.enum(captionStatuses),
        lang: transcriptLangSchema.nullable(),
        cues: z.array(videoCueSchema),
      }),
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
  /** Phase 80: captions, approved with the video; null when there are none. */
  captions: videoCaptionsSchema.nullable().optional(),
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
  /** Phase 80: the captions to approve with the video, and what the harm filter saw in them. */
  captions: videoCaptionsSchema.nullable(),
  captionFlags: z.array(z.string()),
  /** Sent back with an approval, so words changed meanwhile aren't approved unseen. */
  captionsVersion: z.string(),
});
export type AdminVideo = z.infer<typeof adminVideoSchema>;

export const videoDecisionSchema = z
  .object({
    approve: z.boolean(),
    reason: z.enum(videoRejectReasons).optional(),
    /** Phase 80: the captions the moderator saw; an approval of other words is refused. */
    captionsVersion: z.string().max(64).optional(),
  })
  .strict()
  .refine((v) => v.approve || v.reason !== undefined, {
    message: 'A rejection needs a reason',
    path: ['reason'],
  });
export type VideoDecision = z.infer<typeof videoDecisionSchema>;
