// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type {
  CrushResult,
  Group,
  GroupDetail,
  GroupPost,
  GroupPosts,
  GroupProposal,
} from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';

/** Phase 76e: interest groups. */
export const groupKeys = {
  list: ['groups'] as const,
  detail: (id: string) => ['groups', id] as const,
  posts: (id: string) => ['groups', id, 'posts'] as const,
};

export function useGroups() {
  return useQuery({
    queryKey: groupKeys.list,
    queryFn: async () => (await apiFetch<{ groups: Group[] }>('/v1/groups')).groups,
  });
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: groupKeys.detail(id),
    queryFn: () => apiFetch<GroupDetail>(`/v1/groups/${id}`),
  });
}

export function useGroupPosts(id: string, enabled: boolean) {
  return useQuery({
    queryKey: groupKeys.posts(id),
    queryFn: () => apiFetch<GroupPosts>(`/v1/groups/${id}/posts`),
    enabled,
  });
}

function useGroupMutation<T, R>(id: string, fn: (arg: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: groupKeys.list }),
  });
}

export const useJoinGroup = (id: string) =>
  useGroupMutation(id, () => apiFetch<GroupDetail>(`/v1/groups/${id}/join`, { method: 'POST' }));

export const useLeaveGroup = (id: string) =>
  useGroupMutation(id, () => apiFetch<void>(`/v1/groups/${id}/leave`, { method: 'POST' }));

export const usePostToGroup = (id: string) =>
  useGroupMutation(id, (body: string) =>
    apiFetch<GroupPost>(`/v1/groups/${id}/posts`, { method: 'POST', body: json({ body }) }),
  );

export const useDeleteGroupPost = (id: string) =>
  useGroupMutation(id, (postId: string) =>
    apiFetch<void>(`/v1/group-posts/${postId}`, { method: 'DELETE' }),
  );

/** Phase 76f: propose a group (the admins approve it). */
export function useProposeGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupProposal) =>
      apiFetch<Group>('/v1/groups/proposals', { method: 'POST', body: json(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: groupKeys.list }),
  });
}

/** Phase 76f: the host removes a post in their group. */
export const useHostRemovePost = (id: string) =>
  useGroupMutation(id, (postId: string) =>
    apiFetch<void>(`/v1/group-posts/${postId}/remove`, { method: 'POST' }),
  );

/** Phase 76f: a secret crush (or take it back). A match only when it's mutual. */
export const useCrush = (id: string) =>
  useGroupMutation(id, ({ userId, on }: { userId: string; on: boolean }) =>
    apiFetch<CrushResult>(`/v1/groups/${id}/crush/${encodeURIComponent(userId)}`, {
      method: on ? 'PUT' : 'DELETE',
    }),
  );
