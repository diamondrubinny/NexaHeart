// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processVideo, type JobContext } from '../../../worker/src/jobs.js';
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

const BOUNDARY = 'videoboundary';
let clip: Buffer;
function makeClip(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'video-it-'));
  const out = join(dir, 'v.mp4');
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=24:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-metadata',
    'location=+32.0853+034.7818/',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    '-y',
    out,
  ]);
  return readFileSync(out);
}
const multipart = (file: Buffer) => ({
  payload: Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="v.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]),
  headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
});

describe.skipIf(!integrationEnabled)('video prompts, phase 76h (integration)', () => {
  let ctx: TestContext;
  let noa: Member;
  let dan: Member;
  let worker: JobContext;
  let staff: string;

  const upload = (m: Member, file: Buffer, promptKey = 'perfect_sunday') => {
    const body = multipart(file);
    return ctx.app.inject({
      method: 'POST',
      url: `/v1/me/video?promptKey=${promptKey}`,
      payload: body.payload,
      headers: { ...body.headers, cookie: m.cookie },
    });
  };
  const get = (cookie: string, url: string, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method: 'GET', url, headers: { cookie, ...headers } });
  const process = async () => {
    const job = ctx.jobs.video.at(-1)!;
    return processVideo(worker, job);
  };
  const moderator = async () => {
    const email = `video-mod-${Date.now()}@example.test`;
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
    return cookie;
  };
  const decide = (id: string, body: object) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/videos/${id}/decision`,
      headers: { cookie: staff },
      payload: body,
    });

  beforeAll(async () => {
    ctx = await setupIntegration();
    clip = makeClip();
    worker = {
      db: ctx.services.dbHandle.db,
      storage: ctx.services.storage,
      scanner: { scan: async () => ({ clean: true }) },
      scanningEnabled: true,
      log: { warn: () => undefined, info: () => undefined } as never,
    };
  });
  afterAll(async () => teardown(ctx));
  beforeEach(async () => {
    await resetState(ctx);
    ctx.jobs.video.length = 0;
    noa = await createMember(ctx, { name: 'Noa', gender: 'woman', interestedIn: ['man'] });
    dan = await createMember(ctx, { name: 'Dan', gender: 'man', interestedIn: ['woman'] });
    staff = await moderator();
  });

  it('upload → quarantine → review → approved: shown with ranges, only to who may see Noa', async () => {
    const uploaded = await upload(noa, clip);
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const video = uploaded.json().video;
    expect(video).toMatchObject({ status: 'quarantine', promptKey: 'perfect_sunday', url: null });
    // Not visible while in quarantine, even to the owner's file route; not on the profile.
    expect((await get(dan.cookie, `/v1/videos/${video.id}`)).statusCode).toBe(404);
    expect((await get(noa.cookie, `/v1/videos/${video.id}`)).statusCode).toBe(404);

    expect(await process()).toBe('review');
    const mine = (await api(ctx, noa, 'GET', '/v1/me/video')).json().video;
    expect(mine).toMatchObject({ status: 'review', url: `/v1/videos/${video.id}` });
    expect(mine.durationMs).toBeGreaterThan(1500);
    // The owner previews it while it waits; others don't see it yet.
    const preview = await get(noa.cookie, mine.url);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('video/mp4');
    expect(preview.rawPayload.includes(Buffer.from('+32.0853'))).toBe(false);
    expect((await get(dan.cookie, mine.url)).statusCode).toBe(404);
    expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt).toBeNull();

    // A member can't approve their own (or anyone's) video.
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/v1/admin/videos/${video.id}/decision`,
          headers: { cookie: noa.cookie },
          payload: { approve: true },
        })
      ).statusCode,
    ).toBe(403);
    const queue = await get(staff, '/v1/admin/videos');
    expect(queue.json().videos).toMatchObject([{ id: video.id, displayName: 'Noa' }]);
    expect((await get(staff, `/v1/admin/videos/${video.id}/file`)).statusCode).toBe(200);
    expect((await decide(video.id, { approve: true })).statusCode).toBe(204);

    const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt;
    expect(seen).toMatchObject({ id: video.id, promptKey: 'perfect_sunday' });
    const full = await get(dan.cookie, seen.url);
    expect(full.statusCode).toBe(200);
    expect(full.headers['cache-control']).toBe('no-store');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    const part = await get(dan.cookie, seen.url, { range: 'bytes=0-99' });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(100);
    expect(part.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect((await get(dan.cookie, seen.posterUrl)).headers['content-type']).toBe('image/jpeg');

    // Blocked: gone, both from the profile and the file.
    await api(ctx, noa, 'POST', '/v1/blocks', { userId: dan.id });
    expect((await get(dan.cookie, seen.url)).statusCode).toBe(404);
    expect(
      (
        await ctx.services.dbHandle.pool.query(
          `SELECT 1 FROM audit_logs WHERE action = 'video.approved' AND target_id = $1`,
          [video.id],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('a rejection needs a reason, deletes the media and tells the owner why', async () => {
    const video = (await upload(noa, clip)).json().video;
    await process();
    expect((await decide(video.id, { approve: false })).statusCode).toBe(400);
    expect((await decide(video.id, { approve: false, reason: 'nudity' })).statusCode).toBe(204);
    expect((await api(ctx, noa, 'GET', '/v1/me/video')).json().video).toMatchObject({
      status: 'rejected',
      rejectReason: 'nudity',
      url: null,
    });
    expect(ctx.jobs.delete.at(-1)!.mediaKeys).toHaveLength(2);
    expect((await decide(video.id, { approve: true })).statusCode).toBe(409);
    expect((await get(noa.cookie, `/v1/videos/${video.id}`)).statusCode).toBe(404);
  });

  it('refuses what isn’t a video, and a bad prompt; a new video replaces the old', async () => {
    expect((await upload(noa, Buffer.from('not a video at all, just text'))).statusCode).toBe(415);
    expect((await upload(noa, clip, 'no_such_prompt')).statusCode).toBe(400);
    const first = (await upload(noa, clip)).json().video;
    await process();
    const second = (await upload(noa, clip, 'green_flag')).json().video;
    expect(second.id).not.toBe(first.id);
    // The first one's media is queued for deletion.
    expect(ctx.jobs.delete.at(-1)!.mediaKeys.join(' ')).toContain(first.id);
    expect((await get(noa.cookie, `/v1/videos/${first.id}`)).statusCode).toBe(404);
    // A job for a replaced video does nothing.
    expect(await processVideo(worker, { videoId: first.id })).toBe('skipped');
    expect((await api(ctx, noa, 'DELETE', '/v1/me/video')).json()).toEqual({ video: null });
    expect((await api(ctx, noa, 'GET', '/v1/me/video')).json()).toEqual({ video: null });
  });

  it('is in my export, in a report of me, and deleted with my account', async () => {
    const video = (await upload(noa, clip)).json().video;
    await process();
    const zip = unzipSync(new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload));
    const data = JSON.parse(strFromU8(zip['data.json']!));
    expect(data.videoPrompt).toMatchObject({ id: video.id, status: 'review' });
    expect(zip[`video/${video.id}.mp4`]!.length).toBeGreaterThan(1000);

    const reported = await api(ctx, dan, 'POST', '/v1/reports', {
      targetId: noa.id,
      category: 'harassment',
      block: false,
    });
    const detail = await get(staff, `/v1/admin/reports/${reported.json().reportId}`);
    expect(detail.json().reportedProfile.video).toMatchObject({
      id: video.id,
      url: `/v1/admin/videos/${video.id}/file`,
    });

    await ctx.services.me.deleteAccount(noa.id);
    expect(
      (await ctx.services.dbHandle.pool.query('SELECT 1 FROM profile_videos')).rows,
    ).toHaveLength(0);
    expect(ctx.jobs.delete.at(-1)!.mediaKeys.join(' ')).toContain(video.id);
  });
});
