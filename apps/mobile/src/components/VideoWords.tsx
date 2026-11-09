// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { VideoCaptions } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../lib/theme';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * Phase 80: the words of a video as text, for anyone who can't or doesn't want to listen (and for
 * the native apps, where the player shows no captions track). Closed until asked for.
 */
export function VideoWords({ captions }: { captions: VideoCaptions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.box}>
      <Button
        variant="ghost"
        size="sm"
        label={open ? t('video.hideWords') : t('video.showWords')}
        aria-expanded={open}
        onPress={() => setOpen((value) => !value)}
      />
      {open ? (
        <View testID="video-words" style={styles.lines}>
          <AppText variant="caption" tone="muted">
            {t('video.wordsAutomatic')}
          </AppText>
          {captions.cues.map((cue) => (
            // Someone's own words: their direction follows the text.
            <AppText key={cue.start} variant="body" userContent>
              {cue.text}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, alignItems: 'flex-start' },
  lines: { gap: spacing.xs, alignSelf: 'stretch' },
});
