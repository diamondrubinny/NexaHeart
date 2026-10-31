// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { luminance, mix } from '../src/lib/color';
import { dark, light } from '../src/lib/tokens';

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('hero gradient (phase 79)', () => {
  it('never lowers the contrast of the text on it, light or dark, for any brand color', () => {
    const brands = [
      light.primary,
      dark.primary,
      '#0F766E',
      '#B42318',
      '#1D4ED8',
      '#9333EA',
      '#C4B5FD',
    ];
    for (const brand of brands) {
      for (const text of [light.onPrimary, dark.onPrimary]) {
        const lightText = luminance(text) > luminance(brand);
        const end = mix(brand, lightText ? 'black' : 'white', 0.35);
        expect(contrast(end, text)).toBeGreaterThanOrEqual(contrast(brand, text));
      }
    }
  });

  it('mixes channels toward black or white', () => {
    expect(mix('#808080', 'black', 1)).toBe('#000000');
    expect(mix('#808080', 'white', 1)).toBe('#ffffff');
    expect(mix('#6d28d9', 'black', 0)).toBe('#6d28d9');
  });
});
