'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicPricingResponse } from '@crm/contracts';
import { formatMoney } from '@/features/plans-subscriptions-trials/lib/format';
import { toPricingCard, type PricingCard } from '../site/pricing-cards';
import { Icon } from './icons';
import './palette.css';

const NS = 'plans-subscriptions-trials';

/** A plan outline shown while the plan catalogue has no active plan. Words only: no limits are promised here. */
export interface PlanOutline {
  name: string;
  tagline: string;
  highlighted?: boolean;
  rows: string[];
}

interface Shown {
  key: string;
  name: string;
  tagline: string;
  badge: string;
  highlighted: boolean;
  groups: Array<{ title?: string; rows: Array<{ label: string; included: boolean }> }>;
}

/**
 * The plans, without prices. Every plan says what it includes and ends in "Contact us"; the amounts are agreed with the
 * team, so none is shown. Plans come from the same catalogue the checkout uses, and the outlines are used only when there
 * is none.
 */
export function PlanCards({
  pricing,
  outlines,
}: {
  pricing: PublicPricingResponse | null;
  outlines: PlanOutline[];
}) {
  const locale = useLocale();
  const t = useTranslations(`${NS}.public`);
  const tp = useTranslations(`${NS}.plans`);
  const tl = useTranslations(`${NS}.limits`);
  const tf = useTranslations(`${NS}.features`);
  const tc = useTranslations(`${NS}.common`);
  const tw = useTranslations('marketing-site-cms.site.priceCard');

  const cards: PricingCard[] = (pricing?.plans ?? []).map((p, i) =>
    toPricingCard(p, i, {
      planNum: (n) => tw('planNum', { n }),
      limit: (k) => tl(k as 'devices'),
      feature: (k) => tf(k as 'automation'),
      unlimited: tc('unlimited'),
      free: tp('free'),
      custom: tp('customQuote'),
      popular: tw('popular'),
      forever: tw('forever'),
      contactSales: tw('contactSales'),
      oneTime: tp('oneTime'),
      talkToSales: t('talkToSales'),
      startFree: t('startFree'),
      getStarted: tw('getStarted'),
      docsCommunity: tw('docsCommunity'),
      prioritySupport: tw('prioritySupport'),
      perUnit: (unit, count) => tp(`perUnit.${unit}` as 'perUnit.months', { count }),
      money: (a, c) => formatMoney(a, c, locale),
      number: (n) => new Intl.NumberFormat(locale).format(n),
    }),
  );

  const shown: Shown[] =
    cards.length > 0
      ? cards.map((c) => ({
          key: c.slug,
          name: c.name,
          tagline: c.tagline,
          badge: c.badge === tp('free').toLowerCase() ? '' : c.badge,
          highlighted: c.highlighted,
          groups: [
            { title: 'Volume', rows: c.volume },
            { title: 'Features', rows: c.features },
            { title: 'Support', rows: c.support },
          ].filter((g) => g.rows.length > 0),
        }))
      : outlines.map((o) => ({
          key: o.name,
          name: o.name,
          tagline: o.tagline,
          badge: o.highlighted ? 'Most chosen' : '',
          highlighted: !!o.highlighted,
          groups: [{ rows: o.rows.map((label) => ({ label, included: true })) }],
        }));

  return (
    <div className="pc-grid">
      {shown.map((p) => (
        <article key={p.key} className={`pc${p.highlighted ? ' hl' : ''}`}>
          <div className="pc-top">
            <h3>{p.name}</h3>
            {p.badge && <span className="pc-badge">{p.badge}</span>}
          </div>
          {p.tagline && <p className="pc-sub">{p.tagline}</p>}
          <Link
            href={`/contact?plan=${encodeURIComponent(p.key)}`}
            className={`gx-btn ${p.highlighted ? 'gx-btn-white' : 'gx-btn-primary'} pc-cta`}
          >
            Contact us
          </Link>
          {p.groups.map((g, gi) => (
            <div key={gi} className="pc-group">
              {g.title && <p className="pc-h">{g.title}</p>}
              <ul>
                {g.rows.map((r) => (
                  <li key={r.label} className={r.included ? undefined : 'off'}>
                    <Icon name={r.included ? 'check' : 'close'} />
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
