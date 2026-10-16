import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { liveAnnouncementsResponseSchema, type LiveAnnouncement } from '@crm/contracts';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { PublicCustomCode } from '@/features/platform-settings-branding-storage/site/site-head';
import { getSession, homePathFor, requestPath } from '@/lib/auth/server';
import { cmsPublic } from '../public/api';
import { makeFc, themeVars, type SiteContent } from './content';
import { MobileNav } from './mobile-nav';
import { PreviewBridge } from './preview-bridge';
import { RevealObserver } from './reveal';
import { T, type SiteCtx } from './site-ui';
import './site.css';
import './wd.css';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';

const SEP = <span className="text-paper-0/40">·</span>;

/** The dark marquee above the navigation: live announcements, or the five editable lines when none is live (TW-CMS-017). */
function Ticker({ items, ctx, label }: { items: LiveAnnouncement[]; ctx: SiteCtx; label: string }) {
  const { fc, edit } = ctx;
  const lines = [1, 2, 3, 4, 5].filter((i) => edit || fc(`ticker.message${i}`) !== '');
  if (items.length === 0 && lines.length === 0) return null;
  const copy = [0, 1].map((n) => (
    <div
      key={n}
      className="flex shrink-0 items-center gap-8 px-4"
      aria-hidden={n > 0 ? true : undefined}
    >
      {items.length > 0
        ? items.map((a, i) => (
            <span key={a.id} className="contents">
              {i > 0 && SEP}
              <span
                className={`flex items-center gap-2 ${a.tone === 'success' ? 'text-wa-green' : ''}`}
              >
                {i === 0 && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-wa-green" />}
                {a.linkUrl ? (
                  <a href={a.linkUrl} rel="noopener noreferrer" className="hover:underline">
                    {a.text}
                    {a.linkLabel && <span className="opacity-70"> · {a.linkLabel} →</span>}
                  </a>
                ) : (
                  <span>{a.text}</span>
                )}
              </span>
            </span>
          ))
        : lines.map((i, idx) => (
            <span key={i} className="contents">
              {idx > 0 && SEP}
              <span className={`flex items-center gap-2 ${i === 4 ? 'text-wa-green' : ''}`}>
                {idx === 0 && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-wa-green" />}
                <T ctx={ctx} k={`ticker.message${i}`} />
              </span>
            </span>
          ))}
    </div>
  ));
  return (
    <div
      data-fc-section="ticker"
      className="mono overflow-hidden bg-ink-950 text-[11px] text-paper-0"
      role="region"
      aria-label={label}
    >
      <div className="marquee whitespace-nowrap py-2.5">{copy}</div>
    </div>
  );
}

const BrandMark = ({ dark }: { dark?: boolean }) => (
  <span
    className={
      dark
        ? 'inline-flex h-10 w-10 items-center justify-center rounded-xl bg-wa-green text-ink-900'
        : 'relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-wa-deep text-paper-0'
    }
  >
    <svg
      viewBox="0 0 24 24"
      className={dark ? 'h-5 w-5' : 'h-4 w-4'}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.96.57 3.79 1.55 5.34L2 22l4.78-1.5A9.93 9.93 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm5.07 14.07c-.21.6-1.22 1.14-1.7 1.21-.45.07-1.02.1-1.65-.1-.38-.12-.87-.28-1.49-.55-2.62-1.13-4.33-3.77-4.46-3.94-.13-.18-1.07-1.42-1.07-2.71 0-1.29.68-1.92.92-2.18.24-.27.52-.34.7-.34h.5c.16 0 .38-.06.59.45.21.51.71 1.76.77 1.89.06.13.1.28.02.45-.08.18-.12.28-.24.43-.12.15-.26.34-.37.46-.12.12-.25.26-.11.51.14.26.62 1.02 1.33 1.65.91.81 1.68 1.06 1.94 1.18.26.13.41.11.56-.06.15-.18.65-.76.83-1.02.18-.26.36-.21.6-.13.24.09 1.55.73 1.81.86.27.13.45.2.51.31.07.12.07.69-.14 1.29Z" />
    </svg>
    {!dark && (
      <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-wa-green ring-2 ring-white" />
    )}
  </span>
);

const Chevron = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-3 w-3"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden
  >
    <path d="M5 4l4 4-4 4" />
  </svg>
);

const SOCIAL_ICONS: Record<string, string> = {
  x: '<path d="M3 3l10 10M13 3 3 13"/>',
  linkedin:
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 7v4M5 5v.01M8 11V8.7a1.3 1.3 0 0 1 2.6 0V11"/>',
  instagram:
    '<rect x="2.5" y="2.5" width="11" height="11" rx="3"/><circle cx="8" cy="8" r="2.3"/><path d="M11.4 4.6v.01"/>',
  youtube: '<rect x="2" y="4" width="12" height="8" rx="2"/><path d="M7 6.4l3 1.6-3 1.6z"/>',
  facebook: '<path d="M10 3H8.7A2.2 2.2 0 0 0 6.5 5.2V7.5H5v2.4h1.5V14"/><path d="M6.5 8.7H10"/>',
  github:
    '<path d="M6 13v-1.6c0-.5-.2-.9-.5-1.1 1.6-.2 3-.8 3-3 0-.6-.2-1.1-.6-1.5.1-.4.1-1-.1-1.4 0 0-.5-.1-1.5.6a4.6 4.6 0 0 0-2.6 0c-1-.7-1.5-.6-1.5-.6-.2.4-.2 1-.1 1.4-.4.4-.6.9-.6 1.5 0 2.2 1.4 2.8 3 3-.2.2-.4.5-.4.9"/>',
};

const isCurrent = (href: string, here: string | undefined) =>
  here !== undefined &&
  (href === here || (href !== '/' && href !== '#' && here.startsWith(`${href}/`)));

/** Footer columns: how many links each shows and the grid span it takes (Tailwind needs the class names written out). */
const FOOTER_COLS = [
  { c: 1, links: 3, span: 'col-span-6 lg:col-span-3' },
  { c: 2, links: 4, span: 'col-span-6 lg:col-span-3' },
  { c: 3, links: 5, span: 'col-span-12 lg:col-span-3' },
] as const;

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
  const logoLight = site?.brand.logos.paper || '';
  const logoDark = site?.brand.logos.dark || logoLight;
  const authed = !!session.session;
  const dashboard = session.session ? homePathFor(session.session) : '/login';
  const vars = themeVars(content.values) as CSSProperties;

  const navLinks = [1, 2, 3, 4, 5, 6].filter((i) => edit || fc(`nav.link${i}_label`) !== '');
  const legalFor: Record<string, string | undefined> = {
    '/legal/terms': legal?.terms,
    '/legal/privacy': legal?.privacy,
    '/legal/cookies': legal?.cookies,
  };
  const year = new Date().getFullYear();
  const socials = Object.entries(site?.footer.social ?? {}).filter(([, href]) => !!href);

  return (
    <div className={`cms-site${edit ? ' cms-edit' : ''}`} style={vars}>
      <link rel="stylesheet" href={FONTS} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        {t('skip')}
      </a>
      <Ticker items={announcements?.data ?? []} ctx={ctx} label={t('announcementsLabel')} />
      <header
        data-fc-section="nav"
        className="hairline-b sticky top-0 z-40 bg-white/92 backdrop-blur"
        aria-label={t('navLabel')}
      >
        <div className="relative mx-auto flex h-[68px] max-w-[1360px] items-center gap-8 px-4 sm:px-7">
          <Link href="/" className="flex items-center gap-2.5">
            {logoLight ? (
              <img
                src={logoLight}
                alt={brand}
                className="h-9 w-auto max-w-[180px] object-contain"
              />
            ) : (
              <>
                <BrandMark />
                <div className="leading-none">
                  <div className="serif text-[24px]">{brand}</div>
                  <div className="mono mt-1 text-[8.5px] uppercase tracking-[0.22em] text-ink-500">
                    {t('platform')}
                  </div>
                </div>
              </>
            )}
          </Link>
          <div className="flex-1" />
          <nav
            aria-label={t('navLabel')}
            className="absolute start-1/2 hidden -translate-x-1/2 rtl:translate-x-1/2 items-center gap-7 text-[13.5px] text-ink-700 lg:flex"
          >
            {navLinks.map((i) => {
              const href = fc(`nav.link${i}_url`) || '#';
              const active = isCurrent(href, here);
              return (
                <Link
                  key={i}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  {...(edit ? { 'data-fc-url': `nav.link${i}_url` } : {})}
                  className={`relative ${active ? 'font-semibold text-wa-deep' : 'cursor-pointer hover:text-wa-deep'}`}
                >
                  <T ctx={ctx} k={`nav.link${i}_label`} />
                  {active && (
                    <span className="absolute -bottom-[22px] start-0 end-0 h-[2px] bg-wa-deep" />
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            {authed ? (
              <Link
                href={dashboard}
                className="flex items-center gap-1.5 rounded-full bg-wa-deep px-4 py-2.5 text-[13px] font-semibold text-paper-0 hover:bg-wa-teal"
              >
                <T ctx={ctx} k="nav.dashboard_label" />
                <Chevron />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-3 py-2 text-[13.5px] font-medium text-ink-700 hover:text-wa-deep"
                >
                  <T ctx={ctx} k="nav.signin_label" />
                </Link>
                <Link
                  href="/register"
                  className="flex items-center gap-1.5 rounded-full bg-wa-deep px-4 py-2.5 text-[13px] font-semibold text-paper-0 hover:bg-wa-teal"
                >
                  <T ctx={ctx} k="nav.cta_label" />
                  <Chevron />
                </Link>
              </>
            )}
          </div>
          <MobileNav
            links={navLinks.map((i) => ({
              href: fc(`nav.link${i}_url`) || '#',
              label: fc(`nav.link${i}_label`),
            }))}
            primary={
              authed
                ? { href: dashboard, label: fc('nav.dashboard_label') }
                : { href: '/register', label: fc('nav.cta_label') }
            }
            secondary={authed ? null : { href: '/login', label: fc('nav.signin_label') }}
            openLabel={t('menuOpen')}
            closeLabel={t('menuClose')}
          />
        </div>
      </header>
      <main id="main" className="cms-main">
        {children}
      </main>
      <footer data-fc-section="footer" className="relative overflow-hidden bg-ink-950 text-paper-0">
        <div className="dot-pattern absolute inset-0 opacity-10" />
        <div className="relative mx-auto grid max-w-[1360px] grid-cols-12 gap-8 px-4 py-16 sm:px-6 lg:px-7">
          <div className="col-span-12 lg:col-span-3">
            <div className="flex items-center gap-2.5">
              {logoDark ? (
                <img
                  src={logoDark}
                  alt={brand}
                  className="h-10 w-auto max-w-[200px] object-contain"
                />
              ) : (
                <>
                  <BrandMark dark />
                  <span className="serif text-[28px]">{site?.footer.title || brand}</span>
                </>
              )}
            </div>
            <T
              ctx={ctx}
              k="footer.tagline"
              as="p"
              className="mt-5 max-w-xs text-[13px] leading-relaxed text-paper-0/70"
            />
            {site?.footer.description && !edit && fc('footer.tagline') === '' && (
              <p className="mt-5 max-w-xs text-[13px] leading-relaxed text-paper-0/70">
                {site.footer.description}
              </p>
            )}
            {(edit || fc('footer.status_label') !== '') && (
              <div className="hairline mt-6 rounded-xl border-paper-0/15 bg-paper-0/5 p-4">
                <T
                  ctx={ctx}
                  k="footer.status_title"
                  as="div"
                  className="mono mb-2 text-[10px] uppercase tracking-widest text-paper-0/50"
                />
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="pulse-dot h-2 w-2 rounded-full bg-wa-green" />
                  <T ctx={ctx} k="footer.status_label" />
                </div>
              </div>
            )}
          </div>
          {FOOTER_COLS.map(({ c, links, span }) => (
            <div key={c} className={span}>
              <T
                ctx={ctx}
                k={`footer.col${c}_title`}
                as="div"
                className="mono mb-4 text-[10px] uppercase tracking-widest text-paper-0/50"
              />
              <ul className="space-y-2.5 text-[13px]">
                {Array.from({ length: links }, (_, n) => n + 1).map((l) => {
                  const url = fc(`footer.col${c}_link${l}_url`);
                  if (!edit && fc(`footer.col${c}_link${l}_label`) === '') return null;
                  return (
                    <li key={l}>
                      <Link
                        href={(!edit && legalFor[url]) || url || '#'}
                        className="hover:text-wa-green"
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
        </div>
        <div className="hairline-t relative border-paper-0/15">
          <div className="mono mx-auto flex max-w-[1360px] flex-col items-center gap-3 px-4 py-5 text-[11px] text-paper-0/55 sm:px-6 lg:px-7">
            {socials.length > 0 && (
              <div className="flex items-center gap-2.5">
                {socials.map(([name, href]) => (
                  <a
                    key={name}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={name}
                    aria-label={name}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-paper-0/15 text-paper-0/70 transition hover:border-wa-green/50 hover:text-wa-green"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      dangerouslySetInnerHTML={{ __html: SOCIAL_ICONS[name.toLowerCase()] ?? '' }}
                    />
                  </a>
                ))}
              </div>
            )}
            <span className="text-center">
              {edit ? (
                <T ctx={ctx} k="footer.copyright" />
              ) : (
                fc('footer.copyright') || site?.footer.copyright || `© ${year} ${brand}`
              )}
            </span>
            <a href="#cookie-preferences" data-cookie-prefs-open className="hover:text-wa-green">
              {t('cookiePreferences')}
            </a>
          </div>
        </div>
      </footer>
      <RevealObserver all={edit} />
      {site && !edit && <PublicCustomCode cfg={site} />}
      {edit && <PreviewBridge />}
    </div>
  );
}
