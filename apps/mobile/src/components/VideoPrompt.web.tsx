// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { cuesToVtt, type VideoCaptions } from '@nexaheart/shared';
import { createElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { mediaUrl } from '../lib/api';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { RemoteImage } from './RemoteImage';
import { VideoWords } from './VideoWords';
import { formatSeconds } from './VoicePlayer';

export interface VideoPromptProps {
  url: string;
  posterUrl: string;
  /** The prompt it answers: the video's text alternative. */
  label: string;
  durationMs: number | null;
  /** Phase 80: captions approved with the video. */
  captions?: VideoCaptions | null;
}

/**
 * Phase 76h, web: the poster with a play button; then the browser's own player (labelled controls,
 * keyboard), starting muted. Never plays by itself.
 */
/** Browsers without H.264 (some Linux builds) get the WebM rendition. */
function source(url: string): string {
  const probe = typeof document === 'undefined' ? null : document.createElement('video');
  const h264 = probe?.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  return mediaUrl(h264 || !probe ? url : `${url}?format=webm`);
}

export function VideoPrompt(props: VideoPromptProps) {
  return (
    <View style={styles.stack}>
      <VideoBox {...props} />
      {props.captions ? <VideoWords captions={props.captions} /> : null}
    </View>
  );
}

function VideoBox({ url, posterUrl, label, durationMs, captions }: VideoPromptProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const [playing, setPlaying] = useState(false);
  // Phase 80: the captions as a WebVTT track from a local blob (the text is escaped when the track
  // is built), so the player shows them, on by default.
  const [track, setTrack] = useState<string | null>(null);
  useEffect(() => {
    if (!captions || typeof URL === 'undefined') return setTrack(null);
    const url = URL.createObjectURL(new Blob([cuesToVtt(captions.cues)], { type: 'text/vtt' }));
    setTrack(url);
    return () => URL.revokeObjectURL(url);
  }, [captions]);
  if (playing) {
    return createElement(
      'video',
      {
        src: source(url),
        poster: mediaUrl(posterUrl),
        controls: true,
        autoPlay: true,
        muted: true,
        playsInline: true,
        preload: 'metadata',
        controlsList: 'nodownload noremoteplayback',
        disablePictureInPicture: true,
        'aria-label': label,
        'data-testid': 'video-player',
        style: { width: '100%', maxHeight: 420, borderRadius: radius.md, background: '#000' },
      },
      track && captions
        ? createElement('track', {
            kind: 'captions',
            src: track,
            srcLang: captions.lang,
            label: t('video.captions'),
            default: true,
          })
        : null,
    );
  }
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
  stack: { gap: spacing.sm },
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
