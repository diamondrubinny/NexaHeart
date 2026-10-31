// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76c end to end: two people who matched play one round of the Question Game, each in their
 * own browser. Neither answer shows until both answered; then both see both. An admin turns the
 * game off in the dashboard.
 * Usage: pnpm --dir e2e game
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser } from 'playwright';
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
const DATA: Record<'en' | 'he', { her: string; him: string; a: string; b: string }> = {
  en: { her: 'Noa', him: 'Dan', a: 'Reading minds, but only kind thoughts', b: 'Never being late' },
  he: { her: 'נועה', him: 'דן', a: 'לקרוא מחשבות, רק טובות', b: 'לא לאחר אף פעם' },
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

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

async function adminSession() {
  const email = `game76-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

await resetSignInLimits();
const admin = await adminSession();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const d = DATA[locale as 'en' | 'he'];
    const ad = adminMessages[locale as 'en' | 'he'].branding;
    await pool.query('DELETE FROM rate_limit');
    await resetRouteLimits();
    await admin.call('PATCH', '/v1/admin/instance', { chatGame: true });
    const noa = await onboardMember(`game76-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`game76-${locale}`, d.him, 'man', ['woman']);
    await dan.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });
    const { matchId } = await noa.call<{ matchId: string }>('POST', '/v1/interactions', {
      targetId: dan.id,
      kind: 'like',
    });

    const N = await open(browser, locale, noa.session);
    const D = await open(browser, locale, dan.session);
    try {
      await N.page.goto(`${WEB}/chat/${matchId}`);
      await D.page.goto(`${WEB}/chat/${matchId}`);
      // 1. Noa starts a question and answers it.
      await N.page.getByRole('button', { name: t.game.start, exact: true }).click();
      const nCard = N.page.getByTestId('game-card');
      await nCard.waitFor();
      await N.page.getByLabel(t.game.yourAnswer).fill(d.a);
      await N.page.getByRole('button', { name: t.game.send, exact: true }).click();
      await N.page.getByText(t.game.waitingFor.replace('{{name}}', d.him)).waitFor();
      check(true, 'Noa answered; she waits for Dan');

      // 2. Dan sees that she answered, never what.
      const dCard = D.page.getByTestId('game-card');
      await dCard.waitFor();
      await D.page.getByText(t.game.theyAnswered.replace('{{name}}', d.her)).waitFor();
      check(!(await dCard.innerText()).includes(d.a), 'Dan doesn’t see her answer before his');
      await audit(D.page, `${locale}/game-question`);

      // 3. Dan answers: both answers show, for both (Noa through realtime).
      await D.page.getByLabel(t.game.yourAnswer).fill(d.b);
      await D.page.getByRole('button', { name: t.game.send, exact: true }).click();
      await D.page.getByTestId('game-reveal').waitFor();
      check((await dCard.innerText()).includes(d.a), 'Dan sees both answers');
      await N.page.getByTestId('game-reveal').waitFor();
      check((await nCard.innerText()).includes(d.b), 'Noa sees both answers');
      await audit(N.page, `${locale}/game-revealed`);
      await nCard.scrollIntoViewIfNeeded();
      await shot(N.page, `${locale}/197-question-game`);
    } finally {
      await N.context.close();
      await D.context.close();
    }

    // 4. The dashboard: turn it off; the chat has no game button.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const box = S.page.getByLabel(ad.chatGame, { exact: true });
      await box.waitFor();
      await box.uncheck();
      await S.page.getByRole('button', { name: ad.communitySave, exact: true }).click();
      await S.page.getByText(ad.communitySaved).first().waitFor();
      const settings = await admin.call<{ chatGame: boolean }>('GET', '/v1/admin/instance');
      check(settings.chatGame === false, 'the community turned the game off');
      await audit(S.page, `${locale}/admin-chat-game`);
      await box.scrollIntoViewIfNeeded();
      await shot(S.page, `${locale}/admin-20-chat-game`);
    } finally {
      await S.context.close();
    }
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/chat/${matchId}`);
      await N2.page.getByTestId('game-card').waitFor();
      check(
        (await N2.page.getByRole('button', { name: t.game.start, exact: true }).count()) === 0,
        'no game button once it is off (the played card stays)',
      );
    } finally {
      await N2.context.close();
    }
  }
} finally {
  await admin.call('PATCH', '/v1/admin/instance', { chatGame: true });
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nQuestion game: OK\n');
