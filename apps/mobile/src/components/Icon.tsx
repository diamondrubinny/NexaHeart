// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useLocale } from '../lib/locale';

/**
 * Phase 79: NexaHeart's own line icons. 24 px grid, 2 px rounded strokes; `filled` marks the current
 * tab. Always decorative: the button or tab around an icon carries the name.
 */
export type IconName =
  | 'discover'
  | 'picks'
  | 'likes'
  | 'matches'
  | 'profile'
  | 'back'
  | 'check'
  | 'play'
  | 'plus'
  | 'video'
  | 'shield'
  | 'settings'
  | 'alert'
  | 'sparkle';

/** Icons that point somewhere: mirrored in right-to-left languages. */
const directional = new Set<IconName>(['back']);

const SUN_RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    x1: r(12 + Math.cos(a) * 7.5),
    y1: r(12 + Math.sin(a) * 7.5),
    x2: r(12 + Math.cos(a) * 9.75),
    y2: r(12 + Math.sin(a) * 9.75),
  };
});

export function Icon({
  name,
  color,
  size = 24,
  filled = false,
  background = 'transparent',
}: {
  name: IconName;
  color: string;
  size?: number;
  filled?: boolean;
  /** The color behind a filled icon (inner details are drawn in it). */
  background?: string;
}) {
  const { direction } = useLocale();
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const fill = filled ? color : 'none';
  const inner = filled ? background : color;
  const flip = directional.has(name) && direction === 'rtl';
  const shape = (() => {
    switch (name) {
      case 'discover':
        return (
          <>
            <Circle cx={12} cy={12} r={9} {...stroke} fill={fill} />
            <Path d="M15.5 8.5l-2 5-5 2 2-5z" {...stroke} stroke={inner} fill={inner} />
          </>
        );
      case 'picks':
        return (
          <>
            <Circle cx={12} cy={12} r={4} {...stroke} fill={fill} />
            {SUN_RAYS.map((ray, i) => (
              <Line key={i} {...ray} {...stroke} />
            ))}
          </>
        );
      case 'likes':
        return (
          <Path
            d="M12 20s-7.2-4.4-8.9-8.9C1.9 7.8 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.9 1.2-1.8 2.8-2.9 4.8-2.9 3.3 0 5.3 3.3 4.1 6.6C19.2 15.6 12 20 12 20z"
            {...stroke}
            fill={fill}
          />
        );
      case 'matches':
        return (
          <>
            <Path
              d="M7 4h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5l-5 4v-4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"
              {...stroke}
              fill={fill}
            />
            {[8.5, 12, 15.5].map((cx) => (
              <Circle key={cx} cx={cx} cy={10} r={1.1} fill={inner} />
            ))}
          </>
        );
      case 'profile':
        return (
          <>
            <Circle cx={12} cy={8} r={4} {...stroke} fill={fill} />
            <Path d="M4.5 20.5c.8-3.9 3.9-6 7.5-6s6.7 2.1 7.5 6z" {...stroke} fill={fill} />
          </>
        );
      case 'sparkle':
        return (
          <Path
            d="M12 3c.9 4.6 3.4 7.1 8 8-4.6.9-7.1 3.4-8 8-.9-4.6-3.4-7.1-8-8 4.6-.9 7.1-3.4 8-8z"
            {...stroke}
            fill={fill}
          />
        );
      case 'alert':
        return (
          <>
            <Circle cx={12} cy={12} r={9} {...stroke} />
            <Path d="M12 7.5v5.5" {...stroke} />
            <Circle cx={12} cy={16.5} r={1.2} fill={color} />
          </>
        );
      case 'back':
        return <Path d="M15 5l-7 7 7 7" {...stroke} />;
      case 'check':
        return <Path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} />;
      case 'play':
        return <Path d="M8 5.5v13l11-6.5z" {...stroke} fill={color} />;
      case 'plus':
        return <Path d="M12 5v14M5 12h14" {...stroke} />;
      case 'video':
        return (
          <>
            <Path
              d="M5 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
              {...stroke}
              fill={fill}
            />
            <Path d="M16 10.5l5-3v9l-5-3" {...stroke} />
          </>
        );
      case 'shield':
        return (
          <Path
            d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"
            {...stroke}
            fill={fill}
          />
        );
      case 'settings':
        return (
          <>
            <Circle cx={12} cy={12} r={3} {...stroke} />
            <Path
              d="M12 2.5l1.6 2.3 2.7-.7.7 2.7 2.7.8-.7 2.7 2 1.7-2 1.7.7 2.7-2.7.8-.7 2.7-2.7-.7L12 21.5l-1.6-2.3-2.7.7-.7-2.7-2.7-.8.7-2.7-2-1.7 2-1.7-.7-2.7 2.7-.8.7-2.7 2.7.7z"
              {...stroke}
            />
          </>
        );
    }
  })();
  return (
    // Hidden from assistive technology: the control around it is named.
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, transform: flip ? [{ scaleX: -1 }] : [] }}
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {shape}
      </Svg>
    </View>
  );
}
