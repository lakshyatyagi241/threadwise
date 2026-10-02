'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Coupon, CouponOptionsResponse } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { COUPON_KEYS, couponApi } from '../api';
import { couponErrorKind } from '../lib/errors';
import {
  checkCoupon,
  couponSubmitError,
  emptyCouponDraft,
  toCouponDraft,
  type CouponDraft,
  type CouponProblems,
  type FormField,
} from '../lib/form';
import { relativeTo } from '../lib/list';
import { PlanPicker } from './plan-picker';
import { Breadcrumb, ErrorState, LoadingBlock, NS, useCanWrite } from './parts';

/** TW-CPN-002 (new, no id) and TW-CPN-003 (edit, with its id): the same four-section form. */
export function CouponFormPage({ id }: { id?: string }) {
  const t = useTranslations(`${NS}.form`);
  const tc = useTranslations(`${NS}.common`);
  const canWrite = useCanWrite();
  const options = useQuery({
    queryKey: COUPON_KEYS.options,
    queryFn: ({ signal }) => couponApi.options(signal),
    refetchOnWindowFocus: false,
    enabled: canWrite,
  });
  const coupon = useQuery({
    queryKey: COUPON_KEYS.one(id ?? ''),
    queryFn: ({ signal }) => couponApi.get(id!, signal),
    refetchOnWindowFocus: false,
    enabled: canWrite && Boolean(id),
    retry: false,
  });

  const crumbs = [
    { label: tc('crumb'), href: '/admin/coupons' },
    { label: id ? (coupon.data?.code ?? '…') : t('newCrumb') },
  ];
  const plain = (body: React.ReactNode) => (
    <div className="space-y-5">
      <Breadcrumb items={crumbs} />
      <PageHeader title={id ? (coupon.data?.code ?? '…') : t('newTitle')} />
      {body}
    </div>
  );

  if (!canWrite) {
    return plain(
      <Alert tone="warning" className="space-y-0.5">
        <p className="font-medium">{tc('deniedTitle')}</p>
        <p>{tc('deniedBody')}</p>
      </Alert>,
    );
  }
  if (options.isError) {
    return plain(<ErrorState error={options.error} onRetry={() => void options.refetch()} />);
  }
  if (id && coupon.isError) {
    return plain(
      couponErrorKind(coupon.error) === 'notFound' ? (
        <Alert tone="warning" className="space-y-2">
          <p>{t('notFound')}</p>
          <Link href="/admin/coupons" className="font-medium underline">
            {t('back')}
          </Link>
        </Alert>
      ) : (
        <ErrorState error={coupon.error} onRetry={() => void coupon.refetch()} />
      ),
    );
  }
  if (!options.data || (id && !coupon.data)) return plain(<LoadingBlock />);

  return (
    <div className="space-y-5">
      <Breadcrumb items={crumbs} />
      <CouponForm
        // A reload after a stale save remounts the form on the fresh row.
        key={coupon.data ? `${coupon.data.id}:${coupon.data.rowVersion}` : 'new'}
        existing={coupon.data}
        options={options.data}
        onReload={() => void coupon.refetch()}
        reloading={coupon.isFetching}
      />
    </div>
  );
}

const inputClass = 'font-mono';

export function CouponForm({
  existing,
  options,
  onReload,
  reloading,
}: {
  existing: Coupon | undefined;
  options: CouponOptionsResponse;
  onReload: () => void;
  reloading: boolean;
}) {
  const t = useTranslations(`${NS}.form`);
  const tl = useTranslations(`${NS}.list`);
  const te = useTranslations(`${NS}.errors`);
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<CouponDraft>(() =>
    existing ? toCouponDraft(existing) : emptyCouponDraft(),
  );
  const [problems, setProblems] = useState<CouponProblems>({});
  const [stale, setStale] = useState(false);

  const set = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key in problems) setProblems((p) => ({ ...p, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof checkCoupon> & { ok: true }) =>
      existing
        ? couponApi.update(existing.id, input.input as Parameters<typeof couponApi.update>[1])
        : couponApi.create(input.input as Parameters<typeof couponApi.create>[0]),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: COUPON_KEYS.all });
      toast.success(tl(existing ? 'flash.updated' : 'flash.created'));
      if (existing) qc.setQueryData(COUPON_KEYS.one(c.id), c);
      else router.push('/admin/coupons');
    },
    onError: (err) => {
      const kind = couponSubmitError(err);
      if (kind.kind === 'stale') setStale(true);
      else if (kind.kind === 'fields') setProblems(kind.problems);
      else toast.error(te(couponErrorKind(err)));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkCoupon(draft, existing?.rowVersion);
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    setProblems({});
    setStale(false);
    save.mutate(checked);
  };

  const label = (f: string) => t(`fields.${f}.label`);
  const message = (f: FormField) => {
    const kind = problems[f];
    return kind ? t(`problems.${kind}`, { field: label(f) }) : undefined;
  };
  const problemList = (Object.keys(problems) as FormField[])
    .filter((f) => problems[f])
    .map((f) => ({ field: f, text: message(f)! }));

  const currencyChoices = options.currencies.map((c) => ({
    code: c.code,
    text: `${c.symbol ? `${c.symbol} ` : ''}${c.code}`,
  }));
  if (draft.currencyCode && !currencyChoices.some((c) => c.code === draft.currencyCode)) {
    currencyChoices.push({ code: draft.currencyCode, text: draft.currencyCode });
  }

  const nf = new Intl.NumberFormat(locale);
  const actions = (
    <>
      <Link
        href="/admin/coupons"
        className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
      >
        {t('cancel')}
      </Link>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending && <Spinner label={t('saving')} />}
        {existing ? t('save') : t('create')}
      </Button>
    </>
  );

  return (
    <form onSubmit={submit} noValidate id="couponForm" className="space-y-5">
      <PageHeader
        eyebrow={existing ? t('editEyebrow') : t('newEyebrow')}
        title={
          existing ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className="font-mono">{existing.code}</span>
              <Badge tone={existing.isActive ? 'success' : 'neutral'}>
                {t(existing.isActive ? 'status.active' : 'status.disabled')}
              </Badge>
            </span>
          ) : (
            t('newTitle')
          )
        }
        description={
          existing
            ? [
                existing.maxUses
                  ? t('redeemedOf', {
                      used: nf.format(existing.usesCount),
                      max: nf.format(existing.maxUses),
                    })
                  : t('redeemed', { used: nf.format(existing.usesCount) }),
                existing.expiresAt
                  ? t('expires', { when: relativeTo(existing.expiresAt, new Date(), locale) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        actions={actions}
      />

      {stale && (
        <Alert tone="warning" className="space-y-2" role="alert">
          <p className="font-medium">{t('stale.title')}</p>
          <p>{t('stale.body')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onReload}
            disabled={reloading}
          >
            {t('stale.reload')}
          </Button>
        </Alert>
      )}
      {problemList.length > 0 && (
        <Alert tone="danger" role="alert" className="space-y-1">
          <p className="font-medium">{t('errorsTitle')}</p>
          <ul className="list-disc ps-5">
            {problemList.map((p) => (
              <li key={p.field}>{p.text}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="space-y-4">
        <SectionTitle n="01" title={t('sections.identity')} />
        <Field
          label={`${label('code')} *`}
          htmlFor="co-code"
          hint={t('fields.code.hint')}
          error={message('code')}
        >
          <Input
            id="co-code"
            value={draft.code}
            maxLength={64}
            autoComplete="off"
            placeholder={t('fields.code.placeholder')}
            invalid={Boolean(problems.code)}
            className={`${inputClass} uppercase`}
            onChange={(e) => set('code', e.target.value)}
          />
        </Field>
        <Field
          label={
            <>
              {label('description')}{' '}
              <span className="font-normal text-muted-foreground">
                {t('fields.description.note')}
              </span>
            </>
          }
          htmlFor="co-desc"
          error={message('description')}
        >
          <Textarea
            id="co-desc"
            rows={2}
            maxLength={255}
            value={draft.description}
            placeholder={t('fields.description.placeholder')}
            invalid={Boolean(problems.description)}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <Field
          label={
            <>
              {label('adminNote')}{' '}
              <span className="font-normal text-muted-foreground">
                {t('fields.adminNote.note')}
              </span>
            </>
          }
          htmlFor="co-note"
          error={message('adminNote')}
        >
          <Textarea
            id="co-note"
            rows={2}
            maxLength={1000}
            value={draft.adminNote}
            placeholder={t('fields.adminNote.placeholder')}
            invalid={Boolean(problems.adminNote)}
            onChange={(e) => set('adminNote', e.target.value)}
          />
        </Field>
        <ToggleRow
          id="co-active"
          label={label('isActive')}
          hint={t('fields.isActive.hint')}
          checked={draft.isActive}
          onChange={(v) => set('isActive', v)}
        />
      </Card>

      <Card className="space-y-4">
        <SectionTitle n="02" title={t('sections.discount')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${label('type')} *`} htmlFor="co-type">
            <Select
              id="co-type"
              value={draft.type}
              onChange={(e) => set('type', e.target.value as CouponDraft['type'])}
            >
              <option value="percent">{t('fields.type.percent')}</option>
              <option value="fixed">{t('fields.type.fixed')}</option>
            </Select>
          </Field>
          <Field
            label={`${label('amount')} *`}
            htmlFor="co-amount"
            hint={t('fields.amount.hint')}
            error={message('amount')}
          >
            <Input
              id="co-amount"
              inputMode="decimal"
              autoComplete="off"
              value={draft.amount}
              placeholder={t('fields.amount.placeholder')}
              invalid={Boolean(problems.amount)}
              className={inputClass}
              onChange={(e) => set('amount', e.target.value)}
            />
          </Field>
          <Field
            label={
              <>
                {label('maxDiscountAmount')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('fields.maxDiscountAmount.note')}
                </span>
              </>
            }
            htmlFor="co-max-discount"
            hint={t('fields.maxDiscountAmount.hint')}
            error={message('maxDiscountAmount')}
          >
            <Input
              id="co-max-discount"
              inputMode="decimal"
              autoComplete="off"
              value={draft.maxDiscountAmount}
              placeholder={t('fields.maxDiscountAmount.placeholder')}
              invalid={Boolean(problems.maxDiscountAmount)}
              className={inputClass}
              onChange={(e) => set('maxDiscountAmount', e.target.value)}
            />
          </Field>
          <Field
            label={label('currencyCode')}
            htmlFor="co-currency"
            hint={t('fields.currencyCode.hint')}
            error={message('currencyCode')}
          >
            <Select
              id="co-currency"
              value={draft.currencyCode}
              invalid={Boolean(problems.currencyCode)}
              onChange={(e) => set('currencyCode', e.target.value)}
            >
              <option value="">{t('fields.currencyCode.any')}</option>
              {currencyChoices.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.text}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={label('minOrderAmount')} htmlFor="co-min" error={message('minOrderAmount')}>
          <Input
            id="co-min"
            inputMode="decimal"
            autoComplete="off"
            value={draft.minOrderAmount}
            placeholder={t('fields.minOrderAmount.placeholder')}
            invalid={Boolean(problems.minOrderAmount)}
            className={inputClass}
            onChange={(e) => set('minOrderAmount', e.target.value)}
          />
        </Field>
      </Card>

      <Card className="space-y-4">
        <SectionTitle n="03" title={t('sections.eligibility')} />
        <Field
          label={
            <>
              {label('applicablePlanSlugs')}{' '}
              <span className="font-normal text-muted-foreground">
                {t('fields.applicablePlanSlugs.note')}
              </span>
            </>
          }
          htmlFor="co-plans"
          hint={t('fields.applicablePlanSlugs.hint')}
          error={message('applicablePlanSlugs')}
        >
          <PlanPicker
            id="co-plans"
            options={options.plans}
            value={draft.applicablePlanSlugs}
            invalid={Boolean(problems.applicablePlanSlugs)}
            onChange={(slugs) => set('applicablePlanSlugs', slugs)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={label('startsAt')}
            htmlFor="co-start"
            hint={t('fields.startsAt.hint')}
            error={message('startsAt')}
          >
            <Input
              id="co-start"
              type="datetime-local"
              value={draft.startsAt}
              invalid={Boolean(problems.startsAt)}
              className={inputClass}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          </Field>
          <Field
            label={label('expiresAt')}
            htmlFor="co-exp"
            hint={t('fields.expiresAt.hint')}
            error={message('expiresAt')}
          >
            <Input
              id="co-exp"
              type="datetime-local"
              value={draft.expiresAt}
              invalid={Boolean(problems.expiresAt)}
              className={inputClass}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionTitle n="04" title={t('sections.limits')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={label('maxUses')}
            htmlFor="co-max-uses"
            hint={t('fields.maxUses.hint')}
            error={message('maxUses')}
          >
            <Input
              id="co-max-uses"
              inputMode="numeric"
              autoComplete="off"
              value={draft.maxUses}
              placeholder={t('fields.maxUses.placeholder')}
              invalid={Boolean(problems.maxUses)}
              className={inputClass}
              onChange={(e) => set('maxUses', e.target.value)}
            />
          </Field>
          <Field
            label={label('perUserLimit')}
            htmlFor="co-per-user"
            hint={t('fields.perUserLimit.hint')}
            error={message('perUserLimit')}
          >
            <Input
              id="co-per-user"
              inputMode="numeric"
              autoComplete="off"
              value={draft.perUserLimit}
              placeholder={t('fields.perUserLimit.placeholder')}
              invalid={Boolean(problems.perUserLimit)}
              className={inputClass}
              onChange={(e) => set('perUserLimit', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow
            id="co-first"
            label={label('firstPurchaseOnly')}
            hint={t('fields.firstPurchaseOnly.hint')}
            checked={draft.firstPurchaseOnly}
            onChange={(v) => set('firstPurchaseOnly', v)}
          />
          <ToggleRow
            id="co-stack"
            label={label('stackableWithOther')}
            hint={t('fields.stackableWithOther.hint')}
            checked={draft.stackableWithOther}
            onChange={(v) => set('stackableWithOther', v)}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
    </form>
  );
}

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold">
      <span className="inline-flex size-6 items-center justify-center rounded-md bg-muted font-mono text-[10px] text-primary">
        {n}
      </span>
      {title}
    </h2>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer text-sm">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </label>
      <Switch id={id} label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
