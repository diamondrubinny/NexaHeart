// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
// One file per weight: the package's index would bundle all 18 styles (~3.6 MB).
import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { Platform } from 'react-native';

/**
 * Phase 79: Rubik, one family for Hebrew, Arabic, Cyrillic and Latin (SIL Open Font License).
 * The files are bundled with the app and served by this server: no request to Google.
 */
export const fontAssets = { Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold };

export type FontWeight = '400' | '500' | '600' | '700';

const families: Record<FontWeight, keyof typeof fontAssets> = {
  '400': 'Rubik_400Regular',
  '500': 'Rubik_500Medium',
  '600': 'Rubik_600SemiBold',
  '700': 'Rubik_700Bold',
};

/**
 * One family per weight: each file is registered as its own family, without a weight descriptor, so
 * no `fontWeight` goes with Rubik (the browser would draw a synthetic bold on top of the bold file).
 */
export function fontFor(weight: FontWeight): { fontFamily: string } {
  const family = families[weight];
  return Platform.OS === 'web'
    ? { fontFamily: `${family}, system-ui, -apple-system, "Segoe UI", sans-serif` }
    : { fontFamily: family };
}
