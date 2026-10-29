import type { ComponentType } from 'react';
import './legal.css';
import { CookiesBody } from './cookies';
import { PrivacyBody } from './privacy';
import { TermsBody } from './terms';

/**
 * The public legal documents, carried over from the existing geta.ai site. They are the fallback for /legal/<slug>: a
 * document an operator writes in the admin content editor takes priority, and these show when there is none, so the footer
 * links never 404. Have your lawyer review them against this product before launch; they describe the previous product.
 */
const ENTITY = 'Geta AI Labs Pvt Ltd';

export const STATIC_LEGAL: Record<
  string,
  { title: string; description: string; updated: string | null; Body: ComponentType }
> = {
  privacy: {
    title: 'Privacy Policy',
    description: `How ${ENTITY} collects, uses, secures and protects your data, and your rights under GDPR and applicable law.`,
    updated: 'March 25, 2026',
    Body: PrivacyBody,
  },
  terms: {
    title: 'Terms and Conditions',
    description: `The rules for using the ${ENTITY} website and app.`,
    updated: null,
    Body: TermsBody,
  },
  cookies: {
    title: 'Cookie Policy',
    description: 'How we use cookies and tracking, and how you can control them.',
    updated: 'March 25, 2026',
    Body: CookiesBody,
  },
};

export function StaticLegal({ slug }: { slug: string }) {
  const doc = STATIC_LEGAL[slug];
  if (!doc) return null;
  const { Body } = doc;
  return (
    <>
      <header className="lg-hero">
        <div className="gx-wrap lg-narrow">
          <div className="gx-eyebrow">Legal</div>
          <h1 className="gx-h1" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)' }}>
            {doc.title}
          </h1>
          <p className="lg-meta">
            {doc.updated ? `Last updated: ${doc.updated} · ` : ''}
            {ENTITY}
          </p>
        </div>
      </header>
      <section className="lg-body">
        <div className="gx-wrap lg-narrow lg-prose">
          <Body />
        </div>
      </section>
    </>
  );
}
