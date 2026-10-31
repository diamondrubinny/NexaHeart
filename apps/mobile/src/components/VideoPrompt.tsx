// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { mediaUrl } from '../lib/api';
import { radius, useColors } from '../lib/theme';
import { useSessionCookie } from '../lib/use-cookie';
import { AppText } from './AppText';
import { RemoteImage } from './RemoteImage';
import { formatSeconds } from './VoicePlayer';

export interface VideoPromptProps {
  url: string;
  posterUrl: string;
  /** The prompt it answers: the video's text alternative. */
  label: string;
  durationMs: number | null;
}

function Player({ url, label }: { url: string; label: string }) {
  const cookie = useSessionCookie();
  // Native apps send the session cookie explicitly; nothing is cached on the device.
  const player = useVideoPlayer(
    { uri: mediaUrl(url), ...(cookie ? { headers: { cookie } } : {}) },
    (p) => {
      p.muted = true;
      p.play();
    },
  );
  return (
    <VideoView
      player={player}
      nativeControls
      allowsPictureInPicture={false}
      accessibilityLabel={label}
      style={styles.poster}
      contentFit="contain"
    />
  );
}

/** Phase 76h: the poster with a play button; then the system player, starting muted. */
export function VideoPrompt({ url, posterUrl, label, durationMs }: VideoPromptProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const [playing, setPlaying] = useState(false);
  if (playing) return <Player url={url} label={label} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('video.play', {
        prompt: label,
        duration: formatSeconds(durationMs ?? 0),
      })}
      onPress={() => setPlaying(true)}
      style={styles.poster}
      testID="video-poster"
    >
      <RemoteImage path={posterUrl} label="" style={styles.image} />
      <View style={[styles.play, { backgroundColor: colors.primary }]}>
        <AppText variant="heading" style={{ color: colors.onPrimary }}>
          ▶
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  poster: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    width: 56,
    height: 56,
    marginTop: -28,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
