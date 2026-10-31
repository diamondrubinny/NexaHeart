// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CREDIT_AUTHOR_URL, CREDIT_URL, creditText, UPSTREAM_SOURCE_URL } from '@nexaheart/shared';
import { api, ApiError, MFA_REQUIRED_EVENT } from './api';
import { useAsync, useRoute } from './hooks';
import { LocaleContext, messages, useLocale, type Locale } from './i18n';
import { ErrorBox, Loading } from './components/ui';
import { Audit } from './pages/Audit';
import { Branding } from './pages/Branding';
import { ClaimInstance } from './pages/Setup';
import { MfaSetup, MfaVerify } from './pages/Mfa';
import { ReportDetail } from './pages/ReportDetail';
import { Overview } from './pages/Overview';
import { System } from './pages/System';
import { UpdateBanner } from './pages/Updates';
import { Reports } from './pages/Reports';
import { SignIn } from './pages/SignIn';
import { Events } from './pages/Events';
import { Integrations } from './pages/Integrations';
import { Partners } from './pages/Partners';
import { Venues } from './pages/Venues';
import { Groups } from './pages/Groups';
import { Videos } from './pages/Videos';
import { Signup } from './pages/Signup';
import { Verifications } from './pages/Verifications';
import { Appeals } from './pages/Appeals';
import { Compliance } from './pages/Compliance';
import { Matchmakers } from './pages/Matchmakers';
import { Reviews } from './pages/Reviews';

const LOCALE_KEY = 'nexaheart-admin-locale';

/**
 * "Powered by NexaHeart · Open source". Keeping it visible is an additional term of the license
 * (AGPL-3.0 section 7(b), see NOTICE); "Open source" links to this instance's source (section 13).
 * Then who created NexaHeart (phase 29).
 */
function PoweredBy({ locale }: { locale: Locale }) {
  const instance = useAsync(() => api.instance(), []);
  const text = creditText(locale);
  const sourceUrl = instance.data?.poweredBy.sourceUrl ?? UPSTREAM_SOURCE_URL;
  return (
    <footer className="powered-by">
      <a href={CREDIT_URL} target="_blank" rel="noopener noreferrer">
        {text.poweredBy}
      </a>
      <span aria-hidden="true"> · </span>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
        {text.openSource}
      </a>
      <span aria-hidden="true"> · </span>
      <a href={CREDIT_AUTHOR_URL} target="_blank" rel="noopener noreferrer">
        {text.createdBy}
      </a>
    </footer>
  );
}

function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return navigator.language.startsWith('he') ? 'he' : 'en';
}

function Shell({
  children,
  signedIn,
  isAdmin,
  onSignOut,
}: {
  children: ReactNode;
  signedIn: boolean;
  isAdmin: boolean;
  onSignOut: () => void;
}) {
  const { t, toggle, locale } = useLocale();
  const route = useRoute();
  const current = route[0] ?? 'reports';
  const link = (
    key:
      | 'reports'
      | 'overview'
      | 'verifications'
      | 'appeals'
      | 'venues'
      | 'groups'
      | 'videos'
      | 'events'
      | 'signup'
      | 'audit'
      | 'branding'
      | 'integrations'
      | 'partners'
      | 'compliance'
      | 'matchmakers'
      | 'reviews'
      | 'system',
  ) => (
    <li>
      <a href={`#/${key}`} aria-current={current === key ? 'page' : undefined}>
        {key === 'system'
          ? t.system.nav
          : key === 'reviews'
            ? t.reviews.nav
            : key === 'matchmakers'
              ? t.matchmakers.nav
              : key === 'compliance'
                ? t.compliance.nav
                : key === 'partners'
                  ? t.partners.nav
                  : key === 'integrations'
                    ? t.integrations.nav
                    : key === 'branding'
                      ? t.branding.nav
                      : key === 'groups'
                        ? t.groups.nav
                        : key === 'videos'
                          ? t.videos.nav
                          : key === 'venues'
                            ? t.venues.nav
                            : key === 'events'
                              ? t.events.nav
                              : key === 'signup'
                                ? t.signup.nav
                                : t.nav[key]}
      </a>
    </li>
  );
  // Phase 79: the menu grouped into sections, as a side bar on wide screens; on narrow screens
  // it opens from a Menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  menuWasOpen.current = menuOpen;
  useEffect(() => {
    // A page picked from the open menu: the menu closes, and focus moves to the page (it would
    // otherwise fall to the top of the document with the hidden link).
    if (!menuWasOpen.current) return;
    setMenuOpen(false);
    document.getElementById('main')?.focus();
  }, [current]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  type Key = Parameters<typeof link>[0];
  const sections: { key: 'moderation' | 'community' | 'settings'; links: Key[] }[] = [
    {
      key: 'moderation',
      links: ['reports', 'verifications', 'reviews', 'videos', 'appeals', 'audit'],
    },
    { key: 'community', links: ['overview', 'groups', 'events', 'venues', 'signup', 'partners'] },
    ...(isAdmin
      ? [
          {
            key: 'settings' as const,
            links: ['branding', 'integrations', 'matchmakers', 'compliance', 'system'] as Key[],
          },
        ]
      : []),
  ];
  return (
    <div className={signedIn ? 'layout' : 'layout layout-public'}>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">
            ♥
          </span>
          NexaHeart · {t.appName}
        </span>
        <div className="topbar-actions">
          {signedIn ? (
            <button
              type="button"
              ref={menuButton}
              className="button small menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="side-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {t.menu}
            </button>
          ) : null}
          <button
            type="button"
            className="button small"
            onClick={toggle}
            lang={locale === 'he' ? 'en' : 'he'}
          >
            {t.language}
          </button>
          {signedIn ? (
            <button type="button" className="button small" onClick={onSignOut}>
              {t.signOut}
            </button>
          ) : null}
        </div>
      </header>
      {signedIn ? (
        <nav
          id="side-menu"
          className={menuOpen ? 'side-menu open' : 'side-menu'}
          aria-label={t.appName}
        >
          {sections.map((section) => (
            <div key={section.key} className="menu-section">
              <p className="menu-heading" id={`menu-${section.key}`}>
                {t.menuSections[section.key]}
              </p>
              <ul aria-labelledby={`menu-${section.key}`}>
                {section.links.map((key) => (
                  <Fragment key={key}>{link(key)}</Fragment>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      ) : null}
      <main id="main" tabIndex={-1}>
        {signedIn && isAdmin ? <UpdateBanner /> : null}
        {children}
      </main>
      <PoweredBy locale={locale} />
    </div>
  );
}

function Routes({ staff }: { staff: NonNullable<Awaited<ReturnType<typeof api.me>>> }) {
  const route = useRoute();
  if (route[0] === 'reports' && route[1]) return <ReportDetail id={route[1]} staff={staff} />;
  if (route[0] === 'overview') return <Overview />;
  if (route[0] === 'verifications') return <Verifications />;
  if (route[0] === 'reviews') return <Reviews isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'appeals') return <Appeals />;
  if (route[0] === 'venues') return <Venues isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'groups') return <Groups isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'videos') return <Videos />;
  if (route[0] === 'events') return <Events isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'signup') return <Signup isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'partners') return <Partners isAdmin={staff.role === 'admin'} />;
  if (route[0] === 'audit') return <Audit />;
  if (route[0] === 'branding' && staff.role === 'admin') return <Branding wizard={false} />;
  if (route[0] === 'integrations' && staff.role === 'admin') return <Integrations />;
  if (route[0] === 'system' && staff.role === 'admin') return <System />;
  if (route[0] === 'compliance' && staff.role === 'admin') return <Compliance />;
  if (route[0] === 'matchmakers' && staff.role === 'admin') return <Matchmakers />;
  return <Reports />;
}

/** Admins finish the setup wizard (branding) before anything else. */
function AdminGate({ staff }: { staff: NonNullable<Awaited<ReturnType<typeof api.me>>> }) {
  const settings = useAsync(
    () => (staff.role === 'admin' ? api.settings() : Promise.resolve(null)),
    [staff.role],
  );
  const [finished, setFinished] = useState(false);
  if (settings.loading && settings.data === undefined) return <Loading />;
  if (settings.data && !settings.data.setupCompleted && !finished) {
    return <Branding wizard onFinish={() => setFinished(true)} />;
  }
  return <Routes staff={staff} />;
}

/** Signed in but not staff: offer the first-run claim while the instance has no admin. */
function NotStaff({ onClaimed }: { onClaimed: () => void }) {
  const instance = useAsync(() => api.instance(), []);
  if (instance.loading && !instance.data) return <Loading />;
  if (instance.data?.setupRequired) return <ClaimInstance onClaimed={onClaimed} />;
  return <NoAccess />;
}

export function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo(
    () => ({
      locale,
      t: messages[locale],
      toggle: () => setLocale((l) => (l === 'he' ? 'en' : 'he')),
    }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
    document.title = `NexaHeart · ${messages[locale].appName}`;
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // ignore: preference is only a convenience
    }
  }, [locale]);

  const me = useAsync(() => api.me(), []);

  // Any MFA_REQUIRED from a later call (the 12-hour step-up expired) re-checks the state.
  const reloadMe = useRef(me.reload);
  reloadMe.current = me.reload;
  useEffect(() => {
    const onExpired = () => reloadMe.current();
    window.addEventListener(MFA_REQUIRED_EVENT, onExpired);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, onExpired);
  }, []);

  async function signOut() {
    await api.signOut().catch(() => undefined);
    window.location.hash = '';
    me.reload();
  }

  let content: ReactNode;
  const err = me.error;
  if (me.loading && !me.data && !err) content = <Loading />;
  else if (err instanceof ApiError && err.status === 401) content = <SignIn />;
  else if (err instanceof ApiError && err.status === 403)
    content = <NotStaff onClaimed={me.reload} />;
  else if (err) content = <ErrorBox error={err} onRetry={me.reload} />;
  else if (me.data && !me.data.mfaEnabled) content = <MfaSetup onVerified={me.reload} />;
  else if (me.data && !me.data.mfaVerified) content = <MfaVerify onVerified={me.reload} />;
  else if (me.data) content = <AdminGate staff={me.data} />;

  const signedIn = Boolean(me.data?.mfaVerified);
  return (
    <LocaleContext.Provider value={value}>
      <Shell signedIn={signedIn} isAdmin={me.data?.role === 'admin'} onSignOut={signOut}>
        {content}
        {err instanceof ApiError && err.status === 403 ? (
          <button type="button" className="button" onClick={signOut}>
            {value.t.signOut}
          </button>
        ) : null}
      </Shell>
    </LocaleContext.Provider>
  );
}

function NoAccess() {
  const { t } = useLocale();
  return (
    <section className="card narrow" aria-labelledby="noaccess-title">
      <h1 id="noaccess-title">{t.noAccess.title}</h1>
      <p>{t.noAccess.body}</p>
    </section>
  );
}
