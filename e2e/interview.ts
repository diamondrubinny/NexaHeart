// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 75c end to end: Profile → "Start with a short interview": answer two questions, skip two;
 * keep one answer as a prompt answer, word for word; tick a suggested interest; save. Needs the API
 * with the local stand-in model (see ask-profile.ts).
 * Usage: pnpm --dir e2e interview
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
const ANSWERS: Record<'en' | 'he', { sunday: string; geek: string }> = {
  en: { sunday: 'A morning hike, then cooking for friends', geek: 'Old maps' },
  he: { sunday: 'טיול בוקר, ואחר כך לבשל לחברים', geek: 'מפות ישנות' },
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
    const a = ANSWERS[locale as 'en' | 'he'];
    const noa = await onboardMember(`interview75-${locale}`, 'Noa', 'woman', ['man']);
    const N = await open(browser, locale, noa);
    try {
      await N.page.goto(`${WEB}/profile`);
      await N.page.getByRole('button', { name: t.interview.open, exact: true }).click();
      await N.page.waitForURL((url) => url.pathname === '/interview');
      const next = (label: string) => N.page.getByRole('button', { name: label, exact: true });
      // 1. My perfect Sunday; 2. I geek out about; 3-4 skipped.
      await N.page.getByLabel(t.prompt.perfect_sunday).fill(a.sunday);
      await audit(N.page, `${locale}/interview-question`);
      await next(t.interview.next).click();
      await N.page.getByLabel(t.prompt.geek_out_about).fill(a.geek);
      await next(t.interview.next).click();
      await next(t.interview.skip).click();
      await next(t.interview.skip).click();

      // The review: answers as written, suggestions to tick.
      await N.page.getByTestId('interview-suggestions').waitFor();
      check(true, 'suggestions from the answers (a local model)');
      // Keep only the Sunday answer as a prompt; tick hiking, not cooking or "doesn't smoke".
      await N.page.getByRole('checkbox', { name: t.prompt.geek_out_about }).click();
      await N.page.getByRole('checkbox', { name: t.interest.cooking }).click();
      await N.page.getByRole('checkbox', { name: t.about.smokingShort.no }).click();
      await audit(N.page, `${locale}/interview-review`);
      await shot(N.page, `${locale}/194-interview-review`);
      await next(t.interview.save).click();
      await N.page.waitForURL((url) => url.pathname === '/profile');
      const me = await noa.call<{
        prompts: { promptKey: string; answer: string }[];
        about: { interests: string[]; smoking: string | null } | null;
      }>('GET', '/v1/me');
      check(
        me.prompts.some((p) => p.promptKey === 'perfect_sunday' && p.answer === a.sunday) &&
          !me.prompts.some((p) => p.promptKey === 'geek_out_about'),
        'the kept answer is a prompt answer, word for word; the other isn’t',
      );
      check(
        (me.about?.interests ?? []).includes('hiking') &&
          !(me.about?.interests ?? []).includes('cooking') &&
          (me.about?.smoking ?? null) === null,
        'only the ticked suggestion was added',
      );
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
process.stdout.write('\nInterview: OK\n');
