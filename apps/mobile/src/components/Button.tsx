// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { useKeyboardMode } from '../lib/focus-visible';
import { useDisplay } from '../lib/display';
import { fontFor } from '../lib/fonts';
import {
  EASY_TOUCH,
  MIN_TOUCH,
  elevation,
  focusRing,
  radius,
  spacing,
  useColors,
} from '../lib/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
  /** `sm` only for dense lists; still a 40 px target. */
  size?: 'md' | 'sm';
  /** A decorative icon before the label (the label stays the accessible name). */
  icon?: IconName;
  loading?: boolean;
  /** Short hint read by screen readers after the label. */
  hint?: string;
}

/**
 * Phase 79: one button for the whole app. Hierarchy by fill: primary (solid, raised), secondary
 * (soft), ghost (outline), danger. Hover on the web, a slight press-in (none with reduce motion).
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  hint,
  ...rest
}: ButtonProps) {
  const colors = useColors();
  const keyboard = useKeyboardMode();
  const { easy, motionOff } = useDisplay();
  const isDisabled = Boolean(disabled || loading);
  const palette = {
    primary: { bg: colors.primary, fg: 'onPrimary' as const, border: colors.primary },
    secondary: { bg: colors.primarySoft, fg: 'primary' as const, border: colors.primarySoft },
    ghost: { bg: 'transparent', fg: 'primary' as const, border: colors.control },
    danger: { bg: colors.danger, fg: 'onPrimary' as const, border: colors.danger },
    dangerGhost: { bg: 'transparent', fg: 'danger' as const, border: colors.danger },
  }[variant];
  const solid = variant === 'primary' || variant === 'danger';
  const fgColor = solid
    ? colors.onPrimary
    : variant === 'dangerGhost'
      ? colors.danger
      : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : {})}
      aria-disabled={isDisabled}
      aria-busy={Boolean(loading)}
      disabled={isDisabled}
      style={(state) => {
        const { focused, hovered } = state as { focused?: boolean; hovered?: boolean };
        return [
          styles.base,
          size === 'sm' && !easy && styles.small,
          easy && styles.easy,
          { backgroundColor: palette.bg, borderColor: palette.border },
          solid && !isDisabled && elevation.raised,
          hovered &&
            !isDisabled &&
            (solid ? styles.hoverSolid : { backgroundColor: colors.primarySoft }),
          state.pressed && !motionOff && styles.pressed,
          state.pressed && styles.pressedTone,
          isDisabled && styles.disabled,
          keyboard && focused && focusRing(colors),
        ];
      }}
      {...rest}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={fgColor} />
        ) : icon ? (
          <Icon name={icon} color={fgColor} size={size === 'sm' && !easy ? 18 : 20} />
        ) : null}
        <AppText variant="label" tone={palette.fg} center style={fontFor('600')}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  small: { minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  easy: { minHeight: EASY_TOUCH, paddingVertical: spacing.md },
  hoverSolid: { opacity: 0.94 },
  pressed: { transform: [{ scale: 0.98 }] },
  pressedTone: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
