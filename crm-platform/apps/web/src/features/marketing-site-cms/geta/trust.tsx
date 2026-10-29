'use client';

import { CERTIFICATIONS, CUSTOMER_LOGOS, REVIEW_SITES, TESTIMONIALS } from './data/social';
import { Icon } from './icons';
import { Portrait } from './portrait';
import './trust.css';

/** A moving strip of customer logos (the strip stops for visitors who prefer reduced motion). */
export function LogoStrip() {
  const row = [...CUSTOMER_LOGOS, ...CUSTOMER_LOGOS];
  return (
    <div className="tr-logos" aria-label="Customers">
      <div className="tr-track">
        {row.map((l, i) => (
          <span key={`${l.file}-${i}`} className="tr-logo" aria-hidden={i >= CUSTOMER_LOGOS.length}>
            {}
            <img
              src={`/geta/customers/${l.file}`}
              alt={i < CUSTOMER_LOGOS.length ? l.name : ''}
              loading="lazy"
            />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Customer quotes as cards: the first is featured, the others sit beside it. */
export function Testimonials() {
  return (
    <div className="tr-cards">
      {TESTIMONIALS.map((t, i) => (
        <figure key={t.id} className={`tr-card${i === 0 ? ' feat' : ''}`}>
          <svg className="tr-q" viewBox="0 0 48 36" aria-hidden focusable="false">
            <path d="M0 36V21C0 9 6 2 18 0l2 5c-6 2-9 6-9 11h9v20zm27 0V21c0-12 6-19 18-21l2 5c-6 2-9 6-9 11h9v20z" />
          </svg>
          <span className="tr-tag">{t.tab}</span>
          <blockquote>“{t.quote}”</blockquote>
          <figcaption>
            <span className="tr-av" aria-hidden>
              <Portrait look={t.look} />
              <span className="tr-bd">
                <Icon name={t.badge} />
              </span>
            </span>
            <span>
              <b>{t.person}</b>
              <i>{t.role}</i>
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Compliance badges and review-site ratings. */
export function TrustBadges({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`tr-badges${dark ? ' dark' : ''}`}>
      <ul className="tr-certs" aria-label="Security and compliance">
        {CERTIFICATIONS.map((c) => (
          <li key={c.name}>
            {}
            <img src={`/geta/certs/${c.file}`} alt={c.name} loading="lazy" />
          </li>
        ))}
      </ul>
      <ul className="tr-reviews" aria-label="Review sites">
        {REVIEW_SITES.map((r) => (
          <li key={r.name}>
            <a href={r.href} target="_blank" rel="noopener noreferrer">
              <span aria-hidden>★</span>
              <b>{r.rating}</b>
              <span>on {r.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
