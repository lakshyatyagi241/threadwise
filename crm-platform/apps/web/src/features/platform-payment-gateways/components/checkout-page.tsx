'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { ApplyCouponResponse, PaygwBilling, PaygwPeriod, PaygwQuote } from '@crm/contracts';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  ToastProvider,
  useToast,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  applyPlanCoupon,
  checkoutKey,
  fetchPlanQuote,
  fetchWalletQuote,
  placePlanOrder,
  placeWalletOrder,
} from '../api';
import { couponFailureOf, interpretApply, isCouponRejected, summaryView } from '../lib/coupon';
import { formatMoney } from '../lib/money';
import { nextStep } from '../lib/next-action';
import { openRazorpay } from '../lib/razorpay';
import { CouponCard } from './coupon-card';

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
  return (
    <ToastProvider>
      <CheckoutPageInner target={target} />
    </ToastProvider>
  );
}

function CheckoutPageInner({ target }: { target: CheckoutTarget }) {
  const t = useTranslations(NS);
  const tcp = useTranslations(`${NS}.coupon`);
  const te = useTranslations(`${NS}.errors`);
  const { toast } = useToast();
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
  const [problem, setProblem] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  // TW-CPN-007: the coupon check for plan checkout. The response carries the server-computed summary; the browser never
  // recomputes tax. Any change of currency or period drops the code and the discount (a result in flight is ignored).
  const [couponInput, setCouponInput] = useState('');
  const [applied, setApplied] = useState<ApplyCouponResponse | null>(null);
  const couponEpoch = useRef(0);
  const resetCoupon = () => {
    couponEpoch.current += 1;
    setCouponInput('');
    setApplied(null);
  };
  const amount = params.get('amount') ?? '';
  // One key per distinct submission: a retry of the same form replays the order instead of creating a second one.
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  const quote = useQuery<PaygwQuote>({
    queryKey: checkoutKey(
      target.kind,
      target.kind === 'plan' ? target.planSlug : amount,
      currency,
      period,
    ),
    queryFn: ({ signal }) =>
      target.kind === 'plan'
        ? fetchPlanQuote(target.planSlug, { currency, period }, signal)
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

  const applyCoupon = useMutation({
    mutationFn: async (v: { code: string; currency: string; period: PaygwPeriod }) => {
      if (target.kind !== 'plan') throw new Error('plan only');
      return { epoch: couponEpoch.current, res: await applyPlanCoupon(target.planSlug, v) };
    },
    onSuccess: ({ epoch, res }) => {
      if (epoch !== couponEpoch.current) return;
      const check = interpretApply(res);
      if (check.kind === 'applied') {
        setApplied(check.response);
        setCouponInput(check.response.code ?? couponInput);
        toast(check.response.message || tcp('applied'), 'success');
      } else {
        setApplied(null);
        toast(check.message, 'danger');
      }
    },
    onError: (e) => {
      setApplied(null);
      toast(couponFailureOf(e) === 'throttled' ? tcp('throttled') : tcp('networkError'), 'danger');
    },
  });
  const submitCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!q || target.kind !== 'plan' || applyCoupon.isPending) return;
    if (!code) {
      setApplied(null);
      toast(tcp('enterCode'), 'danger');
      return;
    }
    applyCoupon.mutate({ code, currency: q.currency, period: q.billingPeriod });
  };

  const explain = (e: unknown): string => {
    if (e instanceof ApiError) {
      const known: Record<string, string> = {
        PAYGW_GATEWAY_UNAVAILABLE: 'gatewayUnavailable',
        PAYGW_CURRENCY_UNSUPPORTED: 'currencyUnsupported',
        PAYGW_PROVIDER_ERROR: 'providerError',
        PAYGW_PLAN_NOT_PURCHASABLE: 'notPurchasable',
        PAYGW_DOWNGRADE_NOT_ALLOWED: 'downgrade',
        PAYGW_AMOUNT_TOO_LOW: 'amountTooLow',
        FORBIDDEN: 'forbidden',
        NOT_FOUND: 'notFound',
      };
      const key = known[e.code];
      if (key) return te(key);
    }
    return te('generic');
  };

  const pay = useMutation({
    mutationFn: async () => {
      if (!selected || !q) throw new Error('no gateway');
      const couponCode = target.kind === 'plan' ? summaryView(q, applied).couponCode : null;
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
        couponCode,
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
              billing: payload,
              ...(couponCode ? { coupon: couponCode } : {}),
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
      } else if (step.kind === 'razorpay') {
        setLaunching(true);
        try {
          await openRazorpay(step.options, step.returnUrl);
        } catch {
          setLaunching(false);
          setProblem(te('widgetBlocked'));
        }
      } else {
        router.push(`/billing/orders?payment=success&order=${encodeURIComponent(res.orderNumber)}`);
      }
    },
    onError: (e) => {
      if (isCouponRejected(e)) {
        // The order was NOT created: say why, and drop the discount so the summary is honest again.
        setApplied(null);
        setProblem(e.message || te('couponRejected'));
      } else setProblem(explain(e));
    },
  });

  const set = (k: keyof PaygwBilling) => (e: { target: { value: string } }) =>
    setBilling((b) => ({ ...b, [k]: e.target.value }));
  const money = (v: string) => (q ? formatMoney(v, q.currency, locale) : v);
  const view = q ? summaryView(q, applied) : null;
  const title = target.kind === 'plan' ? t('title') : t('walletTitle');

  if (quote.isError && !q) {
    return <Alert tone="danger">{explain(quote.error)}</Alert>;
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
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>
        {problem && <Alert tone="danger">{problem}</Alert>}

        <Card className="space-y-4 p-4">
          <h2 className="font-medium">{t('account')}</h2>
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
          <h2 className="font-medium">{t('billingAddress')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('company')} htmlFor="co-company">
              <Input
                id="co-company"
                autoComplete="organization"
                value={billing.company}
                onChange={set('company')}
              />
            </Field>
            <Field label={t('taxId')} htmlFor="co-tax" hint={t('taxIdHint')}>
              <Input id="co-tax" value={billing.taxId} onChange={set('taxId')} />
            </Field>
            <Field label={t('address')} htmlFor="co-address" className="sm:col-span-2">
              <Input
                id="co-address"
                autoComplete="street-address"
                value={billing.address}
                onChange={set('address')}
              />
            </Field>
            <Field label={t('city')} htmlFor="co-city">
              <Input
                id="co-city"
                autoComplete="address-level2"
                value={billing.city}
                onChange={set('city')}
              />
            </Field>
            <Field label={t('postal')} htmlFor="co-postal">
              <Input
                id="co-postal"
                autoComplete="postal-code"
                value={billing.postal}
                onChange={set('postal')}
              />
            </Field>
            <Field label={t('country')} htmlFor="co-country">
              <Input
                id="co-country"
                autoComplete="country-name"
                value={billing.country}
                onChange={set('country')}
              />
            </Field>
          </div>
        </Card>

        {q.availableCurrencies.length > 1 && (
          <Card className="space-y-2 p-4">
            <Field label={t('currency')} htmlFor="co-currency">
              <Select
                id="co-currency"
                value={q.currency}
                onChange={(e) => {
                  resetCoupon();
                  setCurrency(e.target.value);
                }}
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
                onChange={(e) => {
                  resetCoupon();
                  setPeriod(e.target.value as PaygwPeriod);
                }}
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
          <CouponCard
            value={couponInput}
            onChange={setCouponInput}
            onApply={submitCoupon}
            busy={applyCoupon.isPending}
          />
        )}

        <Card className="space-y-3 p-4">
          <h2 className="font-medium">{t('paymentMethod')}</h2>
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
                    <span className="block text-xs text-muted-foreground">
                      {g.description}
                      {g.mode === 'sandbox' && ` · ${t('sandbox')}`}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </Card>

        <Button type="submit" className="w-full" disabled={!selected || pay.isPending || launching}>
          {!selected
            ? t('noGatewayButton')
            : pay.isPending || launching
              ? t('processing')
              : t('pay', { amount: money(view!.total) })}
        </Button>
      </form>

      <aside
        className="h-fit space-y-3 rounded-md border border-border p-4 lg:sticky lg:top-4"
        aria-label={t('summary')}
      >
        <h2 className="font-medium">{t('summary')}</h2>
        <div>
          <p className="font-medium">{q.itemName}</p>
          {q.itemSubtitle && <p className="text-xs text-muted-foreground">{q.itemSubtitle}</p>}
          {q.kind === 'plan' && (
            <p className="text-xs text-muted-foreground">{t(`billed.${q.billingPeriod}`)}</p>
          )}
        </div>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt>{t('subtotal')}</dt>
            <dd className="tabular-nums">{money(view!.subtotal)}</dd>
          </div>
          {view!.couponCode && view!.discount !== null && (
            <div className="flex justify-between text-success" data-testid="checkout-discount">
              <dt>{tcp('discountRow', { code: view!.couponCode })}</dt>
              <dd className="tabular-nums">−{money(view!.discount)}</dd>
            </div>
          )}
          {Number(view!.tax) > 0 && (
            <div className="flex justify-between">
              <dt>{t('tax', { label: q.taxLabel, rate: q.taxRate })}</dt>
              <dd className="tabular-nums">{money(view!.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <dt>{t('total')}</dt>
            <dd className="tabular-nums" data-testid="checkout-total">
              {money(view!.total)}
            </dd>
          </div>
        </dl>
        {quote.isFetching && <p className="text-xs text-muted-foreground">{t('updating')}</p>}
      </aside>
    </div>
  );
}
