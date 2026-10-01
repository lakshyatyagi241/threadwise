'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { PlanCard } from '@crm/contracts';
import { Badge, Button, Card, Spinner, cn } from '@crm/ui';
import { CheckIcon } from '../../shared/icons';
import { ctaFor, messagesView, priceView } from './plan-format';

/**
 * One plan as a workspace sees it (TW-AUTH-009 / TW-PLAN-011): name, subtitle,
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
    <Card
      role="group"
      aria-labelledby={titleId}
      className={cn(
        'relative space-y-3 p-4',
        card.highlighted && 'border-primary ring-2 ring-primary/20',
        card.current && 'bg-muted/50',
      )}
    >
      {card.highlighted && (
        <Badge className="absolute -top-2.5 start-4 bg-primary text-primary-foreground">
          {t('popular')}
        </Badge>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={titleId} className="text-lg font-semibold leading-tight">
            {card.name}
          </h3>
          {card.subtitle && <p className="text-sm text-muted-foreground">{card.subtitle}</p>}
          <p className="text-sm font-medium text-primary">
            {messages.kind === 'unlimited'
              ? t('messagesUnlimited')
              : t('messagesLimited', { count: messages.count })}
          </p>
        </div>

        <div className="shrink-0 text-end">
          {price.kind === 'free' && <p className="text-xl font-semibold">{t('free')}</p>}
          {price.kind === 'custom' && <p className="text-xl font-semibold">{t('custom')}</p>}
          {price.kind === 'paid' && (
            <>
              {price.strike && (
                <p className="text-xs text-muted-foreground line-through" data-testid="plan-strike">
                  {price.strike}
                </p>
              )}
              <p className="text-xl font-semibold" data-testid="plan-price">
                {price.main}
              </p>
              <p className="text-xs text-muted-foreground">
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

      {card.chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('chipsLabel')}>
          {card.chips.map((key) => (
            <li
              key={key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <CheckIcon className="size-3 text-primary" />
              {t(`chips.${key}`)}
            </li>
          ))}
        </ul>
      )}

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
            className="w-full sm:w-auto"
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
              'inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary sm:w-auto',
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
              disabled
              aria-describedby={`${titleId}-down`}
              className="w-full sm:w-auto"
            >
              {t('cta.downgradeUnavailable')}
            </Button>
            <p id={`${titleId}-down`} className="mt-1 text-xs text-muted-foreground">
              {t('cta.downgradeHint')}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
