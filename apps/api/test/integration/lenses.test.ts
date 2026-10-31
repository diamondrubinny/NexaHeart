// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, places, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

describe.skipIf(!integrationEnabled)('discovery lenses, phase 76b (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member; // nearby (Ramat Gan), likes hiking too
  let tom: Member; // far (Haifa), short term, joined a month ago
  let eli: Member; // in Tel Aviv but nothing in common; showed up to a date
  const q = (sql: string, params: unknown[] = []) => ctx.services.dbHandle.pool.query(sql, params);
  const seen = async (lens?: string) => {
    const res = await api(ctx, noa, 'GET', `/v1/discover?limit=20${lens ? `&lens=${lens}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().profiles as { id: string }[]).map((p) => p.id).sort();
  };
  const ids = (...m: Member[]) => m.map((x) => x.id).sort();
  const about = (m: Member, interests: string[]) =>
    api(ctx, m, 'PUT', '/v1/me/about', {
      interests,
      children: null,
      smoking: null,
      drinking: null,
      heightCm: null,
      religion: null,
      openingQuestion: null,
    });

  beforeAll(async () => {
    ctx = await setupIntegration();
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    const prefs = { ageMin: 18, ageMax: 99, maxDistanceKm: 200 };
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'], prefs });
    dan = await createMember(ctx, {
      name: 'Dan',
      gender: 'man',
      interestedIn: ['woman'],
      at: places.ramatGan,
      prefs,
    });
    tom = await createMember(ctx, {
      name: 'Tom',
      gender: 'man',
      interestedIn: ['woman'],
      intention: 'short_term',
      at: places.haifa,
      prefs,
    });
    eli = await createMember(ctx, { name: 'Eli', gender: 'man', interestedIn: ['woman'], prefs });
    await about(noa, ['hiking', 'coffee']);
    await about(dan, ['hiking']);
    await about(eli, ['cinema']);
    await q(`UPDATE "user" SET created_at = now() - interval '30 days' WHERE id = $1`, [tom.id]);
    // Eli met someone on a date both said happened.
    const other = await createMember(ctx, { name: 'Maya', gender: 'woman', interestedIn: ['man'] });
    await api(ctx, eli, 'POST', '/v1/interactions', { targetId: other.id, kind: 'like' });
    const liked = await api(ctx, other, 'POST', '/v1/interactions', {
      targetId: eli.id,
      kind: 'like',
    });
    const matchId = liked.json().matchId as string;
    await q(
      `INSERT INTO date_plans (match_id, proposer_id, venue_name, venue_area, venue_category,
        venue_address, venue_step_free, starts_at, status, proposer_met, receiver_met)
       VALUES ($1, $2, 'Café', 'Jaffa', 'cafe', 'Street 1', true, now() - interval '3 days',
        'accepted', true, true)`,
      [matchId, eli.id],
    );
  });

  it('each lens narrows the same deck', async () => {
    expect(await seen()).toEqual(ids(dan, tom, eli));
    expect(await seen('shared_interests')).toEqual(ids(dan));
    expect(await seen('nearby')).toEqual(ids(dan, eli)); // Ramat Gan is ~4 km away
    expect(await seen('new_here')).toEqual(ids(dan, eli));
    expect(await seen('same_goal')).toEqual(ids(dan, eli));
    expect(await seen('shows_up')).toEqual(ids(eli));
  });

  it('never shows anyone the filters would hide', async () => {
    // Noa's distance limit drops to 10 km: Tom is gone from every lens, too.
    await api(ctx, noa, 'PUT', '/v1/me/preferences', {
      ageMin: 18,
      ageMax: 99,
      maxDistanceKm: 10,
      intentions: [],
    });
    expect(await seen('new_here')).toEqual(ids(dan, eli));
    // A blocked person stays out of the lens that would fit them.
    expect((await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id })).statusCode).toBe(200);
    expect(await seen('shared_interests')).toEqual([]);
  });

  it('only the lenses the community offers', async () => {
    const info = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(info.community.lenses).toEqual([
      'shared_interests',
      'nearby',
      'new_here',
      'same_goal',
      'shows_up',
    ]);
    await q(`INSERT INTO instance_settings (id, discovery_lenses) VALUES (1, '{nearby}')
      ON CONFLICT (id) DO UPDATE SET discovery_lenses = '{nearby}'`);
    ctx.services.instance.invalidate();
    const after = (await ctx.app.inject({ method: 'GET', url: '/v1/instance' })).json();
    expect(after.community.lenses).toEqual(['nearby']);
    expect(await seen('nearby')).toEqual(ids(dan, eli));
    const off = await api(ctx, noa, 'GET', '/v1/discover?lens=shows_up');
    expect(off.statusCode).toBe(400);
    expect((await api(ctx, noa, 'GET', '/v1/discover?lens=bogus')).statusCode).toBe(400);
  });
});
