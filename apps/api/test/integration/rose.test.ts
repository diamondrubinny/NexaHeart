// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('the weekly rose, phase 76a (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let tom: Member;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const like = (from: Member, to: Member, extra: object = {}) =>
    api(ctx, from, 'POST', '/v1/interactions', { targetId: to.id, kind: 'like', ...extra });
  const status = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me/rose')).json();
  const likesOf = async (m: Member) =>
    (await api(ctx, m, 'GET', '/v1/likes')).json().likes as {
      profile: { id: string };
      rose: boolean;
    }[];

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    tom = await createMember(ctx, { name: 'Tom', gender: 'man', interestedIn: ['woman'] });
  });

  it('one rose a week; it’s a like that comes first', async () => {
    expect(await status(dan)).toEqual({ enabled: true, available: true, nextAt: null });
    // Tom likes Noa first, then Dan sends her a rose: Dan's comes first.
    expect((await like(tom, noa)).statusCode).toBe(200);
    const sent = await like(dan, noa, { rose: true, comment: 'Your Sunday sounds perfect' });
    expect(sent.statusCode, sent.body).toBe(200);
    const likes = await likesOf(noa);
    expect(likes.map((l) => [l.profile.id, l.rose])).toEqual([
      [dan.id, true],
      [tom.id, false],
    ]);
    // The second one this week is refused; the status says when the next comes.
    const eve = await createMember(ctx, { name: 'Eve', gender: 'woman', interestedIn: ['man'] });
    expect((await like(dan, eve, { rose: true })).statusCode).toBe(409);
    expect((await like(dan, eve)).statusCode).toBe(200); // a plain like is fine
    const s = await status(dan);
    expect(s.available).toBe(false);
    expect(Date.parse(s.nextAt) - Date.now()).toBeGreaterThan(6 * 86_400_000);
    // A week later: a new rose.
    await q(`UPDATE interactions SET created_at = now() - interval '8 days' WHERE rose`);
    expect(await status(dan)).toMatchObject({ available: true, nextAt: null });
    // Still a like: a mutual one is a match.
    const back = await like(noa, dan);
    expect(back.json().matched).toBe(true);
  });

  it('a like, in dating mode only; off when the community turns it off', async () => {
    expect(
      (
        await api(ctx, dan, 'POST', '/v1/interactions', {
          targetId: noa.id,
          kind: 'pass',
          rose: true,
        })
      ).statusCode,
    ).toBe(400);
    expect((await like(dan, noa, { rose: true, mode: 'friend' })).statusCode).toBe(400);
    await q(`INSERT INTO instance_settings (id, weekly_rose) VALUES (1, false)
      ON CONFLICT (id) DO UPDATE SET weekly_rose = false`);
    expect(await status(dan)).toEqual({ enabled: false, available: false, nextAt: null });
    expect((await like(dan, noa, { rose: true })).statusCode).toBe(409);
    expect((await likesOf(noa)).length).toBe(0);
  });
});
