// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
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

describe.skipIf(!integrationEnabled)('security review fixes, phase 77b (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let eli: Member; // a man, so Dan isn't in his dating deck: groups don't use dating filters
  let admin: string;
  let n = 0;
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);

  async function staff(role: 'moderator' | 'admin') {
    const email = `group-${role}-${(n += 1)}@example.test`;
    const cookie = await signIn(ctx, email);
    await q(`UPDATE "user" SET role = $2 WHERE email = $1`, [email, role]);
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
    return cookie;
  }
  const asStaff = (
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const open = async (over: object = {}) => {
    const res = await asStaff(admin, 'POST', '/v1/admin/groups', {
      name: 'Hikers',
      about: 'Weekend trails around the city.',
      emoji: '🥾',
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  };
  const join = (m: Member, id: string) => api(ctx, m, 'POST', `/v1/groups/${id}/join`);
  const post = (m: Member, id: string, body: string) =>
    api(ctx, m, 'POST', `/v1/groups/${id}/posts`, { body });
  const board = async (m: Member, id: string) => {
    const res = await api(ctx, m, 'GET', `/v1/groups/${id}/posts`);
    return res.statusCode === 200
      ? (res.json().posts as { id: string; body: string; author: { userId: string } }[])
      : res.statusCode;
  };

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'] });
    admin = await staff('admin');
  });
  const evidence = async () =>
    (await q(`SELECT body FROM report_evidence ORDER BY sent_at`)).rows.map(
      (r) => r.body as string,
    );
  const report = (from: Member, target: Member, groupPostIds: string[]) =>
    api(ctx, from, 'POST', '/v1/reports', {
      targetId: target.id,
      category: 'harassment',
      groupPostIds,
      block: false,
    });

  it('#1 people who share only a group can report each other, with the post', async () => {
    const id = await open();
    for (const m of [dan, eli]) await join(m, id);
    const p = (await post(dan, id, 'Nobody wants you here')).json();
    // Eli and Dan (both men, each outside the other's deck) can still report each other.
    const res = await report(eli, dan, [p.id]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await evidence()).toEqual(['Group post (Hikers): Nobody wants you here']);
    // Without a shared group: still 404 (no new way to report strangers).
    const stranger = await createMember(ctx, {
      name: 'Ron',
      gender: 'man',
      interestedIn: ['woman'],
    });
    expect((await report(stranger, dan, [])).statusCode).toBe(404);
  });

  it('#2 deleting my post hides it at once but keeps it for a report', async () => {
    const id = await open();
    for (const m of [noa, dan]) await join(m, id);
    const p = (await post(dan, id, 'Meet me alone, tell nobody')).json();
    expect((await api(ctx, dan, 'DELETE', `/v1/group-posts/${p.id}`)).statusCode).toBe(204);
    expect(await board(noa, id)).toEqual([]);
    expect((await report(noa, dan, [p.id])).statusCode).toBe(201);
    expect(await evidence()).toEqual(['Group post (Hikers): Meet me alone, tell nobody']);
    // Deleting again (or after an admin removal) is harmless.
    expect((await api(ctx, dan, 'DELETE', `/v1/group-posts/${p.id}`)).statusCode).toBe(204);
    expect((await api(ctx, noa, 'DELETE', `/v1/group-posts/${p.id}`)).statusCode).toBe(404);
  });

  it('#3 hidden from contacts or incognito: not in the list, not as an author', async () => {
    const id = await open();
    for (const m of [noa, dan, eli]) await join(m, id);
    await post(noa, id, 'Hi everyone');
    await q('INSERT INTO contact_hides (user_id, other_id) VALUES ($1, $2)', [noa.id, dan.id]);
    expect(await board(dan, id)).toEqual([]);
    const danSees = (await api(ctx, dan, 'GET', `/v1/groups/${id}`)).json().members;
    expect(danSees.map((m: { userId: string }) => m.userId)).toEqual([eli.id]);
    // Incognito: gone from everyone's board too.
    await q('UPDATE "user" SET incognito = true WHERE id = $1', [noa.id]);
    expect(await board(eli, id)).toEqual([]);
  });

  it('#7 a member who left can still report what they saw, for 30 days', async () => {
    const id = await open();
    // Eli and Dan: both men, each outside the other's deck; only the group links them.
    for (const m of [eli, dan]) await join(m, id);
    const p = (await post(dan, id, 'Come to my place after, alone')).json();
    await api(ctx, eli, 'POST', `/v1/groups/${id}/leave`);
    const r1 = await report(eli, dan, [p.id]);
    expect(r1.statusCode, r1.body).toBe(201);
    expect(await evidence()).toEqual(['Group post (Hikers): Come to my place after, alone']);
    await q(`UPDATE group_departures SET left_at = now() - interval '31 days'`);
    await q('DELETE FROM report_evidence');
    await q('DELETE FROM reports');
    // After 30 days nothing links them any more: the report isn't accepted (as for strangers).
    expect((await report(eli, dan, [p.id])).statusCode).toBe(404);
  });

  it('#4 the Question Game follows "verified members only", and warns about scams', async () => {
    await api(ctx, dan, 'POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = (
      await api(ctx, noa, 'POST', '/v1/interactions', { targetId: dan.id, kind: 'like' })
    ).json();
    // Noa (not verified) may start; Dan answers with a way off the app.
    const card = (
      await api(ctx, noa, 'POST', `/v1/matches/${matchId}/game`, { clientId: 'game-77b-one' })
    ).json();
    await api(ctx, dan, 'POST', `/v1/games/${card.game.id}/answer`, {
      answer: 'Text me on whatsapp, my number is 052-555-0101',
    });
    const answered = await api(ctx, noa, 'POST', `/v1/games/${card.game.id}/answer`, {
      answer: 'Tea',
    });
    expect(answered.json().game.revealed).toBe(true);
    expect(answered.json().game.scam.length).toBeGreaterThan(0);
    // Dan accepts messages from verified members only: Noa (unverified) can't start a game.
    await q('UPDATE preferences SET verified_contact_only = true WHERE user_id = $1', [dan.id]);
    const blocked = await api(ctx, noa, 'POST', `/v1/matches/${matchId}/game`, {
      clientId: 'game-77b-two',
    });
    expect(blocked.statusCode).toBe(403);
  });

  it('#5 the nearby lens leaves out people who hide their distance', async () => {
    const lens = async () =>
      (
        (await api(ctx, noa, 'GET', '/v1/discover?limit=20&lens=nearby')).json().profiles as {
          id: string;
        }[]
      ).map((p) => p.id);
    expect(await lens()).toEqual(expect.arrayContaining([dan.id]));
    await q('UPDATE preferences SET hide_distance = true WHERE user_id = $1', [dan.id]);
    expect(await lens()).not.toContain(dan.id);
  });

  it('#6 others see scam warnings on a post', async () => {
    const id = await open();
    for (const m of [noa, dan]) await join(m, id);
    await post(dan, id, 'Send me money via crypto wallet, link: http://example.test');
    const seen = (await api(ctx, noa, 'GET', `/v1/groups/${id}/posts`)).json().posts;
    expect(seen[0].scam.length).toBeGreaterThan(0);
    const own = (await api(ctx, dan, 'GET', `/v1/groups/${id}/posts`)).json().posts;
    expect(own[0].scam).toEqual([]);
  });
});
