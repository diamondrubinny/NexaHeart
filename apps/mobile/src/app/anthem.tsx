// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { ANTHEM_FIELD_MAX } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useMyAnthem, useSaveAnthem } from '../lib/anthem-queries';

/** Phase 76g: my song, in my own words. No music service is connected. */
function EditAnthem() {
  const { t } = useTranslation();
  const mine = useMyAnthem();
  const save = useSaveAnthem();
  const [title, setTitle] = useState<string>();
  const [artist, setArtist] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (title !== undefined || mine.isPending) return;
    setTitle(mine.data?.title ?? '');
    setArtist(mine.data?.artist ?? '');
  }, [mine.data, mine.isPending, title]);
  if (title === undefined) return <Loading />;

  const done = () => {
    // Opened from a link there is nothing to go back to: the profile tab instead.
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  };
  const submit = async (remove: boolean) => {
    setError(undefined);
    if (!remove && (!title.trim() || !artist.trim())) return setError(t('anthem.incomplete'));
    try {
      await save.mutateAsync(remove ? null : { title: title.trim(), artist: artist.trim() });
      done();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 422
          ? t('anthem.kinder')
          : t('common.genericError'),
      );
    }
  };

  return (
    <Screen
      back
      title={t('anthem.title')}
      footer={
        <Button
          label={t('common.save')}
          loading={save.isPending}
          onPress={() => void submit(false)}
        />
      }
    >
      <AppText variant="body">{t('anthem.intro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('anthem.songTitle')}
        value={title}
        onChangeText={setTitle}
        maxLength={ANTHEM_FIELD_MAX}
      />
      <TextField
        label={t('anthem.artist')}
        value={artist}
        onChangeText={setArtist}
        maxLength={ANTHEM_FIELD_MAX}
      />
      {mine.data ? (
        <Button
          variant="dangerGhost"
          label={t('anthem.remove')}
          onPress={() => void submit(true)}
        />
      ) : null}
    </Screen>
  );
}

export default function EditAnthemRoute() {
  return (
    <RequireSession>
      <EditAnthem />
    </RequireSession>
  );
}
