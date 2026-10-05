'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { StoreCoupon, StoreCouponType } from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Spinner, useToast } from '@crm/ui';
import { useCreateCoupon, useUpdateCoupon } from '../api/hooks';
import {
  couponToForm,
  emptyCouponForm,
  hasProblems,
  suggestCode,
  toCouponInput,
  toCouponUpdate,
  validateCouponForm,
  type CouponField,
  type CouponForm,
  type CouponProblems,
} from '../lib/coupon-form';
import { errorKind, fieldErrors } from '../lib/errors';
import { useErrorLine } from './parts';

export interface ShopOption {
  id: string;
  name: string;
}

/** Create or edit one coupon. Mount it only while it is open: it starts from `coupon` (edit) or a blank form (new) each time. */
export function CouponFormModal({
  coupon,
  currency,
  shops,
  onClose,
}: {
  coupon: StoreCoupon | null;
  currency: string;
  shops: ShopOption[];
  onClose: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.coupons');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const errorLine = useErrorLine();
  const { toast } = useToast();
  const create = useCreateCoupon();
  const update = useUpdateCoupon(coupon?.id ?? '');
  const [form, setForm] = useState<CouponForm>(() =>
    coupon ? couponToForm(coupon) : emptyCouponForm(),
  );
  const [problems, setProblems] = useState<CouponProblems>({});
  const [server, setServer] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const percent = form.type === 'percent';

  const set = <K extends CouponField>(key: K, value: CouponForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setProblems((p) => (key in p ? { ...p, [key]: undefined } : p));
    setServer((s) => (key in s ? { ...s, [key]: '' } : s));
  };
  const problem = (field: CouponField): string | undefined =>
    problems[field] ? t(`problems.${problems[field]}`) : server[field] || undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateCouponForm(form);
    setProblems(found);
    if (hasProblems(found)) return;
    setFailure(null);
    const done = (message: string) => {
      toast(message, 'success');
      onClose();
    };
    const fail = (err: unknown) => {
      const kind = errorKind(err);
      if (kind === 'couponCodeTaken') {
        setServer({ code: errorLine(err) });
        return;
      }
      const fields = fieldErrors(err);
      setServer(fields);
      setFailure(errorLine(err));
    };
    if (coupon) {
      update.mutate(toCouponUpdate(form, coupon.rowVersion), {
        onSuccess: () => done(t('updated')),
        onError: fail,
      });
    } else {
      create.mutate(toCouponInput(form), { onSuccess: () => done(t('created')), onError: fail });
    }
  };

  const FORM_ID = 'coupon-form';
  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!pending) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={coupon ? t('formTitleEdit', { code: coupon.code }) : t('formTitleNew')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={pending}>
            {pending && <Spinner />}
            {coupon ? t('saveChanges') : t('create')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
        {failure && <Alert tone="danger">{failure}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('code')}
            htmlFor="coupon-code"
            hint={t('codeHint')}
            error={problem('code')}
          >
            <Input
              id="coupon-code"
              value={form.code}
              maxLength={64}
              placeholder="SUMMER10"
              autoComplete="off"
              className="font-mono uppercase"
              invalid={Boolean(problem('code'))}
              onChange={(e) => set('code', suggestCode(e.target.value))}
            />
          </Field>
          <Field label={t('type')} htmlFor="coupon-type">
            <Select
              id="coupon-type"
              value={form.type}
              onChange={(e) => set('type', e.target.value as StoreCouponType)}
            >
              <option value="percent">{t('typePercent')}</option>
              <option value="flat">{t('typeFlat', { currency })}</option>
            </Select>
          </Field>
          <Field
            label={percent ? t('valuePercent') : t('valueFlat', { currency })}
            htmlFor="coupon-value"
            error={problem('value')}
          >
            <Input
              id="coupon-value"
              value={form.value}
              inputMode={percent ? 'numeric' : 'decimal'}
              invalid={Boolean(problem('value'))}
              onChange={(e) => set('value', e.target.value)}
            />
          </Field>
          <Field
            label={t('minSubtotal', { currency })}
            htmlFor="coupon-min"
            hint={t('minSubtotalHint')}
            error={problem('minSubtotal')}
          >
            <Input
              id="coupon-min"
              value={form.minSubtotal}
              inputMode="decimal"
              invalid={Boolean(problem('minSubtotal'))}
              onChange={(e) => set('minSubtotal', e.target.value)}
            />
          </Field>
          {percent && (
            <Field
              label={t('maxDiscount', { currency })}
              htmlFor="coupon-max"
              hint={t('maxDiscountHint')}
              error={problem('maxDiscount')}
            >
              <Input
                id="coupon-max"
                value={form.maxDiscount}
                inputMode="decimal"
                invalid={Boolean(problem('maxDiscount'))}
                onChange={(e) => set('maxDiscount', e.target.value)}
              />
            </Field>
          )}
          <Field
            label={t('usageLimit')}
            htmlFor="coupon-limit"
            hint={t('usageLimitHint')}
            error={problem('usageLimit')}
          >
            <Input
              id="coupon-limit"
              value={form.usageLimit}
              inputMode="numeric"
              placeholder={t('unlimited')}
              invalid={Boolean(problem('usageLimit'))}
              onChange={(e) => set('usageLimit', e.target.value)}
            />
          </Field>
          <Field label={t('startsAt')} htmlFor="coupon-starts" error={problem('startsAt')}>
            <Input
              id="coupon-starts"
              type="datetime-local"
              value={form.startsAt}
              invalid={Boolean(problem('startsAt'))}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          </Field>
          <Field label={t('expiresAt')} htmlFor="coupon-expires" error={problem('expiresAt')}>
            <Input
              id="coupon-expires"
              type="datetime-local"
              value={form.expiresAt}
              invalid={Boolean(problem('expiresAt'))}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
          </Field>
          <Field
            label={t('scope')}
            htmlFor="coupon-scope"
            hint={t('scopeHint')}
            className="sm:col-span-2"
          >
            <Select
              id="coupon-scope"
              value={form.storefrontId}
              onChange={(e) => set('storefrontId', e.target.value)}
            >
              <option value="">{tc('allShops')}</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox
            id="coupon-free-shipping"
            label={t('freeShipping')}
            checked={form.freeShipping}
            onChange={(e) => set('freeShipping', e.target.checked)}
          />
          <Checkbox
            id="coupon-active"
            label={t('activeLabel')}
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
          />
        </div>
      </form>
    </Modal>
  );
}
