// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { GROUP_ABOUT_MAX, GROUP_NAME_MAX } from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { useProposeGroup } from '../../lib/group-queries';

/** Phase 76f: a member proposes a group; it opens once the admins approve it. */
function ProposeGroup() {
  const { t } = useTranslation();
  const propose = useProposeGroup();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💬');
  const [about, setAbout] = useState('');
  const [error, setError] = useState<string>();

  const submit = () => {
    if (name.trim().length < 2) return setError(t('groups.proposeName'));
    setError(undefined);
    propose.mutate(
      { name: name.trim(), emoji: emoji.trim() || '💬', about: about.trim() },
      {
        onSuccess: (group) =>
          router.replace({ pathname: '/groups/[id]', params: { id: group.id } }),
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 409
              ? t('groups.proposeLimit')
              : e instanceof ApiRequestError && e.status === 422
                ? t('groups.kinder')
                : e instanceof ApiRequestError && e.status === 403
                  ? t('groups.proposeOff')
                  : t('common.genericError'),
          ),
      },
    );
  };

  return (
    <Screen
      back
      title={t('groups.proposeTitle')}
      footer={
        <Button label={t('groups.proposeSend')} loading={propose.isPending} onPress={submit} />
      }
    >
      <AppText variant="body">{t('groups.proposeIntro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('groups.proposeNameLabel')}
        value={name}
        onChangeText={setName}
        maxLength={GROUP_NAME_MAX}
      />
      <TextField label={t('groups.emoji')} value={emoji} onChangeText={setEmoji} maxLength={8} />
      <TextField
        label={t('groups.about')}
        optionalLabel={t('common.optional')}
        value={about}
        onChangeText={setAbout}
        maxLength={GROUP_ABOUT_MAX}
        multiline
      />
    </Screen>
  );
}

export default function ProposeGroupRoute() {
  return (
    <RequireSession>
      <ProposeGroup />
    </RequireSession>
  );
}
