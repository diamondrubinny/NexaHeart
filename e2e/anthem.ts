// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76g end to end: Noa writes her song (Profile → "My song"); Dan opens her profile and likes
 * the song with a comment; Noa's likes say "Liked your song".
 * Usage: pnpm --dir e2e anthem
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
const DATA: Record<
  'en' | 'he',
  { her: string; him: string; title: string; artist: string; note: string }
> = {
  en: {
    her: 'Noa',
    him: 'Dan',
    title: 'Here Comes the Sun',
    artist: 'The Beatles',
    note: 'Morning song!',
  },
  he: { her: 'נועה', him: 'דן', title: 'ירושלים של זהב', artist: 'שולי נתן', note: 'שיר מקסים!' },
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
    const noa = await onboardMember(`anthem76-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`anthem76-${locale}`, d.him, 'man', ['woman']);

    // 1. Noa writes her song.
    const N = await open(browser, locale, noa);
    try {
      await N.page.goto(`${WEB}/anthem`);
      await N.page.getByLabel(t.anthem.songTitle).fill(d.title);
      await N.page.getByLabel(t.anthem.artist).fill(d.artist);
      await audit(N.page, `${locale}/anthem-editor`);
      await N.page.getByRole('button', { name: t.common.save, exact: true }).click();
      await N.page.waitForURL((url) => url.pathname !== '/anthem');
      const saved = await noa.call<{ anthem: { title: string } | null }>('GET', '/v1/me/anthem');
      check(saved.anthem?.title === d.title, 'the song is on her profile');
    } finally {
      await N.context.close();
    }

    // 2. Dan likes the song, with a comment.
    const D = await open(browser, locale, dan);
    try {
      await D.page.goto(`${WEB}/profile/${noa.id}`);
      const song = D.page.getByTestId('profile-anthem');
      await song.waitFor();
      check((await song.innerText()).includes(d.artist), 'Dan sees the song');
      await song.scrollIntoViewIfNeeded();
      await audit(D.page, `${locale}/anthem-profile`);
      await shot(D.page, `${locale}/202-anthem`);
      await song
        .getByRole('button', { name: t.discover.likeItemLabel.replace('{{item}}', t.anthem.label) })
        .click();
      await D.page.getByLabel(t.discover.commentOptional).fill(d.note);
      await D.page.getByRole('button', { name: t.discover.send, exact: true }).click();
      await D.page.waitForTimeout(800);
    } finally {
      await D.context.close();
    }

    // 3. Noa's likes say it was the song.
    const N2 = await open(browser, locale, noa);
    try {
      await N2.page.goto(`${WEB}/likes`);
      await N2.page.getByText(t.anthem.liked, { exact: false }).first().waitFor();
      check(true, 'her likes say "liked your song"');
      await audit(N2.page, `${locale}/anthem-likes`);
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
process.stdout.write('\nMy song: OK\n');
