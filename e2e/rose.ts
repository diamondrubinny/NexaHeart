// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76a end to end: Dan sends this week's rose from Noa's profile; then the button shows when
 * the next one comes; Noa sees the rose first in Likes.
 * Usage: pnpm --dir e2e rose
 */
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { ar } from '../apps/mobile/src/i18n/ar.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import { ru } from '../apps/mobile/src/i18n/ru.ts';
import {
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetSignInLimits,
  shot,
  WEB,
  type OnboardedMember,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const T = { en, he, ar, ru } as const;
type L = keyof typeof T;
const NAMES: Record<'en' | 'he', [string, string, string]> = {
  en: ['Noa', 'Dan', 'Tom'],
  he: ['נועה', 'דן', 'תום'],
};

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};

async function open(browser: Browser, locale: L, member: OnboardedMember) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
  });
  const { name, value } = member.session;
  await context.addCookies([
    { name, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page };
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const [her, him, other] = NAMES[locale as 'en' | 'he'];
    const noa = await onboardMember(`rose76-${locale}`, her, 'woman', ['man']);
    const dan = await onboardMember(`rose76-${locale}`, him, 'man', ['woman']);
    const tom = await onboardMember(`rose76-${locale}`, other, 'man', ['woman']);
    await tom.call('POST', '/v1/interactions', { targetId: noa.id, kind: 'like' });

    // 1. Dan sends his rose from Noa's profile.
    const D = await open(browser, locale, dan);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const send = D.page.getByRole('button', { name: `🌹 ${t.rose.send}` });
      await send.waitFor();
      await audit(D.page, `${locale}/rose-send`);
      await send.click();
      await D.page.waitForTimeout(800);
      const status = await dan.call<{ available: boolean; nextAt: string | null }>(
        'GET',
        '/v1/me/rose',
      );
      check(!status.available && status.nextAt !== null, 'the rose was sent; the next in a week');
      // On another profile, the button is gone and says when the next one comes.
      const eve = await onboardMember(`rose76b-${locale}`, 'Eve', 'woman', ['man']);
      await D.page.goto(`${WEB}/profile/${eve.id}`);
      await D.page.getByTestId('rose-next').waitFor();
      check(true, 'afterwards: when the next rose comes');
    } finally {
      await D.context.close();
    }

    // 2. Noa sees the rose first in Likes.
    const N = await open(browser, locale, noa);
    try {
      await N.page.goto(`${WEB}/likes`);
      const rose = N.page.getByText(`🌹 ${t.rose.received}`);
      await rose.waitFor();
      const order = await N.page.evaluate(
        ([a, b]) => {
          const text = document.body.innerText;
          return text.indexOf(a!) < text.indexOf(b!);
        },
        [him, other],
      );
      check(order, 'the rose comes first in Likes, marked');
      await audit(N.page, `${locale}/likes-rose`);
      await shot(N.page, `${locale}/195-likes-rose`);
    } finally {
      await N.context.close();
    }
  }
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nWeekly rose: OK\n');
