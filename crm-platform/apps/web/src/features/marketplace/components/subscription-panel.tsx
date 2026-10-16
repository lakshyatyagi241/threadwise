'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { MarketCardPricing, MarketSubscription } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import { subscriptionView, type SubscriptionPause } from '../lib/pricing';
import { NotForSaleNote, SubscribePanel } from './pricing-parts';
import { ErrorLine, NeedsPermission, Section } from './ui';
import { useSubscribe, useSubscriptionChange } from './use-subscription-actions';

/**
 * Everything a workspace can do about the subscription of one paid app: see its state and the date it is paid until, be told when the
 * price changed, stop renewal (after a confirmation that says what happens), take that back, and pay again (Renew now, Resubscribe).
 * The buttons shown come from the API's own `actions`; the person's permission only decides whether they are offered at all.
 */
export function SubscriptionPanel({
  app,
  subscription,
  canAct,
}: {
  app: { slug: string; name: string };
  subscription: MarketSubscription;
  /** The person holds `market.apps.install`, which cancel, resume and subscribe all need. */
  canAct: boolean;
}) {
  const t = useTranslations('marketplace.subscription');
  const f = useFormatter();
  const locale = useLocale();
  const { toast } = useToast();
  const view = subscriptionView(subscription, locale);
  const change = useSubscriptionChange(app);
  const pay = useSubscribe(app);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const date = view.date.iso ? f.dateTime(new Date(view.date.iso), { dateStyle: 'medium' }) : null;
  const busy = change.cancel.pending || change.resume.pending || pay.pending;

  const doCancel = async () => {
    const next = await change.cancel.run();
    // A refused cancellation leaves the dialog open with the reason in it; the person closes it when they have read it.
    if (!next) return;
    setConfirmCancel(false);
    toast(date ? t('toast.canceled', { date }) : t('toast.canceledNoDate'));
  };
  const doResume = async () => {
    const next = await change.resume.run();
    if (next) toast(t('toast.resumed'));
  };

  const anyAction = view.actions.cancel || view.actions.resume || view.actions.renew !== null;
  return (
    <Section title={t('title')} id="subscription">
      <div data-testid="subscription-panel" data-status={view.status} className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={view.tone}>{t(`status.${view.status}`)}</Badge>
          {view.date.kind !== 'none' && (
            <span data-testid="subscription-date">
              {t(`date.${view.date.kind}`, { date: date ?? '' })}
            </span>
          )}
        </div>
        {view.lastPayment && (
          <p className="text-muted-foreground">
            {t(view.period === 'yearly' ? 'lastPaymentYear' : 'lastPayment', {
              price: view.lastPayment,
            })}
          </p>
        )}
        {view.priceLocked && view.lastPayment && (
          <p className="text-muted-foreground" data-testid="price-locked">
            {t(view.period === 'yearly' ? 'priceLockedYear' : 'priceLocked', {
              price: view.lastPayment,
            })}
          </p>
        )}
        {view.paymentFailed && (
          <Alert tone="warning" data-testid="payment-failed">
            {date ? t('paymentFailed', { date }) : t('paymentFailedNoDate')}
          </Alert>
        )}
        {view.nextPayment && (
          <Alert tone="info" data-testid="price-change">
            {t(view.period === 'yearly' ? 'nextPaymentYear' : 'nextPayment', {
              price: view.nextPayment,
            })}
          </Alert>
        )}
        {view.comp && <p className="text-muted-foreground">{t('compNote')}</p>}
        {view.cannotRenew && <NotForSaleNote />}
        {view.autoRenew && (
          <p className="text-muted-foreground" data-testid="auto-renew-hint">
            {t('autoRenewHint')}
          </p>
        )}
        {view.actions.renew !== null && view.status !== 'ended' && !view.autoRenew && (
          <p className="text-muted-foreground">{t('renewHint')}</p>
        )}

        {change.resume.error ? <ErrorLine error={change.resume.error} /> : null}
        {pay.error ? <ErrorLine error={pay.error} /> : null}
        {pay.noCheckout && (
          <Alert tone="danger" data-testid="no-checkout">
            {t('noCheckout')}
          </Alert>
        )}

        {anyAction &&
          (canAct ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="subscription-actions">
              {view.actions.renew !== null && (
                <Button onClick={() => void pay.run(false)} disabled={busy}>
                  {pay.pending && <Spinner />}
                  {t(`actions.${view.actions.renew}`)}
                </Button>
              )}
              {view.actions.resume && (
                <Button variant="secondary" onClick={() => void doResume()} disabled={busy}>
                  {change.resume.pending && <Spinner />}
                  {t('actions.resume')}
                </Button>
              )}
              {view.actions.cancel && (
                <Button variant="secondary" onClick={() => setConfirmCancel(true)} disabled={busy}>
                  {t('actions.cancel')}
                </Button>
              )}
            </div>
          ) : (
            <NeedsPermission permission="market.apps.install" />
          ))}
        <p aria-live="polite" className="sr-only">
          {busy ? t('working') : ''}
        </p>
      </div>

      {canAct && view.actions.cancel && (
        <ConfirmDialog
          open={confirmCancel}
          title={t('cancelConfirm.title', { name: app.name })}
          message={
            <div className="space-y-2">
              <p>
                {view.autoRenew
                  ? date
                    ? t('cancelConfirm.messageAuto', { name: app.name, date })
                    : t('cancelConfirm.messageAutoNoDate', { name: app.name })
                  : date
                    ? t('cancelConfirm.message', { name: app.name, date })
                    : t('cancelConfirm.messageNoDate', { name: app.name })}
              </p>
              <p>{t('cancelConfirm.afterwards')}</p>
              {change.cancel.error ? <ErrorLine error={change.cancel.error} /> : null}
            </div>
          }
          confirmLabel={t('cancelConfirm.confirm')}
          cancelLabel={t('cancelConfirm.keep')}
          tone="danger"
          busy={change.cancel.pending}
          onConfirm={() => void doCancel()}
          onClose={() => {
            setConfirmCancel(false);
            change.cancel.clear();
          }}
        />
      )}
    </Section>
  );
}

/**
 * The prominent banner of an installation that its subscription ended and paused. Its data and settings are kept. What it offers
 * follows from what the workspace can do now: pay again (Resubscribe, which switches the app back on), nothing (no longer sold), or
 * Resume (the plan includes the app now).
 */
export function SubscriptionEndedBanner({
  app,
  pause,
  canResubscribe,
  canResume,
  onResume,
  resuming,
}: {
  app: { slug: string; name: string };
  pause: SubscriptionPause;
  canResubscribe: boolean;
  /** The ordinary Resume works (only for `resumable`). */
  canResume: boolean;
  onResume: () => void;
  resuming: boolean;
}) {
  const t = useTranslations('marketplace.manage.subscriptionEnded');
  const pay = useSubscribe(app);
  return (
    <Alert tone="warning" data-testid="subscription-ended-banner" data-pause={pause.kind}>
      <p className="font-medium">{t('title')}</p>
      <p>{t(`message.${pause.kind}`, { name: app.name })}</p>
      {pause.kind === 'resubscribe' &&
        (canResubscribe ? (
          <div className="mt-2 space-y-2">
            <Button onClick={() => void pay.run(false)} disabled={pay.pending}>
              {pay.pending && <Spinner />}
              {t('resubscribe')}
            </Button>
            {pay.error ? <ErrorLine error={pay.error} /> : null}
            {pay.noCheckout && <p role="alert">{t('noCheckout')}</p>}
          </div>
        ) : (
          <div className="mt-2">
            <NeedsPermission permission="market.apps.install" />
          </div>
        ))}
      {pause.kind === 'resumable' && canResume && (
        <Button className="mt-2" onClick={onResume} disabled={resuming}>
          {resuming && <Spinner />}
          {t('resume')}
        </Button>
      )}
    </Alert>
  );
}

/** The subscription section of the manage page, by what applies: the panel, the offer to subscribe, or a note. */
export function SubscriptionSectionView({
  section,
  app,
  subscription,
  pricing,
  canAct,
}: {
  section: 'panel' | 'subscribe' | 'included' | 'notForSale';
  app: { slug: string; name: string };
  subscription: MarketSubscription | null;
  pricing: MarketCardPricing;
  canAct: boolean;
}) {
  const t = useTranslations('marketplace.manage.subscription');
  if (section === 'panel' && subscription)
    return <SubscriptionPanel app={app} subscription={subscription} canAct={canAct} />;
  if (section === 'subscribe') {
    return canAct ? (
      <SubscribePanel
        app={{ ...app, pricing }}
        title={t('subscribeTitle', { name: app.name })}
        description={t('subscribeIntro')}
      />
    ) : (
      <Section title={t('subscribeTitle', { name: app.name })} description={t('subscribeIntro')}>
        <NeedsPermission permission="market.apps.install" />
      </Section>
    );
  }
  if (section === 'included') {
    return (
      <Section title={t('title')}>
        <p className="text-sm text-muted-foreground" data-testid="included-note">
          {t('included')}
        </p>
      </Section>
    );
  }
  if (section === 'notForSale') {
    return (
      <Section title={t('title')}>
        <NotForSaleNote />
      </Section>
    );
  }
  return null;
}
