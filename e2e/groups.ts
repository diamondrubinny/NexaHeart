// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 76e end to end: an admin opens a group in the dashboard; Noa joins in the app and posts;
 * Dan sees the post on the board and reports it (the post is copied as evidence).
 * Usage: pnpm --dir e2e groups
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
  const email = `groups76-admin-${Date.now()}@example.test`;
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
    // Earlier runs' groups, so the lists show only this run's.
    await pool.query('DELETE FROM interest_groups');

    // 1. The dashboard: open a group.
    const S = await open(browser, locale, admin.session, 1280);
    try {
      await S.page.goto(`${ADMIN}/#/groups`);
      await S.page.getByLabel(a.name, { exact: true }).fill(d.group);
      await S.page.getByLabel(a.emoji, { exact: true }).fill('🥾');
      await S.page.getByLabel(a.about, { exact: true }).fill(d.about);
      await S.page.getByRole('button', { name: a.add, exact: true }).click();
      await S.page.getByRole('row', { name: new RegExp(d.group) }).waitFor();
      const notice = await S.page.getByRole('status').first().innerText();
      check(notice.includes(d.group) && !notice.includes('{'), 'the notice names the group');
      await audit(S.page, `${locale}/admin-groups`);
      await shot(S.page, `${locale}/admin-21-groups`);
    } finally {
      await S.context.close();
    }
    const { groups } = await admin.call<{ groups: { id: string }[] }>('GET', '/v1/admin/groups');
    const groupId = groups[0]!.id;

    const noa = await onboardMember(`groups76-${locale}`, d.her, 'woman', ['man']);
    const dan = await onboardMember(`groups76-${locale}`, d.him, 'man', ['woman']);
    await dan.call('POST', `/v1/groups/${groupId}/join`);

    // 2. Noa joins in the app and posts.
    const N = await open(browser, locale, noa.session);
    try {
      await N.page.goto(`${WEB}/groups`);
      await N.page.getByRole('link', { name: new RegExp(d.group) }).waitFor();
      await audit(N.page, `${locale}/groups-list`);
      await N.page.getByRole('link', { name: new RegExp(d.group) }).click();
      await N.page.waitForURL((url) => url.pathname.startsWith('/groups/'));
      await N.page.getByRole('button', { name: t.groups.join, exact: true }).waitFor();
      await audit(N.page, `${locale}/group-about`);
      await N.page.getByRole('button', { name: t.groups.join, exact: true }).click();
      await N.page.getByLabel(t.groups.write).fill(d.post);
      await N.page.getByRole('button', { name: t.groups.post, exact: true }).click();
      await N.page.getByTestId('group-post').filter({ hasText: d.post }).waitFor();
      check(true, 'Noa joined and posted');
    } finally {
      await N.context.close();
    }

    // 3. Dan sees it and reports it.
    const D = await open(browser, locale, dan.session);
    try {
      await D.page.goto(`${WEB}/groups/${groupId}`);
      const post = D.page.getByTestId('group-post').filter({ hasText: d.post });
      await post.waitFor();
      check(
        (await D.page.getByText(d.her, { exact: true }).count()) > 0,
        'Dan sees Noa in the group',
      );
      await audit(D.page, `${locale}/group-board`);
      await shot(D.page, `${locale}/200-group-board`);
      await post.getByRole('button', { name: t.groups.reportPost }).click();
      await D.page.getByText(t.groups.postAttached).waitFor();
      await D.page.getByRole('radio', { name: t.report.categories.harassment }).click();
      await D.page.getByRole('button', { name: t.report.submit, exact: true }).click();
      await D.page.getByText(t.report.done).waitFor();
      const { rows } = await pool.query(
        `SELECT e.body FROM report_evidence e JOIN reports r ON r.id = e.report_id
         WHERE r.reported_id = $1`,
        [noa.id],
      );
      check(
        rows.some((r) => String(r.body).includes(d.post)),
        'the post is evidence in the report',
      );
    } finally {
      await D.context.close();
    }

    // 4. The dashboard: read the group's posts and remove Noa's.
    const S2 = await open(browser, locale, admin.session, 1280);
    try {
      await S2.page.goto(`${ADMIN}/#/groups`);
      const row = S2.page.getByRole('row', { name: new RegExp(d.group) });
      await row.getByRole('button', { name: new RegExp(`^${a.posts}`) }).click();
      await S2.page.getByText(d.post).waitFor();
      await S2.page.getByRole('button', { name: new RegExp(`^${a.remove}`) }).click();
      await S2.page.getByText(a.removed).waitFor();
      check((await S2.page.getByText(d.post).count()) === 0, 'the admin removed the post');
      const { rows } = await pool.query('SELECT removed_at FROM group_posts WHERE body = $1', [
        d.post,
      ]);
      check(rows.length === 1 && rows[0].removed_at !== null, 'kept, marked removed');
    } finally {
      await S2.context.close();
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
process.stdout.write('\nInterest groups: OK\n');
