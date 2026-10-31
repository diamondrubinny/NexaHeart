// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { GROUP_POST_MAX, type GroupPost } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { RemoteImage } from '../../components/RemoteImage';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import {
  useDeleteGroupPost,
  useGroup,
  useGroupPosts,
  useJoinGroup,
  useLeaveGroup,
  usePostToGroup,
} from '../../lib/group-queries';
import { useLocale } from '../../lib/locale';
import { radius, spacing, useColors } from '../../lib/theme';

/**
 * Phase 76e: one interest group. Members see each other and the board; others see only what the
 * group is about. Posts are harm-checked on the server; anyone can report a post (it is copied as
 * evidence into an ordinary report).
 */
function GroupScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { locale } = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const joined = Boolean(group.data?.group.joined);
  const posts = useGroupPosts(id, joined);
  const join = useJoinGroup(id);
  const leave = useLeaveGroup(id);
  const write = usePostToGroup(id);
  const remove = useDeleteGroupPost(id);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();

  if (group.isPending) return <Loading />;
  if (!group.data) {
    return (
      <Screen back title={t('groups.title')}>
        <Banner tone="error" message={t('groups.gone')} />
      </Screen>
    );
  }
  const { group: g, members } = group.data;
  const full = !g.joined && g.members >= g.capacity;

  const send = () => {
    const text = body.trim();
    if (!text) return setError(t('groups.empty'));
    setError(undefined);
    write.mutate(text, {
      onSuccess: () => setBody(''),
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 422
            ? t('groups.kinder')
            : t('common.genericError'),
        ),
    });
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const Post = ({ post }: { post: GroupPost }) => (
    <View
      role="listitem"
      style={[styles.post, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="group-post"
    >
      <View style={styles.author}>
        {post.author.photoUrl ? (
          <RemoteImage path={post.author.photoUrl} label="" style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]} />
        )}
        <AppText variant="label">{post.author.displayName}</AppText>
        <AppText variant="caption" tone="muted">
          {when(post.createdAt)}
        </AppText>
      </View>
      {post.scam.length > 0 ? <Banner tone="error" message={t('chat.scamBody')} /> : null}
      <AppText variant="body" userContent selectable>
        {post.body}
      </AppText>
      {post.mine ? (
        <Button
          variant="dangerGhost"
          label={t('groups.deletePost')}
          loading={remove.isPending && remove.variables === post.id}
          onPress={() => remove.mutate(post.id)}
        />
      ) : (
        <Button
          variant="ghost"
          label={t('groups.reportPost')}
          hint={post.author.displayName}
          onPress={() =>
            router.push({
              pathname: '/report/[id]',
              params: {
                id: post.author.userId,
                name: post.author.displayName,
                groupPostId: post.id,
              },
            })
          }
        />
      )}
    </View>
  );

  return (
    <Screen back title={`${g.emoji} ${g.name}`}>
      {g.about ? <AppText variant="body">{g.about}</AppText> : null}
      <AppText variant="caption" tone="muted">
        {t('groups.memberCount', { count: g.members })}
        {g.archived ? ` · ${t('groups.closed')}` : ''}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}

      {!g.joined ? (
        <>
          <AppText variant="caption" tone="muted">
            {t('groups.privacy')}
          </AppText>
          <Button
            label={full ? t('groups.full') : t('groups.join')}
            disabled={full}
            loading={join.isPending}
            onPress={() =>
              join.mutate(undefined, {
                onError: () => setError(t('common.genericError')),
              })
            }
          />
        </>
      ) : (
        <>
          {members.length > 0 ? (
            <View style={styles.section}>
              <AppText variant="heading" accessibilityRole="header">
                {t('groups.members')}
              </AppText>
              <AppText variant="body">{members.map((m) => m.displayName).join(', ')}</AppText>
            </View>
          ) : null}

          {!g.archived ? (
            <View style={styles.section}>
              <TextField
                label={t('groups.write')}
                hint={t('groups.writeHint', { max: GROUP_POST_MAX })}
                value={body}
                onChangeText={setBody}
                maxLength={GROUP_POST_MAX}
                multiline
              />
              <Button label={t('groups.post')} loading={write.isPending} onPress={send} />
            </View>
          ) : null}

          <View style={styles.section}>
            <AppText variant="heading" accessibilityRole="header">
              {t('groups.board')}
            </AppText>
            {posts.data && posts.data.posts.length === 0 ? (
              <AppText variant="body" tone="muted">
                {t('groups.noPosts')}
              </AppText>
            ) : null}
            <View role="list" style={styles.posts}>
              {(posts.data?.posts ?? []).map((p) => (
                <Post key={p.id} post={p} />
              ))}
            </View>
          </View>

          <Button
            variant="ghost"
            label={t('groups.leave')}
            loading={leave.isPending}
            onPress={() => leave.mutate(undefined, { onSuccess: () => router.replace('/groups') })}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  posts: { gap: spacing.md },
  post: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  avatar: { width: 32, height: 32, borderRadius: 16 },
});

export default function GroupRoute() {
  return (
    <RequireSession>
      <GroupScreen />
    </RequireSession>
  );
}
