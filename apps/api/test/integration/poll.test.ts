// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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

describe.skipIf(!integrationEnabled)('prompt polls, phase 76d (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const poll = { question: 'Perfect first date?', answers: ['Coffee', 'A long walk', 'Hummus'] };
  const save = (m: Member, body: object) => api(ctx, m, 'PUT', '/v1/me/poll', body);
  const like = (from: Member, to: Member, extra: object = {}) =>
    api(ctx, from, 'POST', '/v1/interactions', { targetId: to.id, kind: 'like', ...extra });
  const likesOf = async (m: Member) =>
    (await api(ctx, m, 'GET', '/v1/likes')).json().likes as {
      profile: { id: string };
      pollAnswer: string | null;
    }[];

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('saves a poll in my own words, within limits', async () => {
    expect((await api(ctx, noa, 'GET', '/v1/me/poll')).json()).toEqual({ poll: null });
    const saved = await save(noa, poll);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await api(ctx, noa, 'GET', '/v1/me/poll')).json()).toEqual({ poll });
    // 2-3 answers, each once, short; the question at least 3 characters.
    for (const bad of [
      { ...poll, answers: ['Only one'] },
      { ...poll, answers: ['a', 'b', 'c', 'd'] },
      { ...poll, answers: ['Coffee', 'coffee'] },
      { ...poll, answers: ['x'.repeat(41), 'b'] },
      { ...poll, question: 'Hi' },
    ]) {
      expect((await save(noa, bad)).statusCode).toBe(400);
    }
    expect((await save(noa, { ...poll, question: 'Are you an idiot?' })).statusCode).toBe(422);
    // Others see it on the profile.
    const seen = await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`);
    expect(seen.statusCode, seen.body).toBe(200);
    expect(seen.json().poll).toEqual(poll);
    // Removed.
    expect((await api(ctx, noa, 'DELETE', '/v1/me/poll')).json()).toEqual({ poll: null });
  });

  it('a pick travels with a like, as it read then', async () => {
    await save(noa, poll);
    const liked = await like(dan, noa, { pollChoice: 2, comment: 'Hummus, always' });
    expect(liked.statusCode, liked.body).toBe(200);
    // Noa edits her poll later: Dan's pick still reads "Hummus".
    await save(noa, { question: 'Weekend plans?', answers: ['Sea', 'Hike'] });
    const likes = await likesOf(noa);
    expect(likes.map((l) => [l.profile.id, l.pollAnswer])).toEqual([[dan.id, 'Hummus']]);
  });

  it('refuses a pick without a poll, out of range, or on a pass', async () => {
    expect((await like(dan, noa, { pollChoice: 0 })).statusCode).toBe(400); // no poll yet
    await save(noa, { question: 'Tea or coffee?', answers: ['Tea', 'Coffee'] });
    expect((await like(dan, noa, { pollChoice: 2 })).statusCode).toBe(400); // only 2 answers
    expect((await like(dan, noa, { pollChoice: 3 })).statusCode).toBe(400);
    expect(
      (
        await api(ctx, dan, 'POST', '/v1/interactions', {
          targetId: noa.id,
          kind: 'pass',
          pollChoice: 0,
        })
      ).statusCode,
    ).toBe(400);
    // A plain like still works.
    expect((await like(dan, noa)).statusCode).toBe(200);
    expect((await likesOf(noa))[0]?.pollAnswer).toBeNull();
  });

  it('is in my data export and deleted with the account', async () => {
    await save(noa, poll);
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.promptPoll).toEqual(poll);
    await ctx.services.dbHandle.pool.query('DELETE FROM "user" WHERE id = $1', [noa.id]);
    const { rows } = await ctx.services.dbHandle.pool.query(
      'SELECT 1 FROM profile_polls WHERE user_id = $1',
      [noa.id],
    );
    expect(rows).toHaveLength(0);
  });
});
