'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { PaygwBilling, PaygwPeriod, PaygwQuote } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  checkoutKey,
  fetchPlanQuote,
  fetchWalletQuote,
  placePlanOrder,
  placeWalletOrder,
} from '../api';
import { formatMoney } from '../lib/money';
import { nextStep, type NextStep } from '../lib/next-action';
import { afterPaymentPath, safeReturnPath } from '../lib/return-path';
import { openCashfree, openPaddle, postForm } from '../lib/provider-widgets';
import { openRazorpay } from '../lib/razorpay';
import { BraintreeWidget, HyperpayWidget } from './card-widgets';
import { OfflineInstructions } from './offline-instructions';

const NS = 'platform-payment-gateways.checkout';

export type CheckoutTarget = { kind: 'plan'; planSlug: string } | { kind: 'wallet' };

const EMPTY: Record<keyof PaygwBilling, string> = {
  customerName: '',
  customerEmail: '',
  company: '',
  address: '',
  city: '',
  postal: '',
  country: '',
  taxId: '',
};

/** Checkout for a plan or a wallet top-up: the server prices, the buyer picks a gateway, the API says what happens next. */
export function CheckoutPage({ target }: { target: CheckoutTarget }) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();

  const [currency, setCurrency] = useState<string | undefined>(
    params.get('currency')?.toUpperCase() ?? undefined,
  );
  const [period, setPeriod] = useState<PaygwPeriod | undefined>(
    params.get('period') === 'yearly' ? 'yearly' : undefined,
  );
  const [billing, setBilling] = useState(EMPTY);
  const [gatewayId, setGatewayId] = useState<string | null>(null);
  // A coupon is typed, then applied: the server prices it (preview), and it is judged again when the order is placed.
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [autoRenew, setAutoRenew] = useState(false);
  const [cardWidget, setCardWidget] = useState<{
    kind: 'hyperpay' | 'braintree';
    params: Record<string, string | number | boolean>;
  } | null>(null);
  const [offline, setOffline] = useState<{
    step: Extract<NextStep, { kind: 'instructions' }>;
    orderNumber: string;
    orderId: string;
  } | null>(null);
  const amount = params.get('amount') ?? '';
  // One key per distinct submission: a retry of the same form replays the order instead of creating a second one.
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  const quote = useQuery<PaygwQuote>({
    queryKey: checkoutKey(
      target.kind,
      target.kind === 'plan' ? target.planSlug : amount,
      currency,
      period,
      coupon,
    ),
    queryFn: ({ signal }) =>
      target.kind === 'plan'
        ? fetchPlanQuote(target.planSlug, { currency, period, coupon }, signal)
        : fetchWalletQuote({ currency, amount }, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const q = quote.data;
  const selected = useMemo(() => {
    if (!q) return null;
    return q.gateways.find((g) => g.id === gatewayId) ?? q.gateways[0] ?? null;
  }, [q, gatewayId]);

  const explain = (e: unknown): string => {
    if (e instanceof ApiError) {
      const known: Record<string, string> = {
        PAYGW_GATEWAY_UNAVAILABLE: 'gatewayUnavailable',
        PAYGW_CURRENCY_UNSUPPORTED: 'currencyUnsupported',
        PAYGW_PROVIDER_ERROR: 'providerError',
        PAYGW_PLAN_NOT_PURCHASABLE: 'notPurchasable',
        PAYGW_DOWNGRADE_NOT_ALLOWED: 'downgrade',
        PAYGW_AMOUNT_TOO_LOW: 'amountTooLow',
        PAYGW_COUPON_UNAVAILABLE: 'couponUnavailable',
        PAYGW_COUPON_REJECTED: 'couponRejected',
        FORBIDDEN: 'forbidden',
        NOT_FOUND: 'notFound',
      };
      // A refused coupon says why (expired, used up, wrong plan...): that sentence is the useful part.
      if (e.code === 'PAYGW_COUPON_REJECTED' && e.message) return e.message;
      const key = known[e.code];
      if (key) return te(key);
    }
    return te('generic');
  };

  const pay = useMutation({
    mutationFn: async () => {
      if (!selected || !q) throw new Error('no gateway');
      const couponToSend = q.coupon?.ok ? q.coupon.code : undefined;
      const payload = Object.fromEntries(
        Object.entries(billing).filter(([, v]) => v.trim() !== ''),
      ) as PaygwBilling;
      const sig = JSON.stringify([
        target,
        selected.id,
        q.currency,
        q.billingPeriod,
        amount,
        payload,
        couponToSend,
        selected.autoRenew && autoRenew,
      ]);
      if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() };
      const key = attempt.current.key;
      return target.kind === 'plan'
        ? placePlanOrder(
            target.planSlug,
            {
              gatewayId: selected.id,
              currency: q.currency,
              period: q.billingPeriod,
              coupon: couponToSend,
              autoRenew: selected.autoRenew && autoRenew ? true : undefined,
              billing: payload,
            },
            key,
          )
        : placeWalletOrder(
            { gatewayId: selected.id, amount, currency: q.currency, billing: payload },
            key,
          );
    },
    onSuccess: async (res) => {
      setProblem(null);
      const step = nextStep(res);
      if (step.kind === 'navigate') {
        setLaunching(true);
        window.location.assign(step.url);
      } else if (step.kind === 'instructions') {
        setOffline({ step, orderNumber: res.orderNumber, orderId: res.orderId });
      } else if (step.kind === 'form_post') {
        setLaunching(true);
        postForm(step.url, step.fields);
      } else if (step.kind === 'hyperpay' || step.kind === 'braintree') {
        setCardWidget({ kind: step.kind, params: step.params });
      } else if (step.kind === 'paddle' || step.kind === 'cashfree') {
        setLaunching(true);
        try {
          await (step.kind === 'paddle' ? openPaddle(step.params) : openCashfree(step.params));
        } catch {
          setLaunching(false);
          setProblem(te('widgetBlocked'));
        }
      } else if (step.kind === 'razorpay') {
        setLaunching(true);
        try {
          await openRazorpay(step.options, step.returnUrl);
        } catch {
          setLaunching(false);
          setProblem(te('widgetBlocked'));
        }
      } else {
        router.push(
          afterPaymentPath('success', res.orderNumber, safeReturnPath(params.get('return'))),
        );
      }
    },
    onError: (e) => setProblem(explain(e)),
  });

  const set = (k: keyof PaygwBilling) => (e: { target: { value: string } }) =>
    setBilling((b) => ({ ...b, [k]: e.target.value }));
  const money = (v: string) => (q ? formatMoney(v, q.currency, locale) : v);
  const title = target.kind === 'plan' ? t('title') : t('walletTitle');

  if (quote.isError && !q) {
    return <Alert tone="danger">{explain(quote.error)}</Alert>;
  }
  if (cardWidget) {
    return cardWidget.kind === 'hyperpay' ? (
      <HyperpayWidget params={cardWidget.params} />
    ) : (
      <BraintreeWidget params={cardWidget.params} />
    );
  }
  if (offline) {
    return (
      <OfflineInstructions
        step={offline.step}
        orderNumber={offline.orderNumber}
        orderId={offline.orderId}
      />
    );
  }
  if (!q) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <Spinner label={t('loading')} />
        <span className="ms-2 text-sm">{t('loading')}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-4 lg:grid-cols-[1fr_20rem]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (selected) pay.mutate();
        }}
      >
        <header className="space-y-2">
          <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Step n={1} tone="done" label={t('steps.plan')} />
            <Step n={2} tone="current" label={t('steps.checkout')} />
            <Step n={3} tone="todo" label={t('steps.confirmation')} />
          </ol>
          <h1 className="text-3xl font-semibold tracking-tight">
            {target.kind === 'plan' ? (
              <>
                {t('titleFirst')}{' '}
                <em className="font-semibold italic text-primary">{t('titleSecond')}</em>
              </>
            ) : (
              title
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {q.refund.enabled && q.refund.days > 0
              ? t('subtitleRefund', { days: q.refund.days })
              : t('subtitle')}
          </p>
        </header>
        {problem && <Alert tone="danger">{problem}</Alert>}

        <Card className="space-y-4 p-4">
          <StepHeading n={1} title={t('account')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('name')} htmlFor="co-name">
              <Input
                id="co-name"
                autoComplete="name"
                value={billing.customerName}
                onChange={set('customerName')}
              />
            </Field>
            <Field label={t('email')} htmlFor="co-email">
              <Input
                id="co-email"
                type="email"
                autoComplete="email"
                value={billing.customerEmail}
                onChange={set('customerEmail')}
              />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <StepHeading n={2} title={t('billingAddress')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('company')} htmlFor="co-company">
              <Input
                id="co-company"
                autoComplete="organization"
                value={billing.company}
                onChange={set('company')}
              />
            </Field>
            <Field label={t('address')} htmlFor="co-address" className="sm:col-span-2">
              <Input
                id="co-address"
                placeholder={t('addressPlaceholder')}
                autoComplete="street-address"
                value={billing.address}
                onChange={set('address')}
              />
            </Field>
            <Field label={t('city')} htmlFor="co-city">
              <Input
                id="co-city"
                placeholder={t('cityPlaceholder')}
                autoComplete="address-level2"
                value={billing.city}
                onChange={set('city')}
              />
            </Field>
            <Field label={t('postal')} htmlFor="co-postal">
              <Input
                id="co-postal"
                placeholder="400001"
                autoComplete="postal-code"
                value={billing.postal}
                onChange={set('postal')}
              />
            </Field>
            <Field label={t('country')} htmlFor="co-country">
              <Select
                id="co-country"
                autoComplete="country-name"
                value={billing.country}
                onChange={set('country')}
              >
                <option value="">{t('countryPlaceholder')}</option>
                {q.countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('taxId')} htmlFor="co-tax">
              <Input
                id="co-tax"
                className="font-mono"
                placeholder={t('taxIdPlaceholder')}
                value={billing.taxId}
                onChange={set('taxId')}
              />
            </Field>
          </div>
        </Card>

        {q.availableCurrencies.length > 1 && (
          <Card className="space-y-2 p-4">
            <p className="text-sm font-medium">{t('currencyTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('currencyHint')}</p>
            <Field label={t('currency')} htmlFor="co-currency">
              <Select
                id="co-currency"
                value={q.currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {q.availableCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>
        )}

        {q.periods.length > 1 && (
          <Card className="space-y-2 p-4">
            <Field label={t('period')} htmlFor="co-period">
              <Select
                id="co-period"
                value={q.billingPeriod}
                onChange={(e) => setPeriod(e.target.value as PaygwPeriod)}
              >
                {q.periods.map((p) => (
                  <option key={p} value={p}>
                    {t(`periods.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>
        )}

        {target.kind === 'plan' && (
          <Card className="space-y-2 p-4">
            <Field label={t('coupon')} htmlFor="co-coupon">
              <div className="flex gap-2">
                <Input
                  id="co-coupon"
                  className="font-mono uppercase tracking-wider"
                  placeholder={t('couponPlaceholder')}
                  autoComplete="off"
                  maxLength={64}
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter applies the coupon; it must not place the order.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setCoupon(couponInput.trim() || undefined);
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => setCoupon(couponInput.trim() || undefined)}
                  disabled={quote.isFetching}
                >
                  {t('couponApply')}
                </Button>
                {coupon && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCoupon(undefined);
                      setCouponInput('');
                    }}
                  >
                    {t('couponRemove')}
                  </Button>
                )}
              </div>
            </Field>
            {q.coupon && (
              <p
                role="status"
                className={`text-xs ${q.coupon.ok ? 'text-success' : 'text-danger'}`}
              >
                {q.coupon.ok
                  ? t('couponApplied', { code: q.coupon.code, amount: money(q.coupon.discount) })
                  : q.coupon.message}
              </p>
            )}
          </Card>
        )}

        <Card className="space-y-3 p-4">
          <StepHeading n={3} title={t('paymentMethod')} />
          {q.gateways.length === 0 ? (
            <Alert tone="warning">{t('noGateway', { currency: q.currency })}</Alert>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">{t('paymentMethod')}</legend>
              {q.gateways.map((g) => (
                <label
                  key={g.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected?.id === g.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <input
                    type="radio"
                    name="gateway"
                    className="mt-1"
                    checked={selected?.id === g.id}
                    onChange={() => setGatewayId(g.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{g.name}</span>
                    <span className="block text-xs text-muted-foreground">{g.description}</span>
                  </span>
                  <span
                    className={`ms-auto rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${g.mode === 'live' ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning'}`}
                  >
                    {g.mode === 'live' ? t('live') : t('sandbox')}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {q.gateways.length > 0 && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('tlsNote')}
            </p>
          )}
          {selected?.mode === 'sandbox' && (
            <Alert tone="warning" data-testid="checkout-sandbox-note">
              {t('sandboxNote')}
            </Alert>
          )}
          {selected?.autoRenew && q.kind === 'addon' && (
            <p className="text-sm text-muted-foreground" data-testid="addon-renews">
              {t('addonRenews')}
            </p>
          )}
          {selected?.autoRenew && q.kind !== 'addon' && (
            <Checkbox
              id="co-autorenew"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              label={
                <span>
                  <span className="block text-sm font-semibold">{t('autoRenewTitle')}</span>
                  <span className="block text-xs text-muted-foreground">{t('autoRenew')}</span>
                </span>
              }
            />
          )}
        </Card>

        <Button type="submit" className="w-full" disabled={!selected || pay.isPending || launching}>
          {!selected
            ? t('noGatewayButton')
            : pay.isPending || launching
              ? t('processing')
              : t('pay', { amount: money(q.total) })}
        </Button>
      </form>

      <aside
        className="h-fit space-y-3 rounded-md border border-border p-4 lg:sticky lg:top-4"
        aria-label={t('summary')}
      >
        <h2 className="font-medium">{t('summary')}</h2>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{q.itemName}</p>
            {q.itemSubtitle && <p className="text-xs text-muted-foreground">{q.itemSubtitle}</p>}
            {q.kind === 'plan' && (
              <p className="text-xs text-muted-foreground">{t(`billed.${q.billingPeriod}`)}</p>
            )}
          </div>
          <Link
            href={q.kind === 'plan' ? '/account/plans' : '/billing/wallet'}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {t('change')}
          </Link>
        </div>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt>{t('subtotal')}</dt>
            <dd className="tabular-nums">{money(q.subtotal)}</dd>
          </div>
          {Number(q.discount) > 0 && (
            <div className="flex justify-between text-success">
              <dt>{t('couponDiscount', { code: q.coupon?.code ?? '' })}</dt>
              <dd className="tabular-nums">-{money(q.discount)}</dd>
            </div>
          )}
          {Number(q.tax) > 0 && (
            <div className="flex justify-between">
              <dt>{t('tax', { label: q.taxLabel, rate: q.taxRate })}</dt>
              <dd className="tabular-nums">{money(q.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <dt>{t('total')}</dt>
            <dd className="text-2xl tabular-nums" data-testid="checkout-total">
              {money(q.total)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {t.rich('terms', {
            terms: (c) => (
              <Link
                href="/legal/terms"
                target="_blank"
                className="font-semibold text-primary hover:underline"
              >
                {c}
              </Link>
            ),
            privacy: (c) => (
              <Link
                href="/legal/privacy"
                target="_blank"
                className="font-semibold text-primary hover:underline"
              >
                {c}
              </Link>
            ),
          })}
        </p>
        {q.refund.enabled && q.refund.days > 0 && (
          <div className="rounded-md bg-success/10 p-3 text-xs text-foreground">
            <p className="font-semibold text-success">
              {t('refundGuarantee', { days: q.refund.days })}
            </p>
            <p className="mt-1">{t('refundNote', { days: q.refund.days })}</p>
          </div>
        )}
        {quote.isFetching && <p className="text-xs text-muted-foreground">{t('updating')}</p>}
      </aside>
    </div>
  );
}

function Step({ n, label, tone }: { n: number; label: string; tone: 'done' | 'current' | 'todo' }) {
  const dot =
    tone === 'done'
      ? 'bg-primary text-primary-foreground'
      : tone === 'current'
        ? 'bg-foreground text-background'
        : 'bg-muted text-muted-foreground';
  return (
    <li
      className="flex items-center gap-1.5"
      aria-current={tone === 'current' ? 'step' : undefined}
    >
      <span className={`grid size-5 place-items-center rounded-full text-[10px] ${dot}`}>{n}</span>
      <span className={tone === 'current' ? 'font-medium text-foreground' : ''}>{label}</span>
    </li>
  );
}

function StepHeading({ n, title }: { n: number; title: string }) {
  const t = useTranslations(NS);
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {t('step', { n })}
      </p>
      <h2 className="font-medium">{title}</h2>
    </div>
  );
}
