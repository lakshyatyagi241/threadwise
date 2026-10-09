'use client';

import { useTranslations } from 'next-intl';
import { Check, Field } from '../kit';
import type { FormComponent } from '../types';
import { Mono, Sel, Ta, Txt } from './shared';

const NS = 'flb.builder.formsChannels.telegram';

export const TgPaymentForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const payMode = p.data.mode === 'paylink' ? 'paylink' : 'invoice';
  return (
    <>
      <div className="mb-3 rounded-lg border border-[#BEE3F5] bg-[#EAF6FC] p-2.5 text-[11.5px] leading-snug text-[#1B4C63]">
        {t.rich('intro', { mono: (c) => <Mono>{c}</Mono> })}
      </div>
      <Field label={t('type')}>
        {Sel(p, 'mode', [
          { v: 'invoice', l: t('typeInvoice') },
          { v: 'paylink', l: t('typePaylink') },
        ])}
      </Field>
      <Field label={t('title')} hint={t('titleHint')}>
        {Txt(p, 'title', t('titlePlaceholder'))}
      </Field>
      <Field label={t('description')} hint={t('descriptionHint')}>
        {Ta(p, 'description', t('descriptionPlaceholder'), 2)}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('currency')} hint={t('currencyHint')}>
          {Txt(p, 'currency', 'USD')}
        </Field>
        <Field label={t('amount')} hint={t('amountHint')}>
          {Txt(p, 'amount', '9.99')}
        </Field>
      </div>
      <Field label={t('lineItem')} hint={t('lineItemHint')}>
        {Txt(p, 'label', t('lineItemPlaceholder'))}
      </Field>
      {payMode === 'paylink' ? (
        <Field label={t('linkMessage')}>{Ta(p, 'linkText', t('linkMessagePlaceholder'), 2)}</Field>
      ) : null}
      <Field label={t('reconciliation')} hint={t('reconciliationHint')}>
        {Txt(p, 'payload', '')}
      </Field>
      <Field
        label={t('afterSending')}
        hint={t('afterSendingHint', {
          paidAmount: '{{paid_amount}}',
          paidCurrency: '{{paid_currency}}',
        })}
      >
        <Check checked={!!p.data.wait} onChange={(v) => p.set('wait', v)}>
          {t('waitUntilPaid')}
        </Check>
      </Field>
    </>
  );
};
