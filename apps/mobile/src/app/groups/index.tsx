// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { useGroups } from '../../lib/group-queries';
import { useInstance } from '../../lib/queries';
import { Button } from '../../components/Button';
import { useKeyboardMode } from '../../lib/focus-visible';
import { focusRing, radius, spacing, useColors } from '../../lib/theme';

/** Phase 76e: the community's interest groups. Who is in a group shows only inside it. */
function GroupsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const groups = useGroups();
  const keyboard = useKeyboardMode();
  // Phase 76f: members may propose a group when the community allows it.
  const canPropose = Boolean(useInstance().data?.community.memberGroups);
  if (groups.isPending) return <Loading />;
  return (
    <Screen back title={t('groups.title')}>
      <AppText variant="body">{t('groups.intro')}</AppText>
      {canPropose ? (
        <Button
          variant="secondary"
          label={t('groups.propose')}
          onPress={() => router.push('/groups/propose')}
        />
      ) : null}
      {groups.error ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {groups.data && groups.data.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('groups.empty')}
        </AppText>
      ) : null}
      <View role="list" style={styles.list}>
        {(groups.data ?? []).map((g) => (
          <View key={g.id} role="listitem">
            <Pressable
              // The visible text is the accessible name (WCAG 2.5.3).
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
              style={(state) => [
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
                keyboard && (state as { focused?: boolean }).focused && focusRing(colors),
              ]}
            >
              <AppText variant="heading">
                {g.emoji} {g.name}
              </AppText>
              {g.about ? (
                <AppText variant="body" tone="muted">
                  {g.about}
                </AppText>
              ) : null}
              <AppText variant="caption" tone={g.joined ? 'primary' : 'muted'}>
                {t('groups.memberCount', { count: g.members })}
                {g.joined ? ` · ✓ ${t('groups.joined')}` : ''}
                {g.archived ? ` · ${t('groups.closed')}` : ''}
                {g.status === 'pending' ? ` · ${t('groups.pending')}` : ''}
                {g.hosting ? ` · ${t('groups.youHost')}` : ''}
              </AppText>
            </Pressable>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs },
});

export default function GroupsRoute() {
  return (
    <RequireSession>
      <GroupsScreen />
    </RequireSession>
  );
}
