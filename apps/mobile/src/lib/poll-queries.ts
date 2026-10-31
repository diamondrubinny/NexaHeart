// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { ProfilePoll } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';

export const myPollKey = ['me', 'poll'] as const;

/** Phase 76d: my prompt poll (null when I have none). */
export function useMyPoll() {
  return useQuery({
    queryKey: myPollKey,
    queryFn: async () => (await apiFetch<{ poll: ProfilePoll | null }>('/v1/me/poll')).poll,
  });
}

export function useSavePoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (poll: ProfilePoll | null) =>
      (
        await apiFetch<{ poll: ProfilePoll | null }>(
          '/v1/me/poll',
          poll ? { method: 'PUT', body: json(poll) } : { method: 'DELETE' },
        )
      ).poll,
    onSuccess: (poll) => client.setQueryData(myPollKey, poll),
  });
}
