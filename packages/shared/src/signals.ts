// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).

/** Receiver-side safety labels on what people write (messages, game answers, group posts). */
export const harmCategories = ['insult', 'sexual', 'threat'] as const;
export const scamSignals = [
  'money',
  'crypto',
  'gift_card',
  'off_platform',
  'link',
  /** Phase 65: threats to share images or tell people unless the person pays. */
  'extortion',
] as const;
export type ScamSignal = (typeof scamSignals)[number];

/**
 * Phase 77d: control characters, newlines and bidi overrides (which can visually reorder a line)
 * are never valid in short profile texts such as a song or a poll.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_TEXT = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
export const isPlainLine = (v: string): boolean => !UNSAFE_TEXT.test(v);
