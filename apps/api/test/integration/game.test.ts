// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { gameQuestions } from '@nexaheart/shared';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('the Question Game, phase 76c (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let matchId: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const start = (m: Member, extra: object = {}) =>
    api(ctx, m, 'POST', `/v1/matches/${matchId}/game`, {
      clientId: `game-client-${++n}`,
      ...extra,
    });
  const answer = (m: Member, gameId: string, text: string) =>
    api(ctx, m, 'POST', `/v1/games/${gameId}/answer`, { answer: text });
  const cardIn = async (m: Member, messageId: string) => {
    const res = await api(ctx, m, 'GET', `/v1/matches/${matchId}/messages`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().messages as { id: string; game: unknown }[]).find((x) => x.id === messageId)
      ?.game;
  };

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const liked = await api(ctx, noa, 'POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });
    matchId = liked.json().matchId;
  });

  it('neither answer shows until both answered, then both do', async () => {
    const started = await start(noa, { question: 'superpower' });
    expect(started.statusCode, started.body).toBe(201);
    const card = started.json();
    expect(card.kind).toBe('game');
    const gameId = card.game.id as string;
    expect(card.game).toMatchObject({
      question: 'superpower',
      mine: true,
      myAnswer: null,
      theyAnswered: false,
      theirAnswer: null,
      revealed: false,
    });

    // Noa answers: Dan sees that she did, never what.
    const a = await answer(noa, gameId, 'Talking to animals');
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json().game).toMatchObject({ myAnswer: 'Talking to animals', revealed: false });
    const danSees = await cardIn(dan, card.id);
    expect(danSees).toMatchObject({ mine: false, theyAnswered: true, theirAnswer: null });
    expect(JSON.stringify(danSees)).not.toContain('animals');

    // Dan answers: both revealed together.
    const b = await answer(dan, gameId, 'Flying, obviously');
    expect(b.json().game).toMatchObject({
      myAnswer: 'Flying, obviously',
      theirAnswer: 'Talking to animals',
      revealed: true,
    });
    expect(await cardIn(noa, card.id)).toMatchObject({
      myAnswer: 'Talking to animals',
      theirAnswer: 'Flying, obviously',
      revealed: true,
    });
    // One answer each.
    expect((await answer(dan, gameId, 'Again')).statusCode).toBe(409);
  });

  it('one open question at a time, never the same one twice', async () => {
    const first = (await start(noa, { question: 'perfect_day' })).json();
    const firstClient = `game-client-${n}`;
    expect((await start(dan)).statusCode).toBe(409); // still open
    // Retrying the same request returns the same card.
    const again = await api(ctx, noa, 'POST', `/v1/matches/${matchId}/game`, {
      clientId: firstClient,
      question: 'perfect_day',
    });
    expect(again.json().id).toBe(first.id);
    await answer(noa, first.game.id, 'A long breakfast');
    await answer(dan, first.game.id, 'Sea, then falafel');
    expect((await start(dan, { question: 'perfect_day' })).statusCode).toBe(409);
    const second = await start(dan);
    expect(second.statusCode).toBe(201);
    expect(gameQuestions).toContain(second.json().game.question);
    expect(second.json().game.question).not.toBe('perfect_day');
  });

  it('only the two people in the chat; harmful answers refused; off when turned off', async () => {
    const card = (await start(noa)).json();
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await answer(eve, card.game.id, 'Me too')).statusCode).toBe(404);
    expect(
      (await api(ctx, eve, 'POST', `/v1/matches/${matchId}/game`, { clientId: 'eve-game-1' }))
        .statusCode,
    ).toBe(404);
    expect((await answer(dan, card.game.id, 'You are an idiot')).statusCode).toBe(422);
    expect((await answer(dan, card.game.id, 'x'.repeat(281))).statusCode).toBe(400);

    // Off in this community: no new questions (the open one can still be answered).
    await q(`INSERT INTO instance_settings (id, chat_game) VALUES (1, false)
      ON CONFLICT (id) DO UPDATE SET chat_game = false`);
    await answer(noa, card.game.id, 'Kindness');
    await answer(dan, card.game.id, 'Patience');
    expect((await start(dan)).statusCode).toBe(409);
    await q(`UPDATE instance_settings SET chat_game = true`);
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id })).statusCode).toBe(200);
    expect((await start(dan)).statusCode).toBe(404);
  });

  it('reports keep what the reporter saw; the export has my own answers', async () => {
    const card = (await start(noa, { question: 'comfort_food' })).json();
    await answer(dan, card.game.id, 'Soup, always');
    // Noa reports before answering: Dan's answer was never shown to her.
    const report = await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'harassment',
      messageIds: [card.id],
    });
    expect(report.statusCode, report.body).toBe(201);
    const { rows } = await q(`SELECT body FROM report_evidence WHERE body LIKE 'Question game:%'`);
    expect(rows[0].body).toContain('comfort_food');
    expect(rows[0].body).not.toContain('Soup');

    const zip = unzipSync(new Uint8Array((await api(ctx, dan, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    const answers = data.questionGameAnswers as { answer: string }[];
    expect(answers.map((x) => x.answer)).toEqual(['Soup, always']);
  });
});
