import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Faq } from './data/products';
import { Icon, type IconName } from './icons';

export const Wrap = ({ children }: { children: ReactNode }) => (
  <div className="gx-wrap">{children}</div>
);

export function SecHead({
  eyebrow,
  title,
  lead,
  center,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: string;
  center?: boolean;
}) {
  return (
    <div className={`gx-sec-head${center ? ' gx-center' : ''}`}>
      {eyebrow && <div className="gx-eyebrow">{eyebrow}</div>}
      <h2 className="gx-h2">{title}</h2>
      {lead && <p className="gx-lead">{lead}</p>}
    </div>
  );
}

export function Section({
  children,
  soft,
  tone,
  id,
  label,
}: {
  children: ReactNode;
  soft?: boolean;
  tone?: 'soft' | 'gray' | 'dark' | 'sky' | 'cream' | 'blush' | 'sun';
  id?: string;
  label?: string;
}) {
  const t = tone ?? (soft ? 'soft' : undefined);
  return (
    <section id={id} aria-label={label} className={`gx-sec${t ? ` gx-sec-${t}` : ''}`}>
      <Wrap>{children}</Wrap>
    </section>
  );
}

export function Cta({
  href,
  children,
  variant = 'primary',
  small,
  arrow,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'white' | 'line';
  small?: boolean;
  arrow?: boolean;
}) {
  const cls = {
    primary: 'gx-btn gx-btn-primary',
    ghost: 'gx-btn gx-btn-ghost',
    white: 'gx-btn gx-btn-white',
    line: 'gx-btn gx-btn-line',
  }[variant];
  const className = `${cls}${small ? ' gx-btn-sm' : ''}`;
  const inner = (
    <>
      {children}
      {arrow && <Icon name="arrow" />}
    </>
  );
  // A link to a spot on the same page is a plain anchor: the browser scrolls to it and puts it in the address bar.
  if (href.startsWith('#')) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {inner}
    </Link>
  );
}

export function Assurances({ items }: { items: string[] }) {
  return (
    <ul className="gx-assure">
      {items.map((t) => (
        <li key={t}>
          <Icon name="check" />
          {t}
        </li>
      ))}
    </ul>
  );
}

/** The top of every inner page: eyebrow, headline, sub copy, two buttons and an optional visual. */
export function Hero({
  eyebrow,
  crumbs,
  title,
  sub,
  points,
  visual,
  primary = { href: '/register', label: 'Start free trial' },
  secondary = { href: '/platform', label: 'Explore the platform' },
}: {
  eyebrow?: string;
  crumbs?: Array<{ label: string; href?: string }>;
  title: ReactNode;
  sub: string;
  points?: string[];
  visual?: ReactNode;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string } | null;
}) {
  return (
    <header className={`gx-hero${visual ? '' : ' gx-hero-plain'}`}>
      <Wrap>
        <div className="gx-hero-grid">
          <div>
            {crumbs && (
              <nav className="gx-crumb" aria-label="Breadcrumb">
                {crumbs.map((c, i) => (
                  <span key={c.label}>
                    {i > 0 && ' / '}
                    {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
                  </span>
                ))}
              </nav>
            )}
            {eyebrow && <div className="gx-eyebrow">{eyebrow}</div>}
            <h1 className="gx-h1">{title}</h1>
            <p className="gx-lead">{sub}</p>
            <div className="gx-cta-row">
              <Cta href={primary.href} arrow>
                {primary.label}
              </Cta>
              {secondary && (
                <Cta href={secondary.href} variant="ghost">
                  {secondary.label}
                </Cta>
              )}
            </div>
            {points && <Assurances items={points} />}
          </div>
          {visual && <div className="gx-hero-visual">{visual}</div>}
        </div>
      </Wrap>
    </header>
  );
}

export function Card({
  icon,
  title,
  text,
  href,
  more,
  green,
}: {
  icon?: IconName;
  title: string;
  text: string;
  href?: string;
  more?: string;
  green?: boolean;
}) {
  const body = (
    <>
      {icon && (
        <div className={`gx-ic${green ? ' gx-ic-green' : ''}`}>
          <Icon name={icon} />
        </div>
      )}
      <h3 className="gx-h3">{title}</h3>
      <p>{text}</p>
      {href && more && (
        <span className="gx-more">
          {more} <Icon name="arrow" />
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="gx-card">
      {body}
    </Link>
  ) : (
    <div className="gx-card">{body}</div>
  );
}

export function Steps({ items }: { items: Array<{ title: string; text: string }> }) {
  const cols = items.length === 4 ? 'gx-grid-4' : 'gx-grid-3';
  return (
    <ol className={`gx-grid ${cols}`} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {items.map((s, i) => (
        <li key={s.title} className="gx-card">
          <div className="gx-num">{i + 1}</div>
          <h3 className="gx-h3">{s.title}</h3>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="gx-faq">
      {items.map((f) => (
        <details key={f.q}>
          <summary>
            {f.q}
            <Icon name="plus" />
          </summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function FaqJsonLd({ items }: { items: Faq[] }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** Organization and product facts for search engines, on the home page. */
export function OrgJsonLd() {
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Geta.ai',
      legalName: 'Geta AI Labs Pvt Ltd',
      url: 'https://geta.ai',
      logo: 'https://geta.ai/geta/geta-logo-color.png',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Geta.ai',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'An agentic AI engagement platform with a built-in CRM: AI agents, a shared inbox, WhatsApp and other channels, campaigns and deals in one workspace.',
    },
  ];
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

export function CtaBand({
  title = 'See it working on your own conversations.',
  text = 'Connect your first channel today and put an AI agent and a CRM to work on your conversations.',
  points = [
    'AI agents, inbox and CRM included',
    'Official WhatsApp Cloud API',
    'Roles and permissions from day one',
  ],
}: {
  title?: string;
  text?: string;
  points?: string[];
}) {
  return (
    <Section label="Get started">
      <div className="gx-band">
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="gx-cta-row">
          <Cta href="/register" variant="white" arrow>
            Start free trial
          </Cta>
          <Cta href="/contact" variant="line">
            Contact us
          </Cta>
        </div>
        <ul className="gx-band-points">
          {points.map((p) => (
            <li key={p}>✓ {p}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** A conversation sample, drawn in CSS. Copy is illustrative, written for the page. */
export function ChatMock({
  title,
  lines,
}: {
  title: string;
  lines: Array<{ from: 'customer' | 'business'; text: string }>;
}) {
  return (
    <div className="gx-win" role="img" aria-label={`Example conversation: ${title}`}>
      <div className="gx-win-bar">
        <span className="gx-dot" />
        <span className="gx-dot" />
        <span className="gx-dot" />
        <span style={{ marginLeft: 8 }}>{title}</span>
      </div>
      <div className="gx-chat">
        {lines.map((l, i) => (
          <div key={i} className={`gx-bub ${l.from === 'customer' ? 'gx-in' : 'gx-out'}`}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A window listing a page's capabilities, used as the hero visual of product pages. */
export function FeatureWindow({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ title: string; text: string; icon: IconName }>;
}) {
  return (
    <div className="gx-win" aria-hidden>
      <div className="gx-win-bar">
        <span className="gx-dot" />
        <span className="gx-dot" />
        <span className="gx-dot" />
        <span style={{ marginLeft: 8 }}>{title}</span>
      </div>
      <div className="gx-win-body">
        {rows.slice(0, 4).map((r) => (
          <div key={r.title} className="gx-vis-row">
            <div className="gx-drop-ic">
              <Icon name={r.icon} />
            </div>
            <div>
              <b>{r.title}</b>
              <span>{r.text.length > 54 ? `${r.text.slice(0, 52).trim()}…` : r.text}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
