'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingOptionsResponse, CouponItem } from '@crm/contracts';
import {
  Alert,
  Input,
  MultiSelect,
  Select,
  Spinner,
  Textarea,
  ToastProvider,
  useToast,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, couponItemSchema, fetchCoupon, fetchOptions } from '../api';
import {
  buildCouponRequest,
  couponToDraft,
  newCouponDraft,
  type CouponDraft,
  type CouponField,
} from '../lib/coupon-draft';
import { cpnErrorKey } from '../lib/errors';
import { relativeTime } from '../lib/format';
import {
  Accent,
  ErrorBlock,
  HINT,
  INPUT,
  LABEL,
  LoadingBlock,
  PageHead,
  Problems,
  Section,
  StatusPill,
  SwitchRow,
} from './ui';

const NS = 'coupons-credits-referral-currency.coupons.editor';
const BASE = '/admin/coupons';
const FORM_ID = 'couponForm';

/** `/admin/coupons/new` and `/admin/coupons/:id/edit`: one page, two modes, as in WaDesk. */
export function CouponFormPage({ couponId }: { couponId?: string }) {
  const t = useTranslations('coupons-credits-referral-currency.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <CouponLoader couponId={couponId} />
    </ToastProvider>
  );
}

function CouponLoader({ couponId }: { couponId?: string }) {
  const options = useQuery({
    queryKey: KEYS.options,
    queryFn: ({ signal }) => fetchOptions(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const coupon = useQuery({
    queryKey: KEYS.coupon(couponId ?? 'new'),
    queryFn: ({ signal }) => fetchCoupon(couponId as string, signal),
    enabled: !!couponId,
    refetchOnWindowFocus: false,
  });
  if (options.isPending || (couponId && coupon.isPending)) return <LoadingBlock />;
  if (options.isError)
    return <ErrorBlock error={options.error} onRetry={() => void options.refetch()} />;
  if (coupon.isError)
    return <ErrorBlock error={coupon.error} onRetry={() => void coupon.refetch()} />;
  // keyed by the row version: after a save the form restarts from what the server stored
  return (
    <CouponForm
      key={coupon.data?.rowVersion ?? 'new'}
      coupon={coupon.data ?? null}
      options={options.data}
    />
  );
}

function CouponForm({
  coupon,
  options,
}: {
  coupon: CouponItem | null;
  options: BillingOptionsResponse;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('coupons-credits-referral-currency.errors');
  const tc = useTranslations('coupons-credits-referral-currency.common');
  const tl = useTranslations('coupons-credits-referral-currency.coupons');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [draft, setDraft] = useState<CouponDraft>(() =>
    coupon ? couponToDraft(coupon) : newCouponDraft(),
  );
  const [problems, setProblems] = useState<CouponField[]>([]);
  const set = <K extends keyof CouponDraft>(k: K, v: CouponDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: (body: object) =>
      coupon
        ? operatorFetch(`/coupons/${coupon.id}`, {
            method: 'PATCH',
            body: { ...body, rowVersion: coupon.rowVersion },
            schema: couponItemSchema,
          })
        : operatorFetch('/coupons', { method: 'POST', body, schema: couponItemSchema }),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: KEYS.coupons });
      if (coupon) {
        // WaDesk stays on the edit page and flashes "Coupon updated."
        qc.setQueryData(KEYS.coupon(coupon.id), saved);
        toast(tl('toasts.updated'));
      } else {
        router.push(`${BASE}?saved=created`);
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildCouponRequest(draft);
    if (!r.ok) {
      setProblems(r.problems);
      return;
    }
    setProblems([]);
    save.mutate(r.body);
  };

  // The plan picker lists active plans; a plan the coupon already names stays pickable even when it is inactive or gone.
  const planOptions = useMemo(() => {
    const known = new Map(options.plans.map((p) => [p.slug, p]));
    const rows = options.plans
      .filter((p) => p.isActive || draft.applicablePlans.includes(p.slug))
      .map((p) => ({ value: p.slug, label: p.name }));
    for (const slug of draft.applicablePlans) {
      if (!known.has(slug)) rows.push({ value: slug, label: slug });
    }
    return rows;
  }, [options.plans, draft.applicablePlans]);

  const currencyLabel = (c: BillingOptionsResponse['currencies'][number]) =>
    `${c.symbol ? `${c.symbol} ` : ''}${c.code}`;
  const currencyChoices =
    options.currencies.some((c) => c.code === draft.currencyCode) || draft.currencyCode === ''
      ? options.currencies
      : [
          { code: draft.currencyCode, symbol: null, name: null, precision: 2 },
          ...options.currencies,
        ];

  const serverProblems =
    save.isError &&
    save.error instanceof ApiError &&
    save.error.fieldErrors.length > 0 &&
    save.error.status === 422
      ? save.error.fieldErrors.map((f) => f.message)
      : [];
  const errorKey = save.isError ? cpnErrorKey(save.error) : null;
  const problemItems = problems.map((f) => t(`problems.${f}`));
  const submitLabel = coupon ? t('saveChanges') : t('create');
  const mono = 'font-mono';

  const actions = (
    <>
      {coupon && <StatusPill active={coupon.isActive} on={t('active')} off={t('disabled')} />}
      <Link
        href={BASE}
        className="inline-flex h-9 items-center rounded-full border border-border px-3.5 text-xs font-medium hover:bg-muted"
      >
        {t('cancel')}
      </Link>
      {canEdit && (
        <button
          type="submit"
          form={FORM_ID}
          disabled={save.isPending}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {save.isPending ? (
            <Spinner />
          ) : (
            <svg
              viewBox="0 0 16 16"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M2 8l5 5 7-9" />
            </svg>
          )}
          {save.isPending ? t('saving') : submitLabel}
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHead
        crumbs={[
          { label: tc('admin'), href: '/admin' },
          { label: tl('crumbHere'), href: BASE },
          { label: coupon ? coupon.code : t('crumbNew') },
        ]}
        eyebrow={coupon ? t('eyebrowEdit') : t('eyebrowNew')}
        mono={!!coupon}
        title={
          coupon ? (
            coupon.code
          ) : (
            <>
              {t('titleLead')} <Accent>{t('titleAccent')}</Accent>
            </>
          )
        }
        description={
          coupon
            ? `${t('redeemed', {
                used: new Intl.NumberFormat(locale).format(coupon.usesCount),
                max: coupon.maxUses
                  ? t('redeemedMax', { max: new Intl.NumberFormat(locale).format(coupon.maxUses) })
                  : '',
              })}${coupon.expiresAt ? ` · ${t('expires', { when: relativeTime(coupon.expiresAt, locale) })}` : ''}`
            : t('descriptionNew')
        }
        actions={actions}
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}
      <Problems title={t('problemsTitle')} items={problemItems} />
      {save.isError && problemItems.length === 0 && (
        <Alert tone="danger" className="space-y-1">
          <p className="font-semibold">{t('problemsTitle')}</p>
          {serverProblems.length > 0 ? (
            <ul className="list-disc ps-5">
              {serverProblems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : (
            <p>{te(errorKey ?? 'generic')}</p>
          )}
        </Alert>
      )}

      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        className="grid grid-cols-1 gap-5 xl:grid-cols-2"
      >
        <Section n="01" title={t('sections.identity')}>
          <div>
            <label className={LABEL} htmlFor="co-code">
              {t('fields.code')} <span className="text-danger">*</span>
            </label>
            <Input
              id="co-code"
              value={draft.code}
              maxLength={64}
              disabled={!canEdit}
              invalid={problems.includes('code')}
              onChange={(e) => set('code', e.target.value)}
              placeholder={t('fields.codePlaceholder')}
              className={`${INPUT} ${mono} uppercase`}
            />
            <p className={HINT}>{t('fields.codeHint')}</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="co-desc">
              {t('fields.description')}{' '}
              <span className="font-normal text-muted-foreground">
                {t('fields.descriptionNote')}
              </span>
            </label>
            <Textarea
              id="co-desc"
              rows={2}
              maxLength={255}
              disabled={!canEdit}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('fields.descriptionPlaceholder')}
              className="text-[12.5px]"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="co-note">
              {t('fields.adminNote')}{' '}
              <span className="font-normal text-muted-foreground">{t('fields.adminNoteNote')}</span>
            </label>
            <Textarea
              id="co-note"
              rows={2}
              maxLength={1000}
              disabled={!canEdit}
              value={draft.adminNote}
              onChange={(e) => set('adminNote', e.target.value)}
              placeholder={t('fields.adminNotePlaceholder')}
              className="text-[12.5px]"
            />
          </div>
          <SwitchRow
            title={t('fields.activeTitle')}
            hint={t('fields.activeHint')}
            checked={draft.isActive}
            onChange={(v) => set('isActive', v)}
            disabled={!canEdit}
          />
        </Section>

        <Section n="02" title={t('sections.discount')}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="co-type">
                {t('fields.type')} <span className="text-danger">*</span>
              </label>
              <Select
                id="co-type"
                value={draft.type}
                disabled={!canEdit}
                onChange={(e) => set('type', e.target.value as CouponDraft['type'])}
                className="h-auto py-2 text-[12.5px]"
              >
                <option value="percent">{t('fields.typePercent')}</option>
                <option value="fixed">{t('fields.typeFixed')}</option>
              </Select>
            </div>
            <div>
              <label className={LABEL} htmlFor="co-amount">
                {t('fields.amount')} <span className="text-danger">*</span>
              </label>
              <Input
                id="co-amount"
                inputMode="decimal"
                value={draft.amount}
                disabled={!canEdit}
                invalid={problems.includes('amount')}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="10"
                className={`${INPUT} ${mono}`}
              />
              <p className={HINT}>{t('fields.amountHint')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="co-max-discount">
                {t('fields.maxDiscount')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('fields.maxDiscountNote')}
                </span>
              </label>
              <Input
                id="co-max-discount"
                inputMode="decimal"
                value={draft.maxDiscountAmount}
                disabled={!canEdit}
                invalid={problems.includes('maxDiscountAmount')}
                onChange={(e) => set('maxDiscountAmount', e.target.value)}
                placeholder={t('fields.maxDiscountPlaceholder')}
                className={`${INPUT} ${mono}`}
              />
              <p className={HINT}>{t('fields.maxDiscountHint')}</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="co-currency">
                {t('fields.currency')}
              </label>
              <Select
                id="co-currency"
                value={draft.currencyCode}
                disabled={!canEdit}
                onChange={(e) => set('currencyCode', e.target.value)}
                className="h-auto py-2 text-[12.5px]"
              >
                <option value="">{t('fields.currencyAny')}</option>
                {currencyChoices.map((c) => (
                  <option key={c.code} value={c.code}>
                    {currencyLabel(c)}
                  </option>
                ))}
              </Select>
              <p className={HINT}>{t('fields.currencyHint')}</p>
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="co-min">
              {t('fields.minOrder')}
            </label>
            <Input
              id="co-min"
              inputMode="decimal"
              value={draft.minOrderAmount}
              disabled={!canEdit}
              invalid={problems.includes('minOrderAmount')}
              onChange={(e) => set('minOrderAmount', e.target.value)}
              placeholder={t('fields.minOrderPlaceholder')}
              className={`${INPUT} ${mono}`}
            />
          </div>
        </Section>

        <Section n="03" title={t('sections.eligibility')}>
          <div>
            <label className={LABEL} htmlFor="co-plans">
              {t('fields.plans')}{' '}
              <span className="font-normal text-muted-foreground">{t('fields.plansNote')}</span>
            </label>
            <MultiSelect
              id="co-plans"
              label={t('fields.plans')}
              options={planOptions}
              value={draft.applicablePlans}
              onChange={(v) => set('applicablePlans', v)}
              placeholder={t('fields.plansPlaceholder')}
              emptyLabel={t('fields.plansEmpty')}
              removeLabel={(name) => t('fields.plansRemove', { name })}
              clearLabel={t('fields.plansClear')}
              disabled={!canEdit}
            />
            <p className={HINT}>{t('fields.plansHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="co-start">
                {t('fields.startsAt')}
              </label>
              <Input
                id="co-start"
                type="datetime-local"
                value={draft.startsAt}
                disabled={!canEdit}
                invalid={problems.includes('startsAt')}
                onChange={(e) => set('startsAt', e.target.value)}
                className={`${INPUT} ${mono}`}
              />
              <p className={HINT}>{t('fields.startsAtHint')}</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="co-exp">
                {t('fields.expiresAt')}
              </label>
              <Input
                id="co-exp"
                type="datetime-local"
                value={draft.expiresAt}
                disabled={!canEdit}
                invalid={problems.includes('expiresAt')}
                onChange={(e) => set('expiresAt', e.target.value)}
                className={`${INPUT} ${mono}`}
              />
              <p className={HINT}>{t('fields.expiresAtHint')}</p>
            </div>
          </div>
        </Section>

        <Section n="04" title={t('sections.limits')}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="co-max-uses">
                {t('fields.maxUses')}
              </label>
              <Input
                id="co-max-uses"
                type="number"
                min={1}
                value={draft.maxUses}
                disabled={!canEdit}
                invalid={problems.includes('maxUses')}
                onChange={(e) => set('maxUses', e.target.value)}
                placeholder={t('fields.unlimitedPlaceholder')}
                className={`${INPUT} ${mono}`}
              />
              <p className={HINT}>{t('fields.maxUsesHint')}</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="co-per-user">
                {t('fields.perUser')}
              </label>
              <Input
                id="co-per-user"
                type="number"
                min={1}
                value={draft.perUserLimit}
                disabled={!canEdit}
                invalid={problems.includes('perUserLimit')}
                onChange={(e) => set('perUserLimit', e.target.value)}
                placeholder={t('fields.unlimitedPlaceholder')}
                className={`${INPUT} ${mono}`}
              />
              <p className={HINT}>{t('fields.perUserHint')}</p>
            </div>
          </div>
          <SwitchRow
            title={t('fields.firstPurchaseTitle')}
            hint={t('fields.firstPurchaseHint')}
            checked={draft.firstPurchaseOnly}
            onChange={(v) => set('firstPurchaseOnly', v)}
            disabled={!canEdit}
          />
          <SwitchRow
            title={t('fields.stackableTitle')}
            hint={t('fields.stackableHint')}
            checked={draft.stackableWithOther}
            onChange={(v) => set('stackableWithOther', v)}
            disabled={!canEdit}
          />
        </Section>

        <div className="flex justify-end gap-2 pt-1 xl:col-span-2">
          <Link
            href={BASE}
            className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[12.5px] font-medium hover:bg-muted"
          >
            {t('cancel')}
          </Link>
          {canEdit && (
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {save.isPending ? (
                <Spinner />
              ) : (
                <svg
                  viewBox="0 0 16 16"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M2 8l5 5 7-9" />
                </svg>
              )}
              {save.isPending ? t('saving') : submitLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
