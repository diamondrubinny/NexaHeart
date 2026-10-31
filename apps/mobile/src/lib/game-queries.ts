// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MessageView, StartGameInput } from '@nexaheart/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, json } from './api';
import { chatKeys } from './realtime';

function useGameMutation<T>(matchId: string, fn: (arg: T) => Promise<MessageView>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: chatKeys.messages(matchId) }),
        client.invalidateQueries({ queryKey: chatKeys.conversations }),
      ]),
  });
}

/** Phase 76c: a new question in this chat (one open at a time). */
export const useStartGame = (matchId: string) =>
  useGameMutation(matchId, (input: StartGameInput) =>
    apiFetch<MessageView>(`/v1/matches/${matchId}/game`, { method: 'POST', body: json(input) }),
  );

/** Phase 76c: my answer; the other person's shows only once both answered. */
export const useAnswerGame = (matchId: string) =>
  useGameMutation(matchId, ({ id, answer }: { id: string; answer: string }) =>
    apiFetch<MessageView>(`/v1/games/${id}/answer`, { method: 'POST', body: json({ answer }) }),
  );
