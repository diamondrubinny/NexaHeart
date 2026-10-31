// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { randomInt } from 'node:crypto';
import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  gameQuestions,
  type GameAnswerInput,
  type GameQuestion,
  type GameView,
  type MessageView,
  type StartGameInput,
} from '@nexaheart/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { HttpError } from '../../plugins/error-handler.js';
import type { ChatService } from '../chat/service.js';

const { chatGames, instanceSettings, matches, messages } = schema;

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505');

type GameRow = typeof chatGames.$inferSelect;

/**
 * A game card as one person may see it (phase 76c): their own answer, whether the other answered,
 * and the other's words only once both answered. Null for a question that is no longer in the list.
 */
export function gameView(game: GameRow, userA: string, viewerId: string): GameView | null {
  if (!(gameQuestions as readonly string[]).includes(game.question)) return null;
  const iAmA = userA === viewerId;
  const own = iAmA ? game.answerA : game.answerB;
  const theirs = iAmA ? game.answerB : game.answerA;
  const revealed = game.revealedAt !== null;
  return {
    id: game.id,
    question: game.question as GameQuestion,
    mine: game.startedBy === viewerId,
    myAnswer: own,
    theyAnswered: theirs !== null,
    theirAnswer: revealed ? theirs : null,
    revealed,
  };
}

/**
 * The Question Game in chat (phase 76c). Starting one writes a card message; answering changes the
 * card for both (message.updated carries ids only, so each client fetches its own view). Every
 * action checks that the person is part of the (active, unblocked) match via ChatService.participant.
 */
export class GameService {
  constructor(
    private readonly db: Database,
    private readonly chat: ChatService,
  ) {}

  /** Read fresh, so turning it off takes effect at once. */
  async enabled(): Promise<boolean> {
    const [row] = await this.db
      .select({ on: instanceSettings.chatGame })
      .from(instanceSettings)
      .limit(1);
    return row?.on ?? true;
  }

  async start(matchId: string, userId: string, input: StartGameInput): Promise<MessageView> {
    const { otherId } = await this.chat.participant(matchId, userId);
    const [existing] = await this.db
      .select({ id: messages.id, matchId: messages.matchId })
      .from(messages)
      .where(and(eq(messages.senderId, userId), eq(messages.clientId, input.clientId)));
    if (existing) {
      if (existing.matchId !== matchId) {
        throw new HttpError(409, ErrorCode.Conflict, 'Message id already used.');
      }
      return this.chat.messageView(existing.id, userId);
    }
    if (!(await this.enabled())) {
      throw new HttpError(409, ErrorCode.Conflict, 'The question game is off in this community.');
    }
    await this.chat.checkConversationStart(matchId, userId);
    const asked = new Set(
      (
        await this.db
          .select({ question: chatGames.question })
          .from(chatGames)
          .where(eq(chatGames.matchId, matchId))
      ).map((r) => r.question),
    );
    const left = gameQuestions.filter((q) => !asked.has(q));
    const question = input.question ?? left[randomInt(Math.max(left.length, 1))];
    if (!question || asked.has(question)) {
      throw new HttpError(409, ErrorCode.Conflict, 'That question was already asked here.');
    }
    let messageId: string;
    try {
      messageId = await this.db.transaction(async (tx) => {
        const [game] = await tx
          .insert(chatGames)
          .values({ matchId, question, startedBy: userId })
          .returning({ id: chatGames.id });
        const [message] = await tx
          .insert(messages)
          .values({
            matchId,
            senderId: userId,
            clientId: input.clientId,
            kind: 'game',
            body: question,
            gameId: game!.id,
          })
          .returning({ id: messages.id });
        return message!.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          'There is already an open question in this chat.',
        );
      }
      throw error;
    }
    await this.chat.deliverMessage(messageId, userId, otherId);
    return this.chat.messageView(messageId, userId);
  }

  async answer(gameId: string, userId: string, input: GameAnswerInput): Promise<MessageView> {
    const [row] = await this.db
      .select({ game: chatGames, userA: matches.userA, messageId: messages.id })
      .from(chatGames)
      .innerJoin(matches, eq(matches.id, chatGames.matchId))
      .innerJoin(messages, eq(messages.gameId, chatGames.id))
      .where(eq(chatGames.id, gameId));
    if (!row) throw notFound();
    // 404 for anyone outside the chat, and once it is closed or blocked.
    const { otherId } = await this.chat.participant(row.game.matchId, userId);
    if (checkHarm(input.answer).flagged) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        'This answer may hurt. Please choose kinder words.',
      );
    }
    const iAmA = row.userA === userId;
    const own = iAmA ? chatGames.answerA : chatGames.answerB;
    const theirs = iAmA ? chatGames.answerB : chatGames.answerA;
    const updated = await this.db
      .update(chatGames)
      .set({
        ...(iAmA ? { answerA: input.answer } : { answerB: input.answer }),
        // Both answered: reveal both together, in the same write.
        revealedAt: sql`CASE WHEN ${theirs} IS NOT NULL THEN now() END`,
      })
      .where(and(eq(chatGames.id, gameId), isNull(own)))
      .returning({ id: chatGames.id });
    if (updated.length === 0) {
      throw new HttpError(409, ErrorCode.Conflict, 'You already answered this one.');
    }
    await this.chat.announceUpdated(row.game.matchId, row.messageId, [userId, otherId]);
    return this.chat.messageView(row.messageId, userId);
  }
}
