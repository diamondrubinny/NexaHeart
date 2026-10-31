// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { TextModel } from '@nexaheart/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createMember, type Member } from './members.js';
import {
  integrationEnabled,
  resetState,
  setupIntegration,
  teardown,
  type TestContext,
} from './setup.js';

let external = false;
const reply = '{"interests": ["hiking", "baking", "astrology"], "smoking": "no", "religion": "x"}';
const sent: string[] = [];
const model: TextModel = {
  name: 'fake',
  get external() {
    return external;
  },
  async complete({ user }) {
    sent.push(user);
    return reply;
  },
};

describe.skipIf(!integrationEnabled)('the onboarding interview, phase 75c (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  const suggest = (m: Member, answers: object[]) =>
    api(ctx, m, 'POST', '/v1/me/interview/suggest', { answers });
  const answers = [
    { promptKey: 'perfect_sunday', answer: 'A long hike, then baking bread' },
    { promptKey: 'looking_for', answer: 'Someone kind and curious' },
  ];

  beforeAll(async () => {
    ctx = await setupIntegration({ textModel: model });
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    external = false;
    sent.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
  });

  it('proposes valid fields from the person’s own answers only', async () => {
    const res = await suggest(noa, answers);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      interests: ['hiking', 'baking'],
      children: null,
      smoking: 'no',
      drinking: null,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('A long hike');
    // Nothing else about her: no name, account, gender or location.
    for (const never of ['Noa', noa.id, 'woman', '32.08']) expect(sent[0]).not.toContain(never);
    // Nothing is saved by asking: her profile is unchanged.
    const me = (await api(ctx, noa, 'GET', '/v1/me')).json();
    expect(me.about?.interests ?? []).toEqual([]);
  });

  it('validates answers; external model needs her own consent; limits', async () => {
    for (const bad of [
      [],
      [{ promptKey: 'green_flag', answer: 'x' }],
      [{ promptKey: 'perfect_sunday', answer: '' }],
      [{ promptKey: 'perfect_sunday', answer: 'x'.repeat(301) }],
      [{ promptKey: 'perfect_sunday', answer: 'ok', extra: 1 }],
    ]) {
      expect((await suggest(noa, bad)).statusCode).toBe(400);
    }
    external = true;
    expect((await suggest(noa, answers)).statusCode).toBe(409);
    await api(ctx, noa, 'PUT', '/v1/me/consents', {
      consents: [{ kind: 'ai_cloud', granted: true, version: '1' }],
    });
    expect((await suggest(noa, answers)).statusCode).toBe(200);
    // Dan's consent isn't needed: only Noa's words are sent.
    void dan;
    for (let i = 0; i < 19; i += 1) await suggest(noa, answers);
    expect((await suggest(noa, answers)).statusCode).toBe(429);
  });
});
