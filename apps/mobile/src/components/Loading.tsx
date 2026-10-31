// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useColors } from '../lib/theme';

export function Loading() {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    // The name goes on the progressbar itself: on a plain View an aria-label is not allowed (axe
    // aria-prohibited-attr), and an unnamed progressbar fails aria-progressbar-name.
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <ActivityIndicator
        size="large"
        color={colors.primary}
        accessibilityLabel={t('common.loading')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
