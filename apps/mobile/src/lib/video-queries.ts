// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { MyVideo, PromptKey } from '@nexaheart/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { apiFetch } from './api';

export const myVideoKey = ['me', 'video'] as const;
export type MyVideoItem = NonNullable<MyVideo['video']>;

/** Phase 76h: my video prompt; refreshed while it is scanned and re-encoded. */
export function useMyVideo() {
  return useQuery({
    queryKey: myVideoKey,
    queryFn: async () => (await apiFetch<MyVideo>('/v1/me/video')).video,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'quarantine' || status === 'processing' ? 2000 : false;
    },
  });
}

export interface PickedVideo {
  uri: string;
  mimeType: string | null;
  fileName: string | null;
  file: File | null;
}

export function useUploadVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ video, promptKey }: { video: PickedVideo; promptKey: PromptKey }) => {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const file = video.file ?? ((await (await fetch(video.uri)).blob()) as File);
        form.append('file', file, video.fileName ?? 'video.mp4');
      } else {
        form.append('file', {
          uri: video.uri,
          name: video.fileName ?? 'video.mp4',
          type: video.mimeType ?? 'video/mp4',
        } as unknown as Blob);
      }
      return (
        await apiFetch<MyVideo>(`/v1/me/video?promptKey=${encodeURIComponent(promptKey)}`, {
          method: 'POST',
          body: form,
        })
      ).video;
    },
    onSuccess: (video) => client.setQueryData(myVideoKey, video),
  });
}

export function useRemoveVideo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiFetch<MyVideo>('/v1/me/video', { method: 'DELETE' })).video,
    onSuccess: () => client.setQueryData(myVideoKey, null),
  });
}
