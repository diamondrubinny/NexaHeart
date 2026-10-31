// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useActiveCheckin } from '../lib/checkin-queries';
import { useLocale } from '../lib/locale';
import { MIN_TOUCH, radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

/** A way into the safety check-in; shows the deadline while one is active. */
export function CheckinEntry() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const colors = useColors();
  const active = useActiveCheckin().data;
  const until = active
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(active.checkAt),
      )
    : null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push('/checkin')}
      style={[
        styles.card,
        {
          backgroundColor: active ? colors.primarySoft : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.badge,
            { backgroundColor: active ? colors.background : colors.primarySoft },
          ]}
        >
          <Icon
            name="shield"
            color={colors.primary}
            size={20}
            filled={Boolean(active)}
            background={colors.background}
          />
        </View>
        <View style={styles.text}>
          <AppText variant="label" tone={active ? 'primary' : 'default'}>
            {active ? t('checkin.banner', { time: until }) : t('checkin.entry')}
          </AppText>
          {active ? (
            <AppText variant="caption" tone="primary">
              {t('checkin.manage')}
            </AppText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: MIN_TOUCH,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xs },
});
