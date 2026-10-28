import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { PublicCustomCode } from '@/features/platform-settings-branding-storage/site/site-head';
import { getSession, homePathFor } from '@/lib/auth/server';
import {
  DEFAULT_BRAND,
  NAV_CHANNELS,
  NAV_COMPANY,
  NAV_INDUSTRIES,
  NAV_PRODUCTS,
  NAV_CHANNELS_MENU,
  NAV_RESOURCES,
  NAV_USE_CASES,
  type NavLink,
} from './data/site';
import { Icon } from './icons';
import { ScrollPlay } from './scroll-play';
import '../site/site.css';
import './geta.css';
import './skin.css';
import './home.css';
import './palette.css';

const FONT =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap';

function DropLinks({ items }: { items: NavLink[] }) {
  return (
    <div>
      {items.map((l) => (
        <Link key={l.href} href={l.href} className="gx-drop-link">
          {l.icon && (
            <span className="gx-drop-ic">
              <Icon name={l.icon} />
            </span>
          )}
          <span>
            <span className="gx-drop-t">{l.label}</span>
            {l.desc && (
              <span className="gx-drop-d" style={{ display: 'block' }}>
                {l.desc}
              </span>
            )}
          </span>
        </Link>
      ))}
    </div>
  );
}

function NavMenu({ label, children, wide }: { label: string; children: ReactNode; wide: string }) {
  return (
    <div className="gx-nav-item">
      <button type="button" className="gx-nav-btn" aria-haspopup="true">
        {label}
        <Icon name="chevron" />
      </button>
      <div className="gx-drop">
        <div className={`gx-drop-card ${wide}`}>{children}</div>
      </div>
    </div>
  );
}

function MobileGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details>
      <summary>
        {label}
        <Icon name="chevron" />
      </summary>
      <div style={{ paddingBottom: 10 }}>{children}</div>
    </details>
  );
}

const MLinks = ({ items }: { items: NavLink[] }) => (
  <>
    {items.map((l) => (
      <Link key={l.href} href={l.href} className="gx-m-link">
        {l.label}
      </Link>
    ))}
  </>
);

/** The public site frame: header with mega menus, the page, footer and the platform's own custom code. */
export async function GetaFrame({ children }: { children: ReactNode }) {
  const [site, auth] = await Promise.all([getSiteConfig(), getSession()]);
  const brand = DEFAULT_BRAND;
  const logo = site?.brand.logos.paper || '/geta/geta-logo-color.png';
  const logoDark = site?.brand.logos.dark || site?.brand.logos.paper || '/geta/geta-logo-white.png';
  const authed = !!auth.session;
  const dashboard = auth.session ? homePathFor(auth.session) : '/login';
  const legal = site?.legal;
  const socials = Object.entries(site?.footer.social ?? {}).filter(([, href]) => !!href);
  const year = new Date().getFullYear();

  const legalLinks = [
    { label: 'Privacy Policy', href: legal?.privacy || '/legal/privacy' },
    { label: 'Terms of Service', href: legal?.terms || '/legal/terms' },
    { label: 'Cookie Policy', href: legal?.cookies || '/legal/cookies' },
    { label: 'Delete account', href: '/delete-account' },
  ];

  return (
    <div className="gx-site">
      <ScrollPlay />
      <link rel="stylesheet" href={FONT} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="gx-header">
        <div className="gx-wrap gx-bar">
          <Link href="/" className="gx-logo" aria-label={`${brand} home`}>
            {logo ? (
              <img src={logo} alt={brand} />
            ) : (
              <>
                <span className="gx-logo-mark" aria-hidden>
                  {brand.slice(0, 1).toUpperCase()}
                </span>
                {brand}
              </>
            )}
          </Link>
          <nav className="gx-nav" aria-label="Main">
            <NavMenu label="Product" wide="gx-drop-prod">
              <div>
                <p className="gx-drop-label">Features</p>
                <div className="gx-feat">
                  <DropLinks items={NAV_PRODUCTS.slice(0, 5)} />
                  <DropLinks items={NAV_PRODUCTS.slice(5)} />
                </div>
              </div>
              <div>
                <p className="gx-drop-label">Channels</p>
                <DropLinks items={NAV_CHANNELS_MENU} />
                <Link href="/products/channels" className="gx-drop-link">
                  <span className="gx-drop-t">All channels →</span>
                </Link>
              </div>
            </NavMenu>
            <NavMenu label="Solutions" wide="gx-drop-two">
              <div>
                <p className="gx-drop-label">By industry</p>
                <DropLinks items={NAV_INDUSTRIES} />
              </div>
              <div>
                <p className="gx-drop-label">By use case</p>
                <DropLinks items={NAV_USE_CASES} />
              </div>
            </NavMenu>
            <Link href="/features" className="gx-nav-btn">
              Features
            </Link>
            <Link href="/pricing" className="gx-nav-btn">
              Pricing
            </Link>
            <NavMenu label="Resources" wide="gx-drop-one">
              <DropLinks items={NAV_RESOURCES} />
            </NavMenu>
          </nav>
          <div className="gx-bar-end">
            {authed ? (
              <Link href={dashboard} className="gx-btn gx-btn-primary gx-btn-sm">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="gx-login">
                  Log in
                </Link>
                <Link href="/register" className="gx-btn gx-btn-primary gx-btn-sm">
                  Start free trial
                </Link>
              </>
            )}
          </div>
          <details className="gx-burger">
            <summary aria-label="Open menu">
              <Icon name="menu" />
            </summary>
            <div className="gx-mobile">
              <MobileGroup label="Product">
                <div className="gx-m-label">Features</div>
                <MLinks items={NAV_PRODUCTS} />
                <div className="gx-m-label">Channels</div>
                <MLinks items={NAV_CHANNELS_MENU} />
                <Link href="/products/channels" className="gx-m-link">
                  All channels
                </Link>
              </MobileGroup>
              <MobileGroup label="Solutions">
                <div className="gx-m-label">By industry</div>
                <MLinks items={NAV_INDUSTRIES} />
                <div className="gx-m-label">By use case</div>
                <MLinks items={NAV_USE_CASES} />
              </MobileGroup>
              <MobileGroup label="Resources">
                <MLinks items={NAV_RESOURCES} />
              </MobileGroup>
              <Link
                href="/features"
                className="gx-m-link"
                style={{ padding: '14px 0', fontWeight: 600, color: 'var(--gx-ink)' }}
              >
                Features
              </Link>
              <Link
                href="/pricing"
                className="gx-m-link"
                style={{ padding: '14px 0', fontWeight: 600, color: 'var(--gx-ink)' }}
              >
                Pricing
              </Link>
              <div className="gx-mobile-cta">
                {authed ? (
                  <Link href={dashboard} className="gx-btn gx-btn-primary">
                    Go to dashboard
                  </Link>
                ) : (
                  <>
                    <Link href="/register" className="gx-btn gx-btn-primary">
                      Start free trial
                    </Link>
                    <Link href="/login" className="gx-btn gx-btn-ghost">
                      Log in
                    </Link>
                  </>
                )}
              </div>
            </div>
          </details>
        </div>
      </header>
      <main id="main" className="gx-main">
        {children}
      </main>
      <footer className="gx-footer">
        <div className="gx-wrap">
          <div className="gx-foot-top">
            <h3>Put AI agents and a CRM to work on your conversations.</h3>
            <div className="gx-cta-row" style={{ margin: 0 }}>
              <Link href="/register" className="gx-btn gx-btn-primary">
                Start free trial
              </Link>
            </div>
          </div>
          <div className="gx-foot-grid">
            <div className="gx-foot-brand">
              <Link href="/" className="gx-logo" style={{ color: '#fff' }}>
                {logoDark ? (
                  <img src={logoDark} alt={brand} />
                ) : (
                  <>
                    <span className="gx-logo-mark" aria-hidden>
                      {brand.slice(0, 1).toUpperCase()}
                    </span>
                    {site?.footer.title || brand}
                  </>
                )}
              </Link>
              <p style={{ marginTop: 16, maxWidth: 300, fontSize: 14.5 }}>
                {site?.footer.description ||
                  'The agentic AI engagement platform with a CRM built in: AI agents, inbox, WhatsApp, campaigns and deals in one workspace.'}
              </p>
              <div className="gx-foot-pills">
                <span>SOC 2 Type II</span>
                <span>ISO 27001</span>
                <span>GDPR Ready</span>
              </div>
              {socials.length > 0 && (
                <p
                  style={{
                    marginTop: 14,
                    display: 'flex',
                    gap: 14,
                    flexWrap: 'wrap',
                    fontSize: 14,
                  }}
                >
                  {socials.map(([name, href]) => (
                    <a
                      key={name}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textTransform: 'capitalize' }}
                    >
                      {name}
                    </a>
                  ))}
                </p>
              )}
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <Link href="/platform">Platform overview</Link>
                </li>
                {NAV_PRODUCTS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Channels</h4>
              <ul>
                {NAV_CHANNELS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Solutions</h4>
              <ul>
                {NAV_INDUSTRIES.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
              <h4 style={{ marginTop: 24 }}>Use cases</h4>
              <ul>
                {NAV_USE_CASES.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Explore</h4>
              <ul>
                <li>
                  <Link href="/features">All features</Link>
                </li>
                <li>
                  <Link href="/get-started">Find your fit</Link>
                </li>
                <li>
                  <Link href="/pricing">Pricing</Link>
                </li>
                <li>
                  <Link href="/blog">Blog</Link>
                </li>
                <li>
                  <Link href="/developers/docs">API documentation</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Company</h4>
              <ul>
                {NAV_COMPANY.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
                {legalLinks.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="gx-foot-base">
            <span>{site?.footer.copyright || `© ${year} ${brand}. All rights reserved.`}</span>
            <a href="#cookie-preferences" data-cookie-prefs-open>
              Cookie preferences
            </a>
          </div>
        </div>
      </footer>
      {site && <PublicCustomCode cfg={site} />}
    </div>
  );
}
