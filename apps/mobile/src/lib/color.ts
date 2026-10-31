// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).

/** Mixes a #RRGGBB color toward black or white (amount 0..1). */
export function mix(hex: string, toward: 'black' | 'white', amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const target = toward === 'white' ? 255 : 0;
  const channel = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (target - v) * amount);
  };
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance (WCAG) of #RRGGBB. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (shift: number) => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(16) + 0.7152 * lin(8) + 0.0722 * lin(0);
}
