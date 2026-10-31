// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { Anthem, AnthemInput } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';

export const myAnthemKey = ['me', 'anthem'] as const;

/** Phase 76g: my song (null when I have none). */
export function useMyAnthem() {
  return useQuery({
    queryKey: myAnthemKey,
    queryFn: async () => (await apiFetch<{ anthem: Anthem | null }>('/v1/me/anthem')).anthem,
  });
}

export function useSaveAnthem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: AnthemInput | null) =>
      (
        await apiFetch<{ anthem: Anthem | null }>(
          '/v1/me/anthem',
          input ? { method: 'PUT', body: json(input) } : { method: 'DELETE' },
        )
      ).anthem,
    onSuccess: (anthem) => client.setQueryData(myAnthemKey, anthem),
  });
}
