// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { luminance, mix } from '../lib/color';

/**
 * Phase 79: the brand color as a diagonal gradient with two soft circles. The gradient only moves
 * away from the text color (darker under light text, lighter under dark text, as in dark mode), so
 * text on it keeps at least the brand color's own contrast.
 */
export function HeroBackground({ color, textColor }: { color: string; textColor: string }) {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const from = hex.test(color) ? color : '#6D28D9';
  const lightText = hex.test(textColor) ? luminance(textColor) > luminance(from) : true;
  const toward = lightText ? 'black' : 'white';
  const tint = lightText ? '#000000' : '#FFFFFF';
  return (
    <View
      style={StyleSheet.absoluteFill}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={mix(from, toward, 0.35)} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#hero)" />
        <Circle cx="92%" cy="8%" r="90" fill={tint} fillOpacity={0.08} />
        <Circle cx="4%" cy="100%" r="70" fill={tint} fillOpacity={0.1} />
      </Svg>
    </View>
  );
}
