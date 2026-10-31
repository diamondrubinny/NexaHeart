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

describe.skipIf(!integrationEnabled)(
  'member groups and Secret Crush, phase 76f (integration)',
  () => {
    let ctx: TestContext;
    let noa: Member;
    let dan: Member;
    let eli: Member; // a man, so Dan isn't in his dating deck: groups don't use dating filters
    let admin: string;
    let n = 0;
    const q = (sql: string, params: unknown[] = []) =>
      ctx.services.dbHandle.pool.query(sql, params);

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
    const memberGroups = (on: boolean) =>
      q(
        `INSERT INTO instance_settings (id, member_groups) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET member_groups = $1`,
        [on],
      );
    const propose = (m: Member, name = 'Sunset runners') =>
      api(ctx, m, 'POST', '/v1/groups/proposals', {
        name,
        about: 'Easy 5 km by the sea',
        emoji: '🏃',
      });
    const crush = (m: Member, groupId: string, target: Member, on = true) =>
      api(ctx, m, on ? 'PUT' : 'DELETE', `/v1/groups/${groupId}/crush/${target.id}`);
    const ids = (m: Member) => async () =>
      ((await api(ctx, m, 'GET', '/v1/groups')).json().groups as { id: string }[]).map((g) => g.id);

    it('members propose a group only when allowed; admins approve; the host moderates', async () => {
      expect((await propose(noa)).statusCode).toBe(403); // off by default
      await memberGroups(true);
      const proposed = await propose(noa);
      expect(proposed.statusCode, proposed.body).toBe(201);
      const id = proposed.json().id as string;
      expect(proposed.json()).toMatchObject({ status: 'pending', hosting: true });
      // Only Noa sees her proposal; nobody can join it or read it.
      expect(await ids(dan)()).toEqual([]);
      expect((await api(ctx, dan, 'GET', `/v1/groups/${id}`)).statusCode).toBe(404);
      expect((await api(ctx, noa, 'POST', `/v1/groups/${id}/join`)).statusCode).toBe(409);
      // One waiting at a time.
      expect((await propose(noa, 'Chess in the park')).statusCode).toBe(409);
      // A moderator can't decide; an admin approves: open, with Noa as host and first member.
      const mod = await staff('moderator');
      expect(
        (await asStaff(mod, 'POST', `/v1/admin/groups/${id}/decision`, { approve: true }))
          .statusCode,
      ).toBe(403);
      expect(
        (await asStaff(admin, 'POST', `/v1/admin/groups/${id}/decision`, { approve: true }))
          .statusCode,
      ).toBe(204);
      const seen = (await api(ctx, dan, 'GET', '/v1/groups')).json().groups;
      expect(seen).toMatchObject([{ id, status: 'open', members: 1, host: { userId: noa.id } }]);

      await api(ctx, dan, 'POST', `/v1/groups/${id}/join`);
      await api(ctx, eli, 'POST', `/v1/groups/${id}/join`);
      const p = (
        await api(ctx, dan, 'POST', `/v1/groups/${id}/posts`, {
          body: 'Buy my running shoes, DM me',
        })
      ).json();
      // Eli isn't the host; Noa is.
      expect((await api(ctx, eli, 'POST', `/v1/group-posts/${p.id}/remove`)).statusCode).toBe(404);
      expect((await api(ctx, noa, 'POST', `/v1/group-posts/${p.id}/remove`)).statusCode).toBe(204);
      const { rows } = await q(`SELECT 1 FROM audit_logs WHERE action = 'group.post.remove.host'`);
      expect(rows).toHaveLength(1);
      // A host of one group removes nothing in another.
      const other = (await asStaff(admin, 'POST', '/v1/admin/groups', { name: 'Chess' })).json().id;
      await api(ctx, dan, 'POST', `/v1/groups/${other}/join`);
      const q2 = (
        await api(ctx, dan, 'POST', `/v1/groups/${other}/posts`, { body: 'Who plays blitz?' })
      ).json();
      expect((await api(ctx, noa, 'POST', `/v1/group-posts/${q2.id}/remove`)).statusCode).toBe(404);

      // Declined proposals are deleted.
      const second = (await propose(eli, 'Night owls')).json().id;
      await asStaff(admin, 'POST', `/v1/admin/groups/${second}/decision`, { approve: false });
      expect((await api(ctx, eli, 'GET', `/v1/groups/${second}`)).statusCode).toBe(404);
    });

    it('a one-sided crush is never shown; a mutual one opens a match', async () => {
      const id = (await asStaff(admin, 'POST', '/v1/admin/groups', { name: 'Hikers' })).json().id;
      for (const m of [noa, dan, eli]) await api(ctx, m, 'POST', `/v1/groups/${id}/join`);

      const one = await crush(noa, id, dan);
      expect(one.statusCode, one.body).toBe(200);
      expect(one.json()).toMatchObject({
        matchId: null,
        detail: { myCrushes: [dan.id], crushesLeft: 2 },
      });
      // Dan sees nothing of it: not in his detail, not in his likes, not as a match.
      const danView = (await api(ctx, dan, 'GET', `/v1/groups/${id}`)).json();
      expect(danView.myCrushes).toEqual([]);
      // Only Dan's own crush fields exist; nothing says someone has a crush on him.
      expect(Object.keys(danView).sort()).toEqual(['crushesLeft', 'group', 'members', 'myCrushes']);
      expect(danView.crushesLeft).toBe(3);
      expect((await api(ctx, dan, 'GET', '/v1/likes')).json().likes).toEqual([]);
      expect((await api(ctx, dan, 'GET', '/v1/matches')).json().matches ?? []).toEqual([]);

      // Dan marks Noa too: a match for both, and the crushes are gone.
      const back = await crush(dan, id, noa);
      expect(back.json().matchId).toEqual(expect.any(String));
      const noaMatches = (await api(ctx, noa, 'GET', '/v1/matches')).json().matches as {
        id: string;
      }[];
      expect(noaMatches.map((m) => m.id)).toContain(back.json().matchId);
      const { rows } = await q('SELECT 1 FROM group_crushes');
      expect(rows).toHaveLength(0);
      // Already matched: no crush.
      expect((await crush(noa, id, dan)).statusCode).toBe(409);
    });

    it('crushes: a cap of 3, only visible members of my group, cleared by leaving or blocking', async () => {
      const id = (await asStaff(admin, 'POST', '/v1/admin/groups', { name: 'Hikers' })).json().id;
      const others = [dan, eli];
      for (const name of ['Tom', 'Gil']) {
        others.push(await createMember(ctx, { name, gender: 'man', interestedIn: ['woman'] }));
      }
      for (const m of [noa, ...others]) await api(ctx, m, 'POST', `/v1/groups/${id}/join`);
      for (const m of others.slice(0, 3)) expect((await crush(noa, id, m)).statusCode).toBe(200);
      expect((await crush(noa, id, others[3]!)).statusCode).toBe(409);
      // Taking one back frees a place.
      expect((await crush(noa, id, others[2]!, false)).statusCode).toBe(200);
      expect((await crush(noa, id, others[3]!)).statusCode).toBe(200);

      // Not a member: 404. Myself: 404.
      const outsider = await createMember(ctx, {
        name: 'Ron',
        gender: 'man',
        interestedIn: ['woman'],
      });
      expect((await crush(noa, id, outsider)).statusCode).toBe(404);
      expect((await crush(noa, id, noa)).statusCode).toBe(404);
      expect((await crush(outsider, id, noa)).statusCode).toBe(404);

      // Blocking ends a crush both ways; Dan crushing back later opens nothing.
      expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id })).statusCode).toBe(200);
      expect((await crush(dan, id, noa)).statusCode).toBe(404);
      // Leaving the group ends the crushes made there.
      await api(ctx, eli, 'POST', `/v1/groups/${id}/leave`);
      const { rows } = await q('SELECT target_id FROM group_crushes WHERE user_id = $1', [noa.id]);
      expect(rows.map((r) => r.target_id).sort()).toEqual([others[3]!.id].sort());

      // In my export: my own crushes only.
      const zip = unzipSync(
        new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload),
      );
      const data = JSON.parse(strFromU8(zip['data.json']!));
      expect(data.secretCrushes).toMatchObject([{ on: 'Gil', group: 'Hikers' }]);
      const theirs = JSON.parse(
        strFromU8(
          unzipSync(
            new Uint8Array((await api(ctx, others[3]!, 'GET', '/v1/me/export')).rawPayload),
          )['data.json']!,
        ),
      );
      expect(theirs.secretCrushes).toEqual([]);
    });
  },
);
