// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import {
  captionsInputSchema,
  CUE_TARGET_LENGTH,
  cuesToVtt,
  MAX_CUE_LENGTH,
  MAX_VIDEO_CUES,
  normalizeCues,
} from '../src/video.js';

describe('video captions (phase 80)', () => {
  it('builds a WebVTT track with times', () => {
    expect(
      cuesToVtt([
        { start: 0, end: 1500, text: 'Hello there' },
        { start: 61_250, end: 3_600_500, text: 'שלום' },
      ]),
    ).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello there\n\n00:01:01.250 --> 01:00:00.500\nשלום\n',
    );
  });

  it('escapes the text: no tags, no arrows, no extra cues', () => {
    const vtt = cuesToVtt([
      {
        start: 0,
        end: 1000,
        text: '<v Eve>hi</v> & bye\n\n00:00:05.000 --> 00:00:09.000\ninjected‮',
      },
    ]);
    expect(vtt.match(/-->/g)).toHaveLength(1);
    expect(vtt).not.toContain('<');
    expect(vtt).toContain('&lt;v Eve&gt;hi&lt;/v&gt; &amp; bye 00:00:05.000 --&gt; 00:00:09.000');
    expect(vtt).not.toContain('‮');
    expect(vtt.split('\n\n')).toHaveLength(2);
  });

  it('cleans what the model returns: order, bounds, length, empty lines', () => {
    const cues = normalizeCues(
      [
        { start: 1, end: 2, text: '  Hello\n world ' },
        { start: 0, end: 3, text: 'goes back in time' },
        { start: 1.5, end: 4, text: 'overlaps' },
        { start: 4, end: 5, text: '   ' },
        { start: 99, end: 120, text: 'past the end' },
      ],
      30_000,
    );
    expect(cues).toEqual([
      { start: 1000, end: 2000, text: 'Hello world' },
      { start: 2000, end: 4000, text: 'overlaps' },
      { start: 30_000, end: 30_001, text: 'past the end' },
    ]);
    // A long chunk with no end time: short lines that share the time up to the end of the video.
    const sentence = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const split = normalizeCues([{ start: 10, end: null, text: sentence }], 30_000);
    expect(split.length).toBeGreaterThan(2);
    expect(split.every((c) => c.text.length <= CUE_TARGET_LENGTH && c.end > c.start)).toBe(true);
    expect(split.map((c) => c.text).join(' ')).toBe(sentence);
    expect(split[0]!.start).toBe(10_000);
    expect(split.at(-1)!.end).toBe(30_000);
    expect(split.every((c, i) => i === 0 || c.start === split[i - 1]!.end)).toBe(true);
    expect(normalizeCues([{ start: 0, end: 1, text: 'x'.repeat(200) }], 5000)).toHaveLength(3);
    const many = normalizeCues(
      Array.from({ length: 100 }, (_, i) => ({ start: i, end: i + 1, text: 'a' })),
      200_000,
    );
    expect(many).toHaveLength(MAX_VIDEO_CUES);
  });

  it('accepts corrected lines or null, and nothing else', () => {
    expect(captionsInputSchema.safeParse({ lines: ['Hi', 'there'] }).success).toBe(true);
    expect(captionsInputSchema.safeParse({ lines: null }).success).toBe(true);
    for (const bad of [
      { lines: [] },
      { lines: [''] },
      { lines: ['a‮b'] },
      { lines: ['two\nlines'] },
      { lines: ['ok'], extra: 1 },
      { lines: ['x'.repeat(MAX_CUE_LENGTH + 1)] },
    ]) {
      expect(captionsInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
