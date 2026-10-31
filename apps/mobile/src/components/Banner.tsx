// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export function Banner({ tone, message }: { tone: 'error' | 'success' | 'info'; message: string }) {
  const colors = useColors();
  const palette = {
    error: { bg: colors.dangerSoft, fg: 'danger' as const, edge: colors.danger },
    success: { bg: colors.successSoft, fg: 'success' as const, edge: colors.success },
    info: { bg: colors.primarySoft, fg: 'primary' as const, edge: colors.primary },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      // Phase 79: a colored edge at the start, and an icon for success and errors, so the tone
      // isn't carried by color alone.
      style={[styles.box, { backgroundColor: palette.bg, borderStartColor: palette.edge }]}
    >
      {tone !== 'info' ? (
        <Icon name={tone === 'success' ? 'check' : 'alert'} color={palette.edge} size={20} />
      ) : null}
      <AppText variant="label" tone={palette.fg} style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderStartWidth: 4,
  },
  text: { flex: 1 },
});
