import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { liveAnnouncementsResponseSchema, type LiveAnnouncement } from '@crm/contracts';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { PublicCustomCode } from '@/features/platform-settings-branding-storage/site/site-head';
import { getSession, homePathFor, requestPath } from '@/lib/auth/server';
import { cmsPublic } from '../public/api';
import { makeFc, themeVars, type Fc, type SiteContent } from './content';
import { PreviewBridge } from './preview-bridge';
import { T, type SiteCtx } from './site-ui';
import './site.css';

/** The marquee: announcements scrolling, or the five editable fallback lines when none is live (TW-CMS-017). */
function Ticker({ items, fc, ctx }: { items: LiveAnnouncement[]; fc: Fc; ctx: SiteCtx }) {
  const lines: Array<{ key: string; node: ReactNode; tone?: string }> =
    items.length > 0
      ? items.map((a) => ({
          key: a.id,
          tone: a.tone,
          node: (
            <>
              {a.text}
              {a.linkUrl && (
                <>
                  {' · '}
                  <a href={a.linkUrl} rel="noopener noreferrer">
                    {a.linkLabel ? `${a.linkLabel} →` : '→'}
                  </a>
                </>
              )}
            </>
          ),
        }))
      : [1, 2, 3, 4, 5]
          .filter((i) => ctx.edit || fc(`ticker.message${i}`) !== '')
          .map((i) => ({
            key: `m${i}`,
            node: <T ctx={ctx} k={`ticker.message${i}`} />,
          }));
  if (lines.length === 0) return null;
  const chars = lines.reduce((n, l) => n + (typeof l.node === 'string' ? l.node.length : 40), 0);
  const seconds = Math.max(20, Math.round((items.length ? chars : lines.length * 40) / 5));
  const row = (copy: number) =>
    lines.map((l, i) => (
      <span key={`${l.key}-${copy}`} data-tone={l.tone} aria-hidden={copy > 0 ? true : undefined}>
        {i === 0 && copy === 0 && <span className="cms-dot" aria-hidden />}
        {l.node}
      </span>
    ));
  return (
    <div className="cms-ticker" role="region" aria-label="Announcements">
      <div className="cms-marquee">
        <div className="cms-marquee-track" style={{ ['--cms-marquee-s' as string]: `${seconds}s` }}>
          {row(0)}
          {row(1)}
        </div>
      </div>
    </div>
  );
}

/**
 * The public site frame (TW-CMS-007): ticker, sticky navigation, the page, the footer, the editable theme and the platform's
 * custom code. Everything editable here (navigation, ticker lines, footer columns, colours) comes from the content store;
 * company-wide texts (footer title, copyright, social links, legal addresses) come from the platform settings.
 */
export async function SiteFrame({
  content,
  current,
  edit = false,
  children,
}: {
  content: SiteContent;
  /** The path whose navigation link is marked as the current page. */
  current?: string;
  edit?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations('marketing-site-cms.site');
  const tc = await getTranslations('platform-settings-branding-storage.cookie');
  const site = await getSiteConfig();
  const fc = makeFc(content.values);
  const ctx: SiteCtx = { fc, edit, page: 'home', extras: {} };
  // the footer's legal links keep the platform's own addresses when the operator set them
  const legal = site?.legal ?? null;
  const [announcements, session, asked] = await Promise.all([
    cmsPublic('/announcements', liveAnnouncementsResponseSchema),
    edit ? Promise.resolve({ session: null }) : getSession(),
    requestPath(),
  ]);
  const here = current ?? asked?.split('?')[0] ?? undefined;
  const brand = site?.brand.name || content.brandName;
  const authed = !!session.session;
  const dashboard = session.session ? homePathFor(session.session) : '/login';
  const vars = themeVars(content.values) as CSSProperties;

  const navLinks = [1, 2, 3, 4, 5, 6];
  const legalFor: Record<string, string | undefined> = {
    '/legal/terms': legal?.terms,
    '/legal/privacy': legal?.privacy,
    '/legal/cookies': legal?.cookies,
  };
  const year = new Date().getFullYear();

  return (
    <div className={`cms-site${edit ? ' cms-edit' : ''}`} style={vars}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        {t('skip')}
      </a>
      <Ticker items={announcements?.data ?? []} fc={fc} ctx={ctx} />
      <nav className="cms-nav" aria-label={t('navLabel')}>
        <div className="cms-wrap cms-nav-inner">
          <Link href="/" className="cms-brand" style={{ textDecoration: 'none' }}>
            {brand}
          </Link>
          {navLinks.map((i) => {
            const href = fc(`nav.link${i}_url`);
            if (!edit && fc(`nav.link${i}_label`) === '') return null;
            return (
              <Link
                key={i}
                href={href || '#'}
                aria-current={here !== undefined && href === here ? 'page' : undefined}
                {...(edit ? { 'data-fc-url': `nav.link${i}_url` } : {})}
              >
                <T ctx={ctx} k={`nav.link${i}_label`} />
              </Link>
            );
          })}
          {authed ? (
            <Link href={dashboard} className="cms-btn" style={{ minHeight: '2.25rem' }}>
              <T ctx={ctx} k="nav.dashboard_label" />
            </Link>
          ) : (
            <>
              <Link href="/login">
                <T ctx={ctx} k="nav.signin_label" />
              </Link>
              <Link href="/register" className="cms-btn" style={{ minHeight: '2.25rem' }}>
                <T ctx={ctx} k="nav.cta_label" />
              </Link>
            </>
          )}
        </div>
      </nav>
      <main id="main" className="cms-main">
        {children}
      </main>
      <footer className="cms-footer">
        <div className="cms-wrap">
          <div className="cms-footer-cols">
            <div>
              <h4>{site?.footer.title || brand}</h4>
              <T ctx={ctx} k="footer.tagline" as="p" className="cms-small" />
              {site?.footer.description && !edit && fc('footer.tagline') === '' && (
                <p className="cms-small">{site.footer.description}</p>
              )}
            </div>
            {[1, 2, 3].map((c) => (
              <div key={c}>
                <h4>
                  <T ctx={ctx} k={`footer.col${c}_title`} />
                </h4>
                <ul>
                  {[1, 2, 3].map((l) => {
                    const url = fc(`footer.col${c}_link${l}_url`);
                    if (!edit && fc(`footer.col${c}_link${l}_label`) === '') return null;
                    return (
                      <li key={l}>
                        <Link
                          href={(!edit && legalFor[url]) || url || '#'}
                          {...(edit ? { 'data-fc-url': `footer.col${c}_link${l}_url` } : {})}
                        >
                          <T ctx={ctx} k={`footer.col${c}_link${l}_label`} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {site && Object.keys(site.footer.social).length > 0 && (
              <div>
                <h4>{t('social')}</h4>
                <ul>
                  {Object.entries(site.footer.social).map(([name, href]) => (
                    <li key={name}>
                      <a href={href} rel="noopener noreferrer">
                        {name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="cms-footer-bar">
            <span>
              {edit ? (
                <T ctx={ctx} k="footer.copyright" />
              ) : (
                fc('footer.copyright') ||
                site?.footer.copyright ||
                `© ${year} ${brand}. ${t('rights')}`
              )}
            </span>
            <a href="#cookie-preferences" data-cookie-prefs-open>
              {tc('preferences')}
            </a>
          </div>
        </div>
      </footer>
      {site && !edit && <PublicCustomCode cfg={site} />}
      {edit && <PreviewBridge />}
    </div>
  );
}
