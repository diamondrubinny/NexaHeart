// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
/**
 * Phase 79: the main screens in the new visual design, light and dark, en and he. Checks:
 * - axe 0 on every screen;
 * - Rubik is the font in use, and it's served by this server (no request to any other origin);
 * - the current tab is marked by more than color (a filled icon and a bolder label).
 * Usage: pnpm --dir e2e design
 */
import { existsSync } from 'node:fs';
import { createDb } from '@nexaheart/db';
import { chromium, type Browser, type Page } from 'playwright';
import { messages as adminMessages } from '../apps/admin/src/i18n.ts';
import { totp } from '../apps/api/src/lib/totp.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';
import { he } from '../apps/mobile/src/i18n/he.ts';
import {
  API,
  audit,
  LOCALE_TAGS,
  locales,
  onboardMember,
  reportA11y,
  resetRouteLimits,
  resetSignInLimits,
  shot,
  signInHttp,
  apiClient,
  WEB,
} from './lib.ts';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5174';

const T = { en, he } as const;
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const allowed = new Set([new URL(WEB).origin, new URL(API).origin, new URL(ADMIN).origin]);

async function open(
  browser: Browser,
  locale: 'en' | 'he',
  scheme: 'light' | 'dark',
  session?: { name: string; value: string },
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: LOCALE_TAGS[locale],
    colorScheme: scheme,
  });
  if (session) {
    await context.addCookies([
      { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
  }
  await context.addInitScript((l) => localStorage.setItem('nexaheart.locale', l), locale);
  const page = await context.newPage();
  const foreign: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol.startsWith('http') && !allowed.has(url.origin)) foreign.push(url.origin);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page, foreign };
}

async function fontOf(page: Page, text: string) {
  return page
    .getByText(text, { exact: true })
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
}

async function rubikLoaded(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes('Rubik') && f.status === 'loaded');
  });
}

await resetSignInLimits();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const locale of locales(['en', 'he'] as const)) {
    const t = T[locale];
    await resetRouteLimits();
    const noa = await onboardMember(
      `design79-${locale}`,
      locale === 'he' ? 'נועה' : 'Noa',
      'woman',
      ['man'],
    );
    await onboardMember(`design79-${locale}`, locale === 'he' ? 'דן' : 'Dan', 'man', ['woman']);
    for (const scheme of ['light', 'dark'] as const) {
      process.stdout.write(`${locale} ${scheme}:\n`);
      const suffix = scheme === 'dark' ? '-dark' : '';

      // Welcome, signed out.
      const W = await open(browser, locale, scheme);
      try {
        await W.page.goto(`${WEB}/welcome`);
        await W.page.getByRole('button', { name: t.welcome.start, exact: true }).waitFor();
        check(await rubikLoaded(W.page), 'Rubik is loaded');
        check((await fontOf(W.page, t.welcome.start)).includes('Rubik'), 'buttons use Rubik');
        await audit(W.page, `${locale}/design-welcome${suffix}`);
        await shot(W.page, `${locale}/210-design-welcome${suffix}`);
        check(W.foreign.length === 0, `no request to other origins (${W.foreign.join(', ')})`);
      } finally {
        await W.context.close();
      }

      // Signed in: the tabs.
      const N = await open(browser, locale, scheme, noa.session);
      try {
        for (const [tab, path] of [
          ['discover', '/discover'],
          ['matches', '/matches'],
          ['profile', '/profile'],
        ] as const) {
          await N.page.goto(`${WEB}${path}`);
          const current = N.page.getByRole('tab', { name: t.tabs[tab], exact: true });
          await current.waitFor();
          await N.page.waitForTimeout(600);
          const other = N.page.getByRole('tab', { name: t.tabs.likes, exact: true });
          // One family per weight: the current tab's label uses the bold file.
          const family = async (loc: typeof current) =>
            loc.evaluate((el) => {
              const label = [...el.querySelectorAll('div')].find(
                (d) => d.childElementCount === 0 && d.textContent?.trim(),
              );
              return label ? getComputedStyle(label).fontFamily : '';
            });
          check(
            (await family(current)).includes('Rubik_700Bold') &&
              (await family(other)).includes('Rubik_500Medium'),
            `${tab}: the current tab's label is bolder`,
          );
          // Every label fully visible inside the bar (not clipped by its height).
          const clipped = await N.page.getByRole('tablist').evaluate((bar) => {
            const box = bar.getBoundingClientRect();
            return [...bar.querySelectorAll('[role="tab"] div')]
              .filter((d) => d.childElementCount === 0 && d.textContent?.trim())
              .filter((d) => {
                const r = d.getBoundingClientRect();
                return r.bottom > box.bottom + 0.5 || r.height < 12;
              })
              .map((d) => d.textContent);
          });
          check(clipped.length === 0, `${tab}: no tab label is clipped (${clipped.join(', ')})`);
          await audit(N.page, `${locale}/design-${tab}${suffix}`);
          await shot(N.page, `${locale}/211-design-${tab}${suffix}`);
        }
        check(N.foreign.length === 0, `no request to other origins (${N.foreign.join(', ')})`);
      } finally {
        await N.context.close();
      }
    }
  }

  // The dashboard on a phone: the menu opens from a button; picking a page closes it and moves
  // focus to the page; Escape closes it and returns focus to the button.
  const { pool } = createDb(process.env.DATABASE_URL ?? '', { max: 1 });
  const email = `design79-admin-${Date.now()}@example.test`;
  const session = await signInHttp(email);
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [email]);
  await pool.end();
  const call = apiClient(session.header);
  const { secret } = await call<{ secret: string }>('POST', '/v1/admin/mfa/setup');
  await call('POST', '/v1/admin/mfa/verify', { code: totp(secret, Date.now()) });
  for (const locale of locales(['en', 'he'] as const)) {
    process.stdout.write(`${locale} dashboard:\n`);
    const a = adminMessages[locale];
    for (const width of [390, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        deviceScaleFactor: 2,
        locale: LOCALE_TAGS[locale],
      });
      await context.addCookies([
        { ...session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
      ]);
      await context.addInitScript((l) => localStorage.setItem('nexaheart-admin-locale', l), locale);
      const page = await context.newPage();
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      try {
        await page.goto(`${ADMIN}/#/reports`);
        const menu = page.getByRole('button', { name: a.menu, exact: true });
        const groupsLink = page.getByRole('link', { name: a.groups.nav, exact: true });
        if (width < 1000) {
          await menu.waitFor();
          await page.getByRole('heading', { level: 1 }).waitFor();
          await page.waitForLoadState('networkidle');
          check(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            `${width}px: no horizontal page scroll (WCAG 1.4.10)`,
          );
          check(!(await groupsLink.isVisible()), `${width}px: the menu starts closed`);
          await menu.click();
          check((await menu.getAttribute('aria-expanded')) === 'true', 'aria-expanded');
          await audit(page, `${locale}/design-admin-menu`);
          await shot(page, `${locale}/212-design-admin-menu`);
          await page.keyboard.press('Escape');
          check(
            (await menu.getAttribute('aria-expanded')) === 'false' &&
              (await menu.evaluate((el) => el === document.activeElement)),
            'Escape closes the menu and returns focus to its button',
          );
          await menu.click();
          await groupsLink.click();
          await page.waitForURL(/#\/groups/);
          check(
            await groupsLink
              .waitFor({ state: 'hidden', timeout: 3000 })
              .then(() => true)
              .catch(() => false),
            'picking a page closes the menu',
          );
          check(
            await page.evaluate(() => document.activeElement?.id === 'main'),
            'focus moves to the page',
          );
        } else {
          await groupsLink.waitFor();
          check(!(await menu.isVisible()), `${width}px: the menu is a side bar, no Menu button`);
          await audit(page, `${locale}/design-admin`);
          await shot(page, `${locale}/213-design-admin`);
        }
      } finally {
        await context.close();
      }
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
process.stdout.write('\nDesign: OK\n');
