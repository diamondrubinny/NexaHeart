// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  MAX_CUE_LENGTH,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  promptKeys,
  type PromptKey,
} from '@nexaheart/shared';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { VideoPrompt } from '../components/VideoPrompt';
import { formatSeconds } from '../components/VoicePlayer';
import { useLocale } from '../lib/locale';
import { ApiRequestError } from '../lib/api';
import { spacing } from '../lib/theme';
import {
  useMyVideo,
  useRemoveVideo,
  useSaveCaptions,
  useUploadVideo,
  type MyVideoItem,
} from '../lib/video-queries';

function Status({ video }: { video: MyVideoItem }) {
  const { t } = useTranslation();
  if (video.status === 'quarantine' || video.status === 'processing') {
    return <Banner tone="info" message={t('video.processing')} />;
  }
  if (video.status === 'review') return <Banner tone="info" message={t('video.review')} />;
  if (video.status === 'rejected') {
    return (
      <Banner
        tone="error"
        message={t('video.rejected', {
          reason: t(`video.reasons.${video.rejectReason ?? 'other'}`),
        })}
      />
    );
  }
  return <Banner tone="success" message={t('video.approved')} />;
}

/**
 * Phase 80: the automatic captions, for the owner to read, correct or turn off. The timing stays;
 * only the words change.
 */
function CaptionsEditor({ video }: { video: MyVideoItem }) {
  const { t } = useTranslation();
  const save = useSaveCaptions();
  const { status, cues } = video.captions;
  const [lines, setLines] = useState(() => cues.map((cue) => cue.text));
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string }>();
  if (status === 'off') return null;
  const submit = (next: string[] | null) => {
    setNotice(undefined);
    if (next && next.some((line) => !line.trim())) {
      return setNotice({ tone: 'error', message: t('video.captionsEmptyLine') });
    }
    save.mutate(next, {
      onSuccess: (saved) =>
        setNotice({
          tone: 'success',
          message:
            next === null
              ? t('video.captionsOffDone')
              : saved?.status === 'review' && video.status === 'clean'
                ? t('video.captionsSavedReview')
                : t('video.captionsSaved'),
        }),
      onError: (e) =>
        setNotice({
          tone: 'error',
          message:
            e instanceof ApiRequestError && e.status === 422
              ? t('video.captionsKinder')
              : t('common.genericError'),
        }),
    });
  };
  return (
    <View style={styles.preview}>
      <AppText variant="heading">{t('video.captions')}</AppText>
      {status === 'pending' ? <Banner tone="info" message={t('video.captionsPending')} /> : null}
      {status === 'none' ? (
        <AppText variant="body" tone="muted">
          {t('video.captionsNone')}
        </AppText>
      ) : null}
      {status === 'failed' ? (
        <AppText variant="body" tone="muted">
          {t('video.captionsFailed')}
        </AppText>
      ) : null}
      {status === 'done' ? (
        <>
          <AppText variant="body">{t('video.captionsIntro')}</AppText>
          {video.status === 'clean' ? (
            <AppText variant="caption" tone="muted">
              {t('video.captionsReviewNote')}
            </AppText>
          ) : null}
          {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
          {cues.map((cue, i) => (
            <TextField
              key={cue.start}
              label={t('video.captionLine', { n: i + 1, time: formatSeconds(cue.start) })}
              value={lines[i] ?? ''}
              maxLength={MAX_CUE_LENGTH}
              onChangeText={(text) =>
                setLines((current) => current.map((line, at) => (at === i ? text : line)))
              }
            />
          ))}
          <Button
            variant="secondary"
            label={t('video.captionsSave')}
            loading={save.isPending}
            onPress={() => submit(lines.map((line) => line.trim()))}
          />
          <Button
            variant="ghost"
            label={t('video.captionsOff')}
            disabled={save.isPending}
            onPress={() => submit(null)}
          />
        </>
      ) : notice ? (
        <Banner tone={notice.tone} message={notice.message} />
      ) : null}
    </View>
  );
}

/** Phase 76h: one short video answering a prompt, shown after a moderator approves it. */
function EditVideo() {
  const { t } = useTranslation();
  const mine = useMyVideo();
  const upload = useUploadVideo();
  const remove = useRemoveVideo();
  const [promptKey, setPromptKey] = useState<PromptKey>();
  const [error, setError] = useState<string>();
  const { locale } = useLocale();
  if (mine.isPending) return <Loading />;
  const video = mine.data ?? null;
  const chosen = promptKey ?? video?.promptKey ?? promptKeys[0];

  const pick = async () => {
    setError(undefined);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_VIDEO_SECONDS,
      allowsEditing: true,
      // Re-encoded on the server anyway; keeps uploads small.
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) return setError(t('video.tooLarge'));
    if (asset.duration && asset.duration > (MAX_VIDEO_SECONDS + 1) * 1000) {
      setError(t('video.cut', { seconds: MAX_VIDEO_SECONDS }));
    }
    upload.mutate(
      {
        promptKey: chosen,
        lang: locale,
        video: {
          uri: asset.uri,
          mimeType: asset.mimeType ?? null,
          fileName: asset.fileName ?? null,
          file: asset.file ?? null,
        },
      },
      {
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 413
              ? t('video.tooLarge')
              : e instanceof ApiRequestError && e.status === 415
                ? t('video.unsupported')
                : t('common.genericError'),
          ),
      },
    );
  };

  return (
    <Screen back title={t('video.title')}>
      <AppText variant="body">{t('video.intro', { seconds: MAX_VIDEO_SECONDS })}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {video ? <Status video={video} /> : null}
      {video?.url && video.posterUrl ? (
        <View style={styles.preview}>
          <AppText variant="caption" tone="muted">
            🎬 {t(`prompt.${video.promptKey}`)}
          </AppText>
          <VideoPrompt
            url={video.url}
            posterUrl={video.posterUrl}
            label={t(`prompt.${video.promptKey}`)}
            durationMs={video.durationMs}
            captions={
              video.captions.status === 'done' && video.captions.cues.length > 0
                ? { lang: video.captions.lang ?? 'en', cues: video.captions.cues }
                : null
            }
          />
        </View>
      ) : null}
      {/* Remounted when the captions arrive or change state, so the fields start from them. */}
      {video && (video.status === 'review' || video.status === 'clean') ? (
        <CaptionsEditor
          key={`${video.id}-${video.captions.status}-${video.captions.cues.length}`}
          video={video}
        />
      ) : null}
      <ChoiceGroup
        label={t('video.which')}
        stacked
        options={promptKeys.map((value) => ({ value, label: t(`prompt.${value}`) }))}
        selected={[chosen]}
        onChange={(next) => setPromptKey((next[0] as PromptKey | undefined) ?? chosen)}
      />
      <AppText variant="caption" tone="muted">
        {t('video.rules')}
      </AppText>
      <Button
        label={video ? t('video.replace') : t('video.choose')}
        loading={upload.isPending}
        onPress={() => void pick()}
      />
      {video ? (
        <Button
          variant="dangerGhost"
          label={t('video.remove')}
          loading={remove.isPending}
          onPress={() =>
            remove.mutate(undefined, { onError: () => setError(t('common.genericError')) })
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ preview: { gap: spacing.sm } });

export default function EditVideoRoute() {
  return (
    <RequireSession>
      <EditVideo />
    </RequireSession>
  );
}
