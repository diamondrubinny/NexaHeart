// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76d end to end: Noa writes a poll on her profile (Profile → "A poll on my profile"); Dan
 * opens her profile, picks an answer and likes; Noa's likes say what he picked.
 * Usage: pnpm --dir e2e poll
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
const DATA: Record<'en' | 'he', { her: string; him: string; q: string; answers: string[] }> = {
  en: {
    her: 'Noa',
    him: 'Dan',
    q: 'Perfect first date?',
    answers: ['Coffee', 'A long walk', 'Hummus'],
  },
  he: {
    her: 'נועה',
    him: 'דן',
    q: 'הדייט הראשון המושלם?',
    answers: ['קפה', 'הליכה ארוכה', 'חומוס'],
  },
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
    const d = DATA[locale as 'en' | 'he'];
    const noa = await onboardMember(`poll76-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`poll76-${locale}`, d.him, 'man', ['woman']);

    // 1. Noa writes her poll (two answers here, a third one optional).
    const N = await open(browser, locale, noa);
    try {
      await N.page.goto(`${WEB}/poll`);
      await N.page.getByLabel(t.poll.question).fill(d.q);
      for (const [i, answer] of d.answers.entries()) {
        await N.page.getByLabel(t.poll.answer.replace('{{n}}', String(i + 1))).fill(answer);
      }
      await audit(N.page, `${locale}/poll-editor`);
      await shot(N.page, `${locale}/198-poll-editor`);
      await N.page.getByRole('button', { name: t.common.save, exact: true }).click();
      await N.page.waitForURL((url) => url.pathname !== '/poll');
      const saved = await noa.call<{ poll: { question: string; answers: string[] } | null }>(
        'GET',
        '/v1/me/poll',
      );
      check(
        saved.poll?.question === d.q && saved.poll.answers.length === 3,
        'the poll is on her profile',
      );
    } finally {
      await N.context.close();
    }

    // 2. Dan opens her profile, picks the third answer and likes.
    const D = await open(browser, locale, dan);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const poll = D.page.getByTestId('profile-poll');
      await poll.waitFor();
      await D.page.getByRole('radio', { name: d.answers[2], exact: true }).click();
      await poll.scrollIntoViewIfNeeded();
      await audit(D.page, `${locale}/poll-pick`);
      await shot(D.page, `${locale}/199-poll-pick`);
      await D.page.getByRole('button', { name: `♥ ${t.discover.like}` }).click();
      await D.page.waitForTimeout(800);
    } finally {
      await D.context.close();
    }

    // 3. Noa's likes say what he picked.
    const N2 = await open(browser, locale, noa);
    try {
      await N2.page.goto(`${WEB}/likes`);
      const line = t.poll.picked.replace('{{answer}}', d.answers[2]!);
      await N2.page.getByText(line, { exact: false }).first().waitFor();
      check(true, 'her likes say what he picked');
      await audit(N2.page, `${locale}/poll-likes`);
    } finally {
      await N2.context.close();
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
process.stdout.write('\nPrompt polls: OK\n');
