// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76f end to end: the community lets members propose groups; Noa proposes one in the app; an
 * admin approves it in the dashboard; Dan joins; Noa and Dan each tick the other as a secret crush
 * (Noa first: nothing shows), and the second tick says "It's mutual" and opens a match.
 * Usage: pnpm --dir e2e group-crush
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
const DATA: Record<
  'en' | 'he',
  { group: string; about: string; post: string; her: string; him: string }
> = {
  en: {
    group: 'Hikers',
    about: 'Weekend trails around the city.',
    post: 'Anyone up for the Carmel trail on Friday?',
    her: 'Noa',
    him: 'Dan',
  },
  he: {
    group: 'מטיילים',
    about: 'מסלולים בסופי שבוע סביב העיר.',
    post: 'מי בא לשביל הכרמל ביום שישי?',
    her: 'נועה',
    him: 'דן',
  },
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
  const email = `crush76-admin-${Date.now()}@example.test`;
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
    const a = adminMessages[locale as 'en' | 'he'].groups;
    await pool.query('DELETE FROM rate_limit');
    await resetRouteLimits();
    await pool.query('DELETE FROM interest_groups');
    await admin.call('PATCH', '/v1/admin/instance', { memberGroups: true });
    const noa = await onboardMember(`crush76-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`crush76-${locale}`, d.him, 'man', ['woman']);

    // 1. Noa proposes a group.
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/groups`);
      await N.page.getByRole('button', { name: t.groups.propose, exact: true }).click();
      await N.page.getByLabel(t.groups.proposeNameLabel).fill(d.group);
      await N.page.getByLabel(t.groups.about).fill(d.about);
      await audit(N.page, `${locale}/group-propose`);
      await N.page.getByRole('button', { name: t.groups.proposeSend, exact: true }).click();
      await N.page.getByText(t.groups.pendingNote).waitFor();
      check(true, 'the proposal waits for approval');
    } finally {
      await N.context.close();
    }

    // 2. An admin approves it in the dashboard.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/groups`);
      const row = S.page.getByRole('row', { name: new RegExp(d.group) });
      await row.getByText(a.pending).waitFor();
      await audit(S.page, `${locale}/admin-group-proposal`);
      await shot(S.page, `${locale}/admin-22-group-proposal`);
      await row.getByRole('button', { name: new RegExp(`^${a.approve}`) }).click();
      await row.getByText(a.openStatus).waitFor();
      check(true, 'the admin approved it');
    } finally {
      await S.context.close();
    }
    const { groups } = await admin.call<{ groups: { id: string }[] }>('GET', '/v1/admin/groups');
    const groupId = groups[0]!.id;
    await dan.call('POST', `/v1/groups/${groupId}/join`);

    // 3. Noa ticks Dan: nothing shows. Then Dan ticks Noa: it's mutual.
    const N2 = await open(browser, locale, noa.session);
    try {
      await N2.page.goto(`${WEB}/groups/${groupId}`);
      await N2.page.getByRole('checkbox', { name: new RegExp(d.him) }).click();
      await N2.page.waitForTimeout(600);
      check(
        (await N2.page.getByTestId('crush-mutual').count()) === 0,
        'a one-sided crush shows nothing',
      );
      await audit(N2.page, `${locale}/group-crush`);
    } finally {
      await N2.context.close();
    }
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/groups/${groupId}`);
      await D.page.getByRole('checkbox', { name: new RegExp(d.her) }).click();
      await D.page.getByTestId('crush-mutual').waitFor();
      check(true, '“It’s mutual” for the second one');
      await audit(D.page, `${locale}/group-crush-mutual`);
      await D.page.getByTestId('crush-mutual').scrollIntoViewIfNeeded();
      await shot(D.page, `${locale}/201-crush-mutual`);
      const matches = await noa.call<{ matches: { id: string }[] }>('GET', '/v1/matches');
      check(matches.matches.length === 1, 'and Noa has the match too');
    } finally {
      await D.context.close();
    }
  }
} finally {
  await admin.call('PATCH', '/v1/admin/instance', { memberGroups: false });
  await browser.close();
  await pool.end();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nSecret Crush: OK\n');
