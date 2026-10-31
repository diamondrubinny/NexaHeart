// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { POLL_ANSWER_MAX, POLL_ANSWERS_MAX, POLL_QUESTION_MAX } from '@nexaheart/shared';
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
import { useMyPoll, useSavePoll } from '../lib/poll-queries';

/**
 * Phase 76d: a prompt poll on my profile, in my own words. Someone who likes my profile can pick
 * an answer, and the pick comes with the like. Nobody sees counts or results.
 */
function EditPoll() {
  const { t } = useTranslation();
  const mine = useMyPoll();
  const save = useSavePoll();
  const [question, setQuestion] = useState<string>();
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (question !== undefined || mine.isPending) return;
    setQuestion(mine.data?.question ?? '');
    const existing = mine.data?.answers ?? [];
    setAnswers([0, 1, 2].map((i) => existing[i] ?? ''));
  }, [mine.data, mine.isPending, question]);
  if (question === undefined) return <Loading />;

  const filled = answers.map((a) => a.trim()).filter(Boolean);
  const submit = async (remove: boolean) => {
    setError(undefined);
    if (!remove && (question.trim().length < 3 || filled.length < 2)) {
      return setError(t('poll.incomplete'));
    }
    try {
      await save.mutateAsync(remove ? null : { question: question.trim(), answers: filled });
      // Opened from a link there is nothing to go back to: the profile tab instead.
      if (router.canGoBack()) router.back();
      else router.replace('/profile');
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 422
          ? t('poll.kinder')
          : e instanceof ApiRequestError && e.status === 400
            ? t('poll.invalid')
            : t('common.genericError'),
      );
    }
  };

  return (
    <Screen
      back
      title={t('poll.title')}
      footer={
        <Button
          label={t('common.save')}
          loading={save.isPending}
          onPress={() => void submit(false)}
        />
      }
    >
      <AppText variant="body">{t('poll.intro')}</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      <TextField
        label={t('poll.question')}
        hint={t('poll.questionHint')}
        value={question}
        onChangeText={setQuestion}
        maxLength={POLL_QUESTION_MAX}
      />
      {Array.from({ length: POLL_ANSWERS_MAX }, (_, i) => (
        <TextField
          key={i}
          label={t('poll.answer', { n: i + 1 })}
          {...(i === POLL_ANSWERS_MAX - 1 ? { optionalLabel: t('common.optional') } : {})}
          value={answers[i] ?? ''}
          onChangeText={(v) => setAnswers((cur) => cur.map((a, j) => (j === i ? v : a)))}
          maxLength={POLL_ANSWER_MAX}
        />
      ))}
      {mine.data ? (
        <Button variant="dangerGhost" label={t('poll.remove')} onPress={() => void submit(true)} />
      ) : null}
    </Screen>
  );
}

export default function EditPollRoute() {
  return (
    <RequireSession>
      <EditPoll />
    </RequireSession>
  );
}
