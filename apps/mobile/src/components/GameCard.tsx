// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { GAME_ANSWER_MAX, type MessageView } from '@nexaheart/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError } from '../lib/api';
import { useAnswerGame } from '../lib/game-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';
import { TextField } from './TextField';

/**
 * A Question Game card (phase 76c): the question, my answer, and the other person's only once both
 * answered (the server never sends it before). The reveal is announced to screen readers.
 */
export function GameCard({ message, otherName }: { message: MessageView; otherName: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const answer = useAnswerGame(message.matchId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const game = message.game;
  if (!game) return null;
  const question = t(`game.q.${game.question}`);

  const send = () => {
    const value = text.trim();
    if (!value) return setError(t('game.empty'));
    answer.mutate(
      { id: game.id, answer: value },
      {
        onSuccess: () => {
          setError(undefined);
          setText('');
        },
        onError: (e) =>
          setError(
            e instanceof ApiRequestError && e.status === 422
              ? t('game.kinder')
              : e instanceof ApiRequestError && e.status === 409
                ? t('game.already')
                : t('common.genericError'),
          ),
      },
    );
  };

  return (
    <View
      style={[styles.row, message.mine ? styles.rowMine : styles.rowTheirs]}
      testID="game-card"
      accessibilityRole="summary"
      accessibilityLabel={t('game.cardLabel', { question })}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: game.revealed ? colors.primarySoft : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <AppText variant="label" tone="primary">
          🎲 {game.mine ? t('game.youAsked') : t('game.theyAsked', { name: otherName })}
        </AppText>
        <AppText variant="heading">{question}</AppText>

        {game.myAnswer === null ? (
          <View style={styles.form}>
            <TextField
              label={t('game.yourAnswer')}
              hint={t('game.hint', { name: otherName, max: GAME_ANSWER_MAX })}
              value={text}
              onChangeText={setText}
              maxLength={GAME_ANSWER_MAX}
              multiline
              error={error}
            />
            <Button label={t('game.send')} loading={answer.isPending} onPress={send} />
          </View>
        ) : (
          <View style={styles.answer}>
            <AppText variant="caption" tone="muted">
              {t('game.you')}
            </AppText>
            <AppText variant="body" userContent>
              {game.myAnswer}
            </AppText>
          </View>
        )}

        <View accessibilityLiveRegion="polite" aria-live="polite">
          {game.revealed && game.theirAnswer !== null ? (
            <View style={styles.answer} testID="game-reveal">
              <AppText variant="caption" tone="muted">
                {otherName}
              </AppText>
              <AppText variant="body" userContent>
                {game.theirAnswer}
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" tone="muted" testID="game-waiting">
              {game.myAnswer !== null
                ? t('game.waitingFor', { name: otherName })
                : game.theyAnswered
                  ? t('game.theyAnswered', { name: otherName })
                  : t('game.waiting')}
            </AppText>
          )}
        </View>
        {error && game.myAnswer !== null ? <Banner tone="error" message={error} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, marginVertical: spacing.xs },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  card: {
    width: '88%',
    maxWidth: 420,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    gap: spacing.sm,
  },
  form: { gap: spacing.sm },
  answer: { gap: 2 },
});
