'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PlanCard } from '@crm/contracts';
import { Badge, Button, Spinner, cn } from '@crm/ui';
import { CheckIcon } from '../../shared/icons';
import { ctaFor, messagesView, priceView } from './plan-format';

/**
 * One plan as a workspace sees it (WD-AUTH-009 / WD-PLAN-011): name, subtitle,
 * the price (offer first, list price struck through) with its period, the
 * monthly message allowance, up to three feature chips, a "most popular" badge
 * and a "current plan" marker. What the button does comes from the `action` the
 * API computed (so upgrade/downgrade is decided once, on the server): paid
 * plans lead to /account/plans, which says checkout arrives with billing.
 */
export function PlanCardView({
  card,
  onContinueFree,
  busy = false,
}: {
  card: PlanCard;
  /** Finishes the flow on the plan the workspace already has (the free card). */
  onContinueFree?: () => void;
  busy?: boolean;
}) {
  const t = useTranslations('auth-registration-security.account.plans.card');
  const locale = useLocale();
  const titleId = useId();
  const price = priceView(card, locale);
  const messages = messagesView(card);
  const cta = ctaFor(card.action);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cn(
        'relative space-y-3 rounded-xl border bg-background p-3.5 text-foreground',
        card.highlighted ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'border-border',
        card.current && !card.highlighted && 'bg-muted/50',
      )}
    >
      {card.highlighted && (
        <span className="absolute -top-2 start-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 font-mono rtl:font-sans text-[10px] uppercase text-primary-foreground">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-[#25d366]" />
          {t('popular')}
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-serif text-[18px] leading-tight">
            {card.name}
          </h3>
          {card.subtitle && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{card.subtitle}</p>
          )}
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary">
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M2 4h12v8H2zM5 4v8M11 4v8" />
            </svg>
            {messages.kind === 'unlimited'
              ? t('messagesUnlimited')
              : t('messagesLimited', { count: messages.count })}
          </p>
          {card.chips.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label={t('chipsLabel')}>
              {card.chips.map((key) => (
                <li
                  key={key}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono rtl:font-sans text-[10px] text-muted-foreground"
                >
                  {t(`chips.${key}`)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 text-end">
          {price.kind === 'free' && (
            <p className="font-serif text-[22px] leading-none text-primary">{t('free')}</p>
          )}
          {price.kind === 'custom' && (
            <p className="font-serif text-[22px] leading-none text-primary">{t('custom')}</p>
          )}
          {price.kind === 'paid' && (
            <>
              {price.strike && (
                <p
                  className="text-[11px] leading-none text-muted-foreground line-through"
                  data-testid="plan-strike"
                >
                  {price.strike}
                </p>
              )}
              <p
                className="mt-0.5 font-serif text-[22px] leading-none text-primary"
                data-testid="plan-price"
              >
                {price.main}
              </p>
              <p className="mt-1 font-mono rtl:font-sans text-[10.5px] text-muted-foreground">
                {price.lifetime
                  ? t('lifetime')
                  : price.period
                    ? t(`period.${price.period.unit}`, { count: price.period.count })
                    : null}
              </p>
            </>
          )}
        </div>
      </div>

      <div>
        {cta.kind === 'current' && (
          <Badge tone="success" className="px-2.5 py-1 text-sm">
            <CheckIcon className="me-1 size-3.5" />
            {t('current')}
          </Badge>
        )}
        {cta.kind === 'continue-free' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full rounded-full sm:w-auto"
            disabled={busy || !onContinueFree}
            onClick={onContinueFree}
          >
            {busy && <Spinner label={t('cta.working')} />}
            {t('cta.continueFree')}
          </Button>
        )}
        {cta.kind === 'link' && (
          <Link
            href={cta.href}
            className={cn(
              'inline-flex h-8 w-full items-center justify-center rounded-full px-4 text-[12.5px] font-medium transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary sm:w-auto',
              cta.label === 'talkToSales'
                ? 'border border-border bg-background text-foreground hover:bg-muted'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {cta.label === 'talkToSales' && t('cta.talkToSales')}
            {cta.label === 'upgrade' && t('cta.upgrade', { name: card.name })}
            {cta.label === 'choose' && card.ctaLabel}
          </Link>
        )}
        {cta.kind === 'disabled' && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled
              aria-describedby={`${titleId}-down`}
              className="w-full rounded-full sm:w-auto"
            >
              {t('cta.downgradeUnavailable')}
            </Button>
            <p id={`${titleId}-down`} className="mt-1 text-xs text-muted-foreground">
              {t('cta.downgradeHint')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
