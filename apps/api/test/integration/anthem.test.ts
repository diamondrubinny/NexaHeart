// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../../src/lib/totp.js';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  signIn,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('my song, phase 76g (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const song = { title: 'Yerushalayim shel zahav', artist: 'Shuli Natan' };
  const save = (m: Member, body: object) => api(ctx, m, 'PUT', '/v1/me/anthem', body);

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('saves my song in my own words, within limits; others see it', async () => {
    expect((await api(ctx, noa, 'GET', '/v1/me/anthem')).json()).toEqual({ anthem: null });
    const saved = await save(noa, song);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().anthem).toMatchObject(song);
    for (const bad of [
      { title: '', artist: 'X' },
      { title: 'x'.repeat(81), artist: 'X' },
      { title: 'Song', artist: 'X', url: 'https://example.test' },
    ]) {
      expect((await save(noa, bad)).statusCode).toBe(400);
    }
    expect((await save(noa, { title: 'You idiot', artist: 'X' })).statusCode).toBe(422);
    const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json();
    expect(seen.anthem).toMatchObject(song);
    expect((await api(ctx, noa, 'DELETE', '/v1/me/anthem')).json()).toEqual({ anthem: null });
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().anthem).toBeNull();
  });

  it('a like on the song says so; a song that isn’t theirs is refused', async () => {
    const mine = (await save(noa, song)).json().anthem;
    const other = (await save(dan, { title: 'Other', artist: 'Someone' })).json().anthem;
    const like = (itemId: string) =>
      api(ctx, dan, 'POST', '/v1/interactions', {
        targetId: noa.id,
        kind: 'like',
        itemType: 'anthem',
        itemId,
        comment: 'Great choice',
      });
    expect((await like(other.id)).statusCode).toBe(400);
    expect((await like(mine.id)).statusCode).toBe(200);
    const likes = (await api(ctx, noa, 'GET', '/v1/likes')).json().likes;
    expect(likes).toMatchObject([{ itemType: 'anthem', itemId: mine.id, comment: 'Great choice' }]);
  });

  it('is in my export and deleted with the account', async () => {
    await save(noa, song);
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    expect(JSON.parse(strFromU8(zip['data.json']!)).song).toEqual(song);
    await ctx.services.dbHandle.pool.query('DELETE FROM "user" WHERE id = $1', [noa.id]);
    const { rows } = await ctx.services.dbHandle.pool.query('SELECT 1 FROM profile_anthems');
    expect(rows).toHaveLength(0);
  });

  it('77d: a phrase split across both fields, and invisible characters, are refused', async () => {
    expect((await save(noa, { title: 'I will', artist: 'kill you' })).statusCode).toBe(422);
    expect((await save(noa, { title: 'Song\u202Eeman', artist: 'X' })).statusCode).toBe(400);
    expect((await save(noa, { title: 'Line\nbreak', artist: 'X' })).statusCode).toBe(400);
    expect(
      (
        await api(ctx, noa, 'PUT', '/v1/me/poll', {
          question: 'Best \u202Edate?',
          answers: ['A', 'B'],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('77d: moderators see the song and the poll of a reported member', async () => {
    await save(noa, song);
    await api(ctx, noa, 'PUT', '/v1/me/poll', {
      question: 'Tea or coffee?',
      answers: ['Tea', 'Coffee'],
    });
    const reported = await api(ctx, dan, 'POST', '/v1/reports', {
      targetId: noa.id,
      category: 'harassment',
      block: false,
    });
    expect(reported.statusCode, reported.body).toBe(201);
    const email = 'anthem-mod@example.test';
    const cookie = await signIn(ctx, email);
    await ctx.services.dbHandle.pool.query(
      `UPDATE "user" SET role = 'moderator' WHERE email = $1`,
      [email],
    );
    const setup = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/setup',
      headers: { cookie },
    });
    ctx.clock.value += 30_000;
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/mfa/verify',
      headers: { cookie },
      payload: { code: totp(setup.json().secret, ctx.clock.value) },
    });
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/reports/${reported.json().reportId}`,
      headers: { cookie },
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().reportedProfile).toMatchObject({
      anthem: song,
      poll: { question: 'Tea or coffee?', answers: ['Tea', 'Coffee'] },
    });
  });
});
