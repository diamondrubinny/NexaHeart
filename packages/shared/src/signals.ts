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
