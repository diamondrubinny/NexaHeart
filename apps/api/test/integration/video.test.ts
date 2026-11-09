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
import type { Transcriber } from '../../../worker/src/transcribe.js';
import { markCaptionsFailed, processCaptions } from '../../../worker/src/transcript-jobs.js';
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
  /** An approval names the captions the moderator saw: taken from the queue unless given. */
  const decide = async (id: string, body: { approve: boolean; [key: string]: unknown }) => {
    let payload = body;
    if (body.approve && body.captionsVersion === undefined) {
      const queue = (await get(staff, '/v1/admin/videos')).json().videos as {
        id: string;
        captionsVersion: string;
      }[];
      payload = {
        ...body,
        captionsVersion: queue.find((v) => v.id === id)?.captionsVersion ?? 'not-in-queue',
      };
    }
    return ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/videos/${id}/decision`,
      headers: { cookie: staff },
      payload,
    });
  };

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
          payload: { approve: true, captionsVersion: 'x' },
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
    // The WebM rendition, for browsers without H.264.
    const webm = await get(dan.cookie, `${seen.url}?format=webm`, { range: 'bytes=0-3' });
    expect(webm.statusCode).toBe(206);
    expect(webm.headers['content-type']).toBe('video/webm');
    expect(webm.rawPayload).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

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
    expect(ctx.jobs.delete.at(-1)!.mediaKeys).toHaveLength(3);
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

  it('77e: nobody reviews their own video; a late worker run never undoes a decision', async () => {
    const own = await moderator();
    const {
      rows: [me],
    } = await ctx.services.dbHandle.pool.query(
      `SELECT id FROM "user" WHERE role = 'moderator' ORDER BY created_at DESC LIMIT 1`,
    );
    const { rows } = await ctx.services.dbHandle.pool.query(
      `INSERT INTO profile_videos (user_id, prompt_key, status, media_key, poster_key, duration_ms)
       VALUES ($1, 'perfect_sunday', 'review', 'videos/x.mp4', 'videos/x.jpg', 1000) RETURNING id`,
      [me.id],
    );
    const selfDecision = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/videos/${rows[0].id}/decision`,
      headers: { cookie: own },
      payload: { approve: true, captionsVersion: 'x' },
    });
    expect(selfDecision.statusCode).toBe(403);

    // Noa's video: processed, rejected; then a duplicate job runs again.
    const video = (await upload(noa, clip)).json().video;
    const job = ctx.jobs.video.at(-1)!;
    await processVideo(worker, job);
    expect((await decide(video.id, { approve: false, reason: 'offensive' })).statusCode).toBe(204);
    await ctx.services.dbHandle.pool.query(
      `UPDATE profile_videos SET quarantine_key = $2 WHERE id = $1`,
      [video.id, `videos/${noa.id}/${video.id}`],
    );
    expect(await processVideo(worker, job)).toBe('skipped');
    expect((await api(ctx, noa, 'GET', '/v1/me/video')).json().video.status).toBe('rejected');
  });

  it('77e: a server-side failure is retried; on the last attempt the video is refused', async () => {
    await upload(noa, clip);
    const job = ctx.jobs.video.at(-1)!;
    const broken = { ...worker, ffprobePath: '/nonexistent/ffprobe' };
    await expect(processVideo(broken, job)).rejects.toThrow();
    expect((await api(ctx, noa, 'GET', '/v1/me/video')).json().video.status).toBe('processing');
    expect(await processVideo(broken, job, true)).toBe('rejected');
    expect((await api(ctx, noa, 'GET', '/v1/me/video')).json().video).toMatchObject({
      status: 'rejected',
      rejectReason: 'undecodable',
    });
  });

  describe('captions (phase 80)', () => {
    const chunks = [
      { start: 0, end: 1.2, text: ' My first date idea ' },
      { start: 1.2, end: null, text: 'is a <b>walk</b> on the beach' },
    ];
    const asked: string[] = [];
    const model = (answer: typeof chunks | Error = chunks): Transcriber => ({
      transcribe: async () => '',
      transcribeTimed: async (_media, lang) => {
        asked.push(lang);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    /** A worker that hands videos over to the captions job, like the real one. */
    const queued: string[] = [];
    const captioning = (): JobContext => ({
      ...worker,
      enqueueCaptions: async (videoId) => void queued.push(videoId),
    });
    const uploadIn = (m: Member, lang: string) => {
      const body = multipart(clip);
      return ctx.app.inject({
        method: 'POST',
        url: `/v1/me/video?promptKey=first_date_idea&lang=${lang}`,
        payload: body.payload,
        headers: { ...body.headers, cookie: m.cookie },
      });
    };
    const mine = async (m: Member) => (await api(ctx, m, 'GET', '/v1/me/video')).json().video;
    const setLines = (m: Member, lines: string[] | null) =>
      api(ctx, m, 'PUT', '/v1/me/video/captions', { lines });
    beforeEach(() => {
      asked.length = 0;
      queued.length = 0;
    });

    it('captions are made before review, approved with the video, and reach viewers', async () => {
      const video = (await uploadIn(noa, 'he')).json().video;
      expect(video.captions).toEqual({ status: 'off', lang: 'he', cues: [] });
      expect(await processVideo(captioning(), ctx.jobs.video.at(-1)!)).toBe('captioning');
      expect(queued).toEqual([video.id]);
      // Still being prepared: not in the moderators' queue yet.
      expect(await mine(noa)).toMatchObject({
        status: 'processing',
        url: null,
        captions: { status: 'pending' },
      });
      expect((await get(staff, '/v1/admin/videos')).json().videos).toEqual([]);

      expect(await processCaptions(worker, model(), { videoId: video.id })).toBe('done');
      expect(asked).toEqual(['he']);
      const ready = await mine(noa);
      expect(ready.status).toBe('review');
      expect(ready.captions).toEqual({
        status: 'done',
        lang: 'he',
        cues: [
          { start: 0, end: 1200, text: 'My first date idea' },
          { start: 1200, end: ready.durationMs, text: 'is a <b>walk</b> on the beach' },
        ],
      });
      // A second run does nothing.
      expect(await processCaptions(worker, model(), { videoId: video.id })).toBe('skipped');

      const [inQueue] = (await get(staff, '/v1/admin/videos')).json().videos;
      expect(inQueue.captions.cues).toHaveLength(2);
      expect(inQueue.captionFlags).toEqual([]);
      expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt).toBeNull();
      expect(
        (await decide(video.id, { approve: true, captionsVersion: inQueue.captionsVersion }))
          .statusCode,
      ).toBe(204);
      const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt;
      expect(seen.captions).toEqual({ lang: 'he', cues: ready.captions.cues });
    });

    it('the owner corrects the words: harm-checked, and an approved video is reviewed again', async () => {
      const video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      await processCaptions(worker, model(), { videoId: video.id });
      // Before approval: corrected in place.
      expect((await setLines(noa, ['Only one line'])).statusCode).toBe(409);
      expect((await setLines(noa, ['You idiot', 'ok'])).statusCode).toBe(422);
      expect((await setLines(noa, ['I will', 'kill you'])).statusCode).toBe(422);
      expect((await setLines(noa, ['Line\u202Eone', 'two'])).statusCode).toBe(400);
      const stale = (await get(staff, '/v1/admin/videos')).json().videos[0].captionsVersion;
      const fixed = await setLines(noa, ['My first-date idea', 'is a walk on the beach']);
      expect(fixed.statusCode, fixed.body).toBe(200);
      expect(fixed.json().video).toMatchObject({ status: 'review' });
      expect(fixed.json().video.captions.cues.map((c: { text: string }) => c.text)).toEqual([
        'My first-date idea',
        'is a walk on the beach',
      ]);
      expect(fixed.json().video.captions.cues[1].start).toBe(1200);
      // The moderator's page showed the old words: the approval is refused.
      expect((await decide(video.id, { approve: true, captionsVersion: stale })).statusCode).toBe(
        409,
      );
      const fresh = (await get(staff, '/v1/admin/videos')).json().videos[0].captionsVersion;
      expect((await decide(video.id, { approve: true, captionsVersion: fresh })).statusCode).toBe(
        204,
      );
      // The same words again: nothing changes. Different words: back to review, hidden meanwhile.
      await setLines(noa, ['My first-date idea', 'is a walk on the beach']);
      expect((await mine(noa)).status).toBe('clean');
      await setLines(noa, ['My first-date idea', 'is a walk on the sand']);
      expect((await mine(noa)).status).toBe('review');
      expect((await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt).toBeNull();
      // Dan can't touch Noa's captions (he has no video: 404).
      expect((await setLines(dan, ['x', 'y'])).statusCode).toBe(404);
    });

    it('turning captions off needs no review; flagged words are noted for moderators only', async () => {
      const video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      await processCaptions(worker, model([{ start: 0, end: 1, text: 'I will kill you' }]), {
        videoId: video.id,
      });
      const [inQueue] = (await get(staff, '/v1/admin/videos')).json().videos;
      expect(inQueue.captionFlags.length).toBeGreaterThan(0);
      expect(JSON.stringify(await mine(noa))).not.toContain('captionFlags');
      await decide(video.id, { approve: true });
      const off = await setLines(noa, null);
      expect(off.json().video).toMatchObject({
        status: 'clean',
        captions: { status: 'off', cues: [] },
      });
      const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt;
      expect(seen.captions).toBeNull();
      // Once off there are no lines to correct.
      expect((await setLines(noa, ['again'])).statusCode).toBe(409);
    });

    it('no captions for "voice only", without speech, or when the model fails; the video still reaches review', async () => {
      // No speech found.
      let video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      expect(await processCaptions(worker, model([]), { videoId: video.id })).toBe('none');
      expect(await mine(noa)).toMatchObject({ status: 'review', captions: { status: 'none' } });

      // The model fails: retried, and the last attempt releases the video.
      video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      await expect(
        processCaptions(worker, model(new Error('model down')), { videoId: video.id }),
      ).rejects.toThrow('model down');
      expect((await mine(noa)).status).toBe('processing');
      await markCaptionsFailed(worker, video.id);
      expect(await mine(noa)).toMatchObject({ status: 'review', captions: { status: 'failed' } });

      // The queue is down: straight to review.
      await uploadIn(noa, 'en');
      const down: JobContext = {
        ...worker,
        enqueueCaptions: async () => {
          throw new Error('redis down');
        },
      };
      expect(await processVideo(down, ctx.jobs.video.at(-1)!)).toBe('review');
      expect(await mine(noa)).toMatchObject({ status: 'review', captions: { status: 'failed' } });

      // "Voice only" (phase 26): never transcribed, even if chosen after the upload.
      video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      const pref = await api(ctx, noa, 'PUT', '/v1/me/settings', { allowTranscripts: false });
      expect(pref.statusCode, pref.body).toBeLessThan(300);
      asked.length = 0;
      expect(await processCaptions(worker, model(), { videoId: video.id })).toBe('not allowed');
      expect(asked).toEqual([]);
      expect(await mine(noa)).toMatchObject({ status: 'review', captions: { status: 'off' } });
      await uploadIn(noa, 'en');
      queued.length = 0;
      expect(await processVideo(captioning(), ctx.jobs.video.at(-1)!)).toBe('review');
      expect(queued).toEqual([]);
    });

    it('review fixes: an approval must name the words; new words are always reviewed; "voice only" and a rejection delete them', async () => {
      const video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      await processCaptions(worker, model(), { videoId: video.id });
      // Without the version an approval isn't accepted at all.
      const bare = await ctx.app.inject({
        method: 'POST',
        url: `/v1/admin/videos/${video.id}/decision`,
        headers: { cookie: staff },
        payload: { approve: true },
      });
      expect(bare.statusCode).toBe(400);
      // A flagged line the model wrote doesn't stop the owner from fixing another line, and the
      // moderator still gets the note.
      await ctx.services.dbHandle.pool.query(
        `UPDATE profile_videos SET captions = $2 WHERE id = $1`,
        [
          video.id,
          JSON.stringify([
            { start: 0, end: 1000, text: 'I will kill you' },
            { start: 1000, end: 2000, text: 'a wlak on the beach' },
          ]),
        ],
      );
      const fixed = await setLines(noa, ['I will kill you', 'a walk on the beach']);
      expect(fixed.statusCode, fixed.body).toBe(200);
      expect((await get(staff, '/v1/admin/videos')).json().videos[0].captionFlags.length).toBe(1);
      expect((await setLines(noa, ['I will kill you all', 'a walk'])).statusCode).toBe(422);

      expect((await decide(video.id, { approve: true })).statusCode).toBe(204);
      // "Voice only": the words already made are deleted, for viewers too.
      await api(ctx, noa, 'PUT', '/v1/me/settings', { allowTranscripts: false });
      expect(await mine(noa)).toMatchObject({ status: 'clean', captions: { status: 'off' } });
      const seen = (await api(ctx, dan, 'GET', `/v1/profiles/${noa.id}`)).json().videoPrompt;
      expect(seen.captions).toBeNull();

      // A rejection deletes the words with the media.
      await api(ctx, noa, 'PUT', '/v1/me/settings', { allowTranscripts: true });
      const second = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      await processCaptions(worker, model(), { videoId: second.id });
      await decide(second.id, { approve: false, reason: 'offensive' });
      const { rows } = await ctx.services.dbHandle.pool.query(
        'SELECT captions, caption_flags FROM profile_videos WHERE id = $1',
        [second.id],
      );
      expect(rows[0]).toEqual({ captions: null, caption_flags: [] });
    });

    it('the words are in my export', async () => {
      const video = (await uploadIn(noa, 'en')).json().video;
      await processVideo(captioning(), ctx.jobs.video.at(-1)!);
      await processCaptions(worker, model(), { videoId: video.id });
      const zip = unzipSync(
        new Uint8Array((await api(ctx, noa, 'GET', '/v1/me/export')).rawPayload),
      );
      const data = JSON.parse(strFromU8(zip['data.json']!));
      expect(data.videoPrompt.captions).toHaveLength(2);
      expect(data.videoPrompt.captionsStatus).toBe('done');
    });
  });
});
