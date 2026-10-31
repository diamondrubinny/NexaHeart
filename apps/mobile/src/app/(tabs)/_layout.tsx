// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/Loading';
import { authClient } from '../../lib/auth-client';
import { useDisplay } from '../../lib/display';
import { useMe } from '../../lib/queries';
import { routeFor } from '../../lib/routes';
import { fontFor } from '../../lib/fonts';
import { elevation, radius, useColors } from '../../lib/theme';
import { NoSession } from '../../components/ServerUnreachable';

const icons = {
  discover: 'discover',
  picks: 'picks',
  likes: 'likes',
  matches: 'matches',
  profile: 'profile',
} as const;
/** Easy mode (phase 25): three tabs; Picks and Likes open from Discover instead. */
const EASY_HIDDEN = new Set<keyof typeof icons>(['picks', 'likes']);

export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useColors();
  const { easy } = useDisplay();
  const insets = useSafeAreaInsets();
  const session = authClient.useSession();
  const me = useMe(Boolean(session.data));
  if (session.isPending || (session.data && me.isPending)) return <Loading />;
  if (!session.data) return <NoSession error={session.error} onRetry={session.refetch} />;
  if (me.data && routeFor(me.data) !== '/discover') return <Redirect href={routeFor(me.data)} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        // Phase 79: a raised bar; the current tab has a filled icon on a soft pill and a bolder
        // label, so it's marked by shape and weight, not color alone (WCAG 1.4.1).
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: (easy ? 88 : 72) + insets.bottom,
          paddingTop: 6,
          paddingBottom: 8 + insets.bottom,
          ...elevation.bar,
        },
        tabBarItemStyle: { paddingVertical: 2 },
        tabBarLabelStyle: { fontSize: easy ? 16 : 12, ...fontFor('500'), marginTop: 2 },
      }}
    >
      {(Object.keys(icons) as (keyof typeof icons)[]).map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            ...(easy && EASY_HIDDEN.has(name) ? { href: null } : {}),
            title: t(`tabs.${name}`),
            tabBarAccessibilityLabel: t(`tabs.${name}`),
            tabBarIcon: ({ focused }) => (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: focused ? colors.primarySoft : 'transparent',
                }}
              >
                <Icon
                  name={icons[name]}
                  color={focused ? colors.primary : colors.muted}
                  filled={focused}
                  background={colors.primarySoft}
                  size={easy ? 28 : 24}
                />
              </View>
            ),
            tabBarLabel: ({ focused, children }) => (
              <AppTabLabel
                color={focused ? colors.primary : colors.muted}
                focused={focused}
                easy={easy}
              >
                {children}
              </AppTabLabel>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

function AppTabLabel({
  color,
  focused,
  easy,
  children,
}: {
  color: string;
  focused: boolean;
  easy: boolean;
  children: string;
}) {
  return (
    <Text
      style={{
        color,
        fontSize: easy ? 16 : 12,
        lineHeight: easy ? 22 : 18,
        marginTop: 2,
        ...fontFor(focused ? '700' : '500'),
      }}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}
