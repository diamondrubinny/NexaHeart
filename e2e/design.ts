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
import { chromium, type Browser, type Page } from 'playwright';
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
  WEB,
} from './lib.ts';

const T = { en, he } as const;
const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${message}\n`);
};
const allowed = new Set([new URL(WEB).origin, new URL(API).origin]);

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
          const weight = async (loc: typeof current) =>
            loc.evaluate((el) => {
              const label = [...el.querySelectorAll('div')].find(
                (d) => d.childElementCount === 0 && d.textContent?.trim(),
              );
              return label ? getComputedStyle(label).fontWeight : '';
            });
          check(
            Number(await weight(current)) > Number(await weight(other)),
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
} finally {
  await browser.close();
}
reportA11y();
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('\nDesign: OK\n');
