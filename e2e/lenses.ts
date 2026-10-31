// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76b end to end: Discover → "Show: Shared interests" narrows the deck; a lens with no one in
 * it says so; an admin turns a lens off in the dashboard and it's gone from Discover.
 * Usage: pnpm --dir e2e lenses
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
  API,
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
const ALL = ['shared_interests', 'nearby', 'new_here', 'same_goal', 'shows_up'];

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
  const email = `lens76-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  return { session, call };
}

const about = (interests: string[]) => ({
  interests,
  children: null,
  smoking: null,
  drinking: null,
  heightCm: null,
  religion: null,
  openingQuestion: null,
});

await resetSignInLimits();
const admin = await adminSession();
// Through the API, so the community info it caches changes too.
const setLenses = (lenses: string[]) =>
  admin.call('PATCH', '/v1/admin/instance', { discoveryLenses: lenses });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale}:\n`);
    const t = T[locale];
    const a = adminMessages[locale as 'en' | 'he'].branding;
    await pool.query('DELETE FROM rate_limit');
    await resetRouteLimits();
    await setLenses(ALL);
    const noa = await onboardMember(`lens76-${locale}`, 'Noa', 'woman', ['man']);
    const dan = await onboardMember(`lens76-${locale}`, 'Dan', 'man', ['woman']);
    const tom = await onboardMember(`lens76-${locale}`, 'Tom', 'man', ['woman']);
    // A spot of their own (earlier runs share this database): only these three are in range.
    const spot = { lat: 30.6 + Math.random() * 0.8, lng: 34.8 + Math.random() * 0.2 };
    for (const m of [noa, dan, tom]) {
      await m.call('PUT', '/v1/me/location', spot);
      await m.call('PUT', '/v1/me/preferences', {
        ageMin: 18,
        ageMax: 99,
        maxDistanceKm: 2,
        intentions: [],
      });
    }
    await noa.call('PUT', '/v1/me/about', about(['hiking', 'board_games']));
    await dan.call('PUT', '/v1/me/about', about(['board_games']));
    await tom.call('PUT', '/v1/me/about', about(['cinema']));

    // 1. The API: the lens narrows the deck.
    const lensed = await noa.call<{ profiles: { id: string; displayName: string }[] }>(
      'GET',
      '/v1/discover?limit=20&lens=shared_interests',
    );
    const ids = lensed.profiles.map((p) => p.id);
    check(ids.includes(dan.id) && !ids.includes(tom.id), 'shared interests: Dan, not Tom');

    // 2. Discover: pick the lens; the card is someone the lens fits.
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/discover`);
      const chip = N.page.getByRole('radio', { name: t.lens.shared_interests, exact: true });
      await chip.waitFor();
      await chip.click();
      const first = lensed.profiles[0]?.displayName ?? '';
      await N.page.getByRole('heading', { name: first }).first().waitFor();
      check(true, 'the card is the first one the lens fits');
      await audit(N.page, `${locale}/discover-lens`);
      await shot(N.page, `${locale}/196-discover-lens`);
      // "Shows up" has no one here yet: the empty text says to try another.
      await N.page.getByRole('radio', { name: t.lens.shows_up, exact: true }).click();
      const empty = await N.page.getByTestId('discover-empty').innerText();
      check(empty === t.lens.empty, 'an empty lens says to try another');
    } finally {
      await N.context.close();
    }

    // 3. The dashboard: turn "Shows up" off; it's gone from Discover.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/branding`);
      const box = S.page.getByLabel(a.lensNames.shows_up, { exact: true });
      await box.waitFor();
      await box.uncheck();
      await S.page.getByRole('button', { name: a.communitySave, exact: true }).click();
      await S.page.getByText(a.communitySaved).first().waitFor();
      const settings = await admin.call<{ discoveryLenses: string[] }>('GET', '/v1/admin/instance');
      check(
        !settings.discoveryLenses.includes('shows_up') && settings.discoveryLenses.length === 4,
        'the community offers four lenses',
      );
      await box.scrollIntoViewIfNeeded();
      await audit(S.page, `${locale}/admin-lenses`);
      await shot(S.page, `${locale}/admin-19-lenses`);
    } finally {
      await S.context.close();
    }
    const off = await fetch(`${API}/v1/discover?lens=shows_up`, {
      headers: { cookie: noa.session.header },
    });
    check(off.status === 400, 'a lens that is off is refused');
    await setLenses(ALL);
  }
} finally {
  await setLenses(ALL);
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nDiscovery lenses: OK\n');
