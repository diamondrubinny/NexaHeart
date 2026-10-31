// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  emptyAbout,
  interviewQuestions,
  MAX_INTERESTS,
  MAX_PROMPTS,
  type InterviewQuestion,
  type InterviewSuggestion,
  type PromptAnswer,
} from '@nexaheart/shared';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { apiFetch, json } from '../lib/api';
import { useCoach, useMe, useSetAbout, useSetPrompts } from '../lib/queries';
import { radius, spacing, useColors } from '../lib/theme';

type Answers = Partial<Record<InterviewQuestion, string>>;

/**
 * Phase 75c: a short interview to start a profile. Answers can become prompt answers word for
 * word; a model (where there is one) may only propose fields, which the person ticks. Nothing is
 * written for them.
 */
function InterviewScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const me = useMe();
  const coach = useCoach();
  const setPrompts = useSetPrompts();
  const setAbout = useSetAbout();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [keep, setKeep] = useState<Partial<Record<InterviewQuestion, boolean>>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const suggest = useMutation({
    mutationFn: (list: { promptKey: InterviewQuestion; answer: string }[]) =>
      apiFetch<InterviewSuggestion>('/v1/me/interview/suggest', {
        method: 'POST',
        body: json({ answers: list }),
      }),
  });

  if (me.isPending || !me.data) return <Loading />;
  const reviewing = step >= interviewQuestions.length;
  const answered = interviewQuestions.filter((q) => (answers[q] ?? '').trim().length > 0);
  const key = interviewQuestions[step];

  const next = () => {
    const nextStep = step + 1;
    setStep(nextStep);
    if (nextStep === interviewQuestions.length) {
      setKeep(Object.fromEntries(answered.map((q) => [q, true])));
      // A model may propose fields from the person's own words; nothing if there's no model.
      if (coach.data?.bioIdeas === 'available' && answered.length > 0) {
        suggest.mutate(
          answered.map((q) => ({ promptKey: q, answer: answers[q]!.trim() })),
          {
            onSuccess: (s) =>
              setPicked(
                Object.fromEntries([
                  ...s.interests.map((i) => [`interest:${i}`, true]),
                  ...(['children', 'smoking', 'drinking'] as const)
                    .filter((f) => s[f])
                    .map((f) => [`${f}:${s[f]}`, true]),
                ]),
              ),
          },
        );
      }
    }
  };

  const save = async () => {
    setError(undefined);
    try {
      // Prompt answers chosen here first (replacing the same question), then the ones already
      // there, up to the limit.
      const chosen: PromptAnswer[] = answered
        .filter((q) => keep[q])
        .map((q) => ({ promptKey: q, answer: answers[q]!.trim() }));
      const existing = me.data.prompts
        .filter((p) => !chosen.some((c) => c.promptKey === p.promptKey))
        .map((p) => ({ promptKey: p.promptKey, answer: p.answer }));
      if (chosen.length > 0) {
        await setPrompts.mutateAsync([...chosen, ...existing].slice(0, MAX_PROMPTS));
      }
      const s = suggest.data;
      if (s) {
        const about = me.data.about ?? emptyAbout;
        const interests = [
          ...new Set([...about.interests, ...s.interests.filter((i) => picked[`interest:${i}`])]),
        ].slice(0, MAX_INTERESTS);
        const pick = <F extends 'children' | 'smoking' | 'drinking'>(f: F) =>
          s[f] && picked[`${f}:${s[f]}`] ? s[f] : about[f];
        await setAbout.mutateAsync({
          ...about,
          interests,
          children: pick('children'),
          smoking: pick('smoking'),
          drinking: pick('drinking'),
        });
      }
      router.replace('/profile');
    } catch {
      setError(t('common.genericError'));
    }
  };

  const tick = (k: string, label: string) => (
    <Checkbox
      key={k}
      label={label}
      checked={picked[k] ?? false}
      onChange={(v) => setPicked((p) => ({ ...p, [k]: v }))}
    />
  );
  const s = suggest.data;

  return (
    <Screen back title={t('interview.title')}>
      {error ? <Banner tone="error" message={error} /> : null}
      {!reviewing && key ? (
        <>
          <AppText variant="caption" tone="muted">
            {t('interview.progress', { n: step + 1, total: interviewQuestions.length })}
          </AppText>
          <AppText variant="body" tone="muted">
            {t('interview.intro')}
          </AppText>
          <TextField
            label={t(`prompt.${key}`)}
            multiline
            maxLength={300}
            value={answers[key] ?? ''}
            onChangeText={(v) => setAnswers((a) => ({ ...a, [key]: v }))}
            hint={t('interview.hint')}
          />
          <Button
            label={t(answers[key]?.trim() ? 'interview.next' : 'interview.skip')}
            onPress={next}
          />
        </>
      ) : (
        <>
          {answered.length === 0 ? (
            <AppText variant="body">{t('interview.nothing')}</AppText>
          ) : (
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <AppText variant="heading">{t('interview.promptsTitle')}</AppText>
              <AppText variant="caption" tone="muted">
                {t('interview.promptsHint', { max: MAX_PROMPTS })}
              </AppText>
              {answered.map((q) => (
                <Checkbox
                  key={q}
                  label={t(`prompt.${q}`)}
                  hint={answers[q]!.trim()}
                  checked={keep[q] ?? false}
                  onChange={(v) => setKeep((k) => ({ ...k, [q]: v }))}
                />
              ))}
            </View>
          )}
          {suggest.isPending ? <Loading /> : null}
          {s && (s.interests.length > 0 || s.children || s.smoking || s.drinking) ? (
            <View
              style={[styles.card, { backgroundColor: colors.surface }]}
              testID="interview-suggestions"
            >
              <AppText variant="heading">{t('interview.suggestionsTitle')}</AppText>
              <AppText variant="caption" tone="muted">
                {t('interview.suggestionsHint')}
              </AppText>
              {s.interests.map((i) => tick(`interest:${i}`, t(`interest.${i}`)))}
              {s.children
                ? tick(`children:${s.children}`, t(`about.childrenOptions.${s.children}`))
                : null}
              {s.smoking
                ? tick(`smoking:${s.smoking}`, t(`about.smokingShort.${s.smoking}`))
                : null}
              {s.drinking
                ? tick(`drinking:${s.drinking}`, t(`about.drinkingShort.${s.drinking}`))
                : null}
            </View>
          ) : null}
          <Button
            label={t('interview.save')}
            loading={setPrompts.isPending || setAbout.isPending}
            disabled={suggest.isPending}
            onPress={() => void save()}
          />
          <Button variant="ghost" label={t('interview.again')} onPress={() => setStep(0)} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
});

export default function InterviewRoute() {
  return (
    <RequireSession>
      <InterviewScreen />
    </RequireSession>
  );
}
