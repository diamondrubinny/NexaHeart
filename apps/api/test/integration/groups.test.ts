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

describe.skipIf(!integrationEnabled)('interest groups, phase 76e (integration)', () => {
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

  it('admins open groups; members join, see each other and the board', async () => {
    const mod = await staff('moderator');
    expect((await asStaff(mod, 'POST', '/v1/admin/groups', { name: 'Chess' })).statusCode).toBe(
      403,
    );
    expect((await api(ctx, noa, 'POST', '/v1/admin/groups', { name: 'Chess' })).statusCode).toBe(
      403,
    );
    const id = await open();
    const listed = (await api(ctx, noa, 'GET', '/v1/groups')).json().groups;
    expect(listed).toMatchObject([{ id, name: 'Hikers', members: 0, joined: false }]);

    // Not a member: no board, no members.
    expect(await board(noa, id)).toBe(404);
    expect((await api(ctx, noa, 'GET', `/v1/groups/${id}`)).json().members).toEqual([]);

    for (const m of [noa, dan, eli]) expect((await join(m, id)).statusCode).toBe(200);
    const detail = (await api(ctx, dan, 'GET', `/v1/groups/${id}`)).json();
    expect(detail.group).toMatchObject({ joined: true, members: 3 });
    // Eli (a man) is listed to Dan: groups are social, dating filters don't apply.
    expect(detail.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [noa.id, eli.id].sort(),
    );

    const written = await post(noa, id, 'Anyone up for the Carmel trail on Friday?');
    expect(written.statusCode, written.body).toBe(201);
    expect(await board(dan, id)).toMatchObject([
      { body: 'Anyone up for the Carmel trail on Friday?', author: { userId: noa.id } },
    ]);
    // Harmful posts are refused; too long is invalid.
    expect((await post(dan, id, 'You are an idiot')).statusCode).toBe(422);
    expect((await post(dan, id, 'x'.repeat(501))).statusCode).toBe(400);

    // Leaving closes the board again.
    expect((await api(ctx, dan, 'POST', `/v1/groups/${id}/leave`)).statusCode).toBe(204);
    expect(await board(dan, id)).toBe(404);
    expect((await post(dan, id, 'Still here?')).statusCode).toBe(404);
  });

  it('blocks work both ways inside a group', async () => {
    const id = await open();
    for (const m of [noa, dan, eli]) await join(m, id);
    await post(dan, id, 'Sunrise hike, who is in?');
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id })).statusCode).toBe(200);
    expect(await board(noa, id)).toEqual([]);
    const danSees = (await api(ctx, dan, 'GET', `/v1/groups/${id}`)).json().members;
    expect(danSees.map((m: { userId: string }) => m.userId)).toEqual([eli.id]);
    // Eli still sees Dan's post.
    expect(await board(eli, id)).toHaveLength(1);
  });

  it('only the author deletes a post; admins remove one, logged', async () => {
    const id = await open();
    for (const m of [noa, dan]) await join(m, id);
    const p = (await post(noa, id, 'Map of the trail attached in my head')).json();
    expect((await api(ctx, dan, 'DELETE', `/v1/group-posts/${p.id}`)).statusCode).toBe(404);
    const second = (await post(noa, id, 'Water: 2 litres each')).json();
    expect((await api(ctx, noa, 'DELETE', `/v1/group-posts/${second.id}`)).statusCode).toBe(204);

    const staffPosts = (await asStaff(admin, 'GET', `/v1/admin/groups/${id}/posts`)).json().posts;
    expect(staffPosts).toMatchObject([{ id: p.id, authorId: noa.id }]);
    expect((await asStaff(admin, 'POST', `/v1/admin/group-posts/${p.id}/remove`)).statusCode).toBe(
      204,
    );
    expect(await board(dan, id)).toEqual([]);
    const { rows } = await q(`SELECT 1 FROM audit_logs WHERE action = 'group.post.remove'`);
    expect(rows).toHaveLength(1);
  });

  it('a reported post is copied as evidence, only from groups the reporter is in', async () => {
    const id = await open();
    const other = await open({ name: 'Board games', emoji: '🎲' });
    for (const m of [noa, dan]) await join(m, id);
    await join(dan, other);
    const p = (await post(dan, id, 'Send me your number, link in bio')).json();
    const hidden = (await post(dan, other, 'A post Noa never saw')).json();
    const report = await api(ctx, noa, 'POST', '/v1/reports', {
      targetId: dan.id,
      category: 'scam',
      groupPostIds: [p.id, hidden.id],
    });
    expect(report.statusCode, report.body).toBe(201);
    const { rows } = await q(`SELECT body FROM report_evidence ORDER BY sent_at`);
    expect(rows.map((r) => r.body)).toEqual([
      'Group post (Hikers): Send me your number, link in bio',
    ]);
  });

  it('size limit, closed groups, export and deletion', async () => {
    const id = await open({ capacity: 2 });
    await join(noa, id);
    await join(dan, id);
    expect((await join(eli, id)).statusCode).toBe(409);

    await post(noa, id, 'First hike: Saturday 7:00');
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.interestGroups).toMatchObject([{ group: 'Hikers' }]);
    expect(data.groupPosts).toMatchObject([{ group: 'Hikers', body: 'First hike: Saturday 7:00' }]);

    // Archived: members read it, nobody posts or joins; others don't see it.
    expect(
      (await asStaff(admin, 'PATCH', `/v1/admin/groups/${id}`, { archived: true })).statusCode,
    ).toBe(200);
    expect(await board(dan, id)).toHaveLength(1);
    expect((await post(dan, id, 'Next week?')).statusCode).toBe(409);
    expect((await api(ctx, eli, 'GET', '/v1/groups')).json().groups).toEqual([]);
    expect((await api(ctx, eli, 'GET', `/v1/groups/${id}`)).statusCode).toBe(404);

    await q('DELETE FROM "user" WHERE id = $1', [noa.id]);
    const left = await q(
      'SELECT 1 FROM group_posts UNION ALL SELECT 1 FROM group_members WHERE user_id = $1',
      [noa.id],
    );
    expect(left.rows).toHaveLength(0);
  });
});
