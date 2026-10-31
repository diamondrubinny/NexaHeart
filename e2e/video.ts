// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76h end to end: Noa uploads a video answer in the app (it waits for review), a moderator
 * watches it in the dashboard and approves it, and Dan plays it on her profile.
 * Needs the worker running (it scans and re-encodes the upload).
 * Usage: pnpm --dir e2e video
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type Locator } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  apiClient,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  resetSignInLimits,
  shot,
  signInHttp,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES = { en: { her: 'Noa', him: 'Dan' }, he: { her: 'נועה', him: 'דן' } } as const;

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

// A short test clip with a location tag (it must not survive the re-encode).
const clipPath = join(mkdtempSync(join(tmpdir(), 'e2e-video-')), 'sunday.mp4');
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=960x540:rate=25:duration=4',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=4',
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
  clipPath,
]);

async function open(
  browser: Browser,
  locale: L,
  session: { name: string; value: string },
  width = 390,
) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 900 : 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  await context.addCookies([
    { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => {
    localStorage.setItem('nexaheart.locale', l);
    localStorage.setItem('nexaheart-admin-locale', l);
  }, locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });

async function moderatorSession() {
  const email = `video76-mod-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'moderator' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return session;
}

/** Whether the browser loaded the video's metadata (it can play it), within 20 s. */
async function playable(video: Locator): Promise<boolean> {
  return video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<boolean>((resolve) => {
        if (v.error) return resolve(false);
        if (v.readyState >= 1) return resolve(v.duration > 3);
        v.addEventListener('loadedmetadata', () => resolve(v.duration > 3));
        v.addEventListener('error', () => resolve(false));
        setTimeout(() => resolve(false), 20_000);
      }),
  );
}

async function waitForStatus(userId: string, status: string, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { rows } = await pool.query('SELECT status FROM profile_videos WHERE user_id = $1', [
      userId,
    ]);
    if (rows[0]?.status === status) return true;
    if (rows[0]?.status === 'rejected') return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

await resetSignInLimits();
const moderator = await moderatorSession();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const names = NAMES[locale as 'en' | 'he'];
    const a = adminMessages[locale as 'en' | 'he'].videos;
    await pool.query('DELETE FROM rate_limit');
    await resetRouteLimits();
    // Earlier runs' videos, so the queue shows only this run's.
    await pool.query(`DELETE FROM profile_videos WHERE status = 'review'`);
    const noa = await onboardMember(`video76-${locale}`, names.her, 'woman', ['man']);
    const dan = await onboardMember(`video76-${locale}`, names.him, 'man', ['woman']);

    // 1. Noa chooses a prompt and uploads her video.
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/video`);
      await N.page.getByRole('button', { name: t.video.choose, exact: true }).waitFor();
      await audit(N.page, `${locale}/video-editor`);
      await N.page.getByRole('radio', { name: t.prompt.first_date_idea }).click();
      const chooser = N.page.waitForEvent('filechooser');
      await N.page.getByRole('button', { name: t.video.choose, exact: true }).click();
      await (await chooser).setFiles(clipPath);
      check(await waitForStatus(noa.id, 'review'), 'the worker scanned and re-encoded it');
      await N.page.getByText(t.video.review).waitFor({ timeout: 20_000 });
      await N.page.getByTestId('video-poster').waitFor();
      check(true, 'Noa sees "waiting for review" and her own preview');
      await audit(N.page, `${locale}/video-review`);
      await shot(N.page, `${locale}/203-video-review`);
    } finally {
      await N.context.close();
    }

    // Not on her profile yet.
    const before = await dan.call<{ videoPrompt: unknown }>('GET', `/v1/profiles/${noa.id}`);
    check(before.videoPrompt === null, 'nobody else sees it before review');

    // 2. The dashboard: watch and approve.
    const S = await open(browser, locale, moderator, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/videos`);
      const watch = a.watch.replace('{{name}}', names.her);
      const play = S.page.getByRole('button', { name: new RegExp(watch) });
      await play.waitFor();
      await play.click();
      const player = S.page.getByLabel(watch, { exact: true }).locator('xpath=self::video');
      await player.waitFor();
      check(await playable(player), 'the moderator can play it');
      await audit(S.page, `${locale}/admin-videos`);
      await shot(S.page, `${locale}/admin-23-videos`);
      await S.page.getByRole('button', { name: `${a.approve} ${names.her}` }).click();
      await S.page.getByText(a.approved.replace('{{name}}', names.her)).waitFor();
      check(true, 'approved');
    } finally {
      await S.context.close();
    }

    // 3. Dan plays it on Noa's profile.
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const block = D.page.getByTestId('profile-video');
      await block.waitFor();
      check((await block.innerText()).includes(t.prompt.first_date_idea), 'the prompt is shown');
      await block.scrollIntoViewIfNeeded();
      await audit(D.page, `${locale}/video-profile`);
      await shot(D.page, `${locale}/204-video-profile`);
      await block.getByTestId('video-poster').click();
      const video = D.page.getByTestId('video-player');
      await video.waitFor();
      const state = {
        ok: await playable(video),
        muted: await video.evaluate((v: HTMLVideoElement) => v.muted),
      };
      check(state.ok, 'Dan plays the video');
      check(state.muted, 'it starts muted');
      await audit(D.page, `${locale}/video-playing`);
    } finally {
      await D.context.close();
    }
  }
} finally {
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nVideo prompts: OK\n');
