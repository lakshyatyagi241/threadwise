'use client';

import { Check, Field } from '../kit';
import type { FormComponent } from '../types';
import { Mono, Sel, Ta, Txt } from './shared';

export const TgPaymentForm: FormComponent = (p) => {
  const payMode = p.data.mode === 'paylink' ? 'paylink' : 'invoice';
  return (
    <>
      <div className="mb-4 rounded-lg border border-[#BEE3F5] bg-[#EAF6FC] p-2.5 text-[11.5px] leading-snug text-[#1B4C63]">
        Charge the customer inside Telegram. The bot needs a payment provider token (get one from{' '}
        <Mono>@BotFather → /mybots → Payments</Mono>). The paid confirmation lands back in your inbox.
      </div>
      <Field label="Type">
        {Sel(p, 'mode', [
          { v: 'invoice', l: 'Invoice — a native Pay button in the chat' },
          { v: 'paylink', l: 'Pay link — a shareable URL sent as a message' },
        ])}
      </Field>
      <Field label="Title" hint="Shown bold at the top of the invoice (max 32 chars).">
        {Txt(p, 'title', 'Order payment')}
      </Field>
      <Field label="Description" hint="Supports {{variables}} from earlier nodes.">
        {Ta(p, 'description', 'Complete your purchase', 2)}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Currency" hint="ISO code, e.g. USD, EUR, IDR, INR.">
          {Txt(p, 'currency', 'USD')}
        </Field>
        <Field
          label="Amount"
          hint="Major units (9.99). Zero-decimal currencies like IDR/JPY are sent whole. Accepts {{variables}}."
        >
          {Txt(p, 'amount', '9.99')}
        </Field>
      </div>
      <Field label="Line-item label" hint="The single price row label shown on the invoice.">
        {Txt(p, 'label', 'Total')}
      </Field>
      {payMode === 'paylink' ? <Field label="Message before the link">{Ta(p, 'linkText', 'Tap to pay:', 2)}</Field> : null}
      <Field
        label="Reconciliation id (optional)"
        hint="Stored on the payment so you can match it to an order. Leave blank to auto-generate."
      >
        {Txt(p, 'payload', '')}
      </Field>
      <Field
        label="After sending"
        hint='On: the flow pauses here and only continues down "out" once the customer pays (amount arrives as {{paid_amount}} {{paid_currency}}). Off: the invoice is sent and the flow continues immediately.'
      >
        <Check checked={!!p.data.wait} onChange={(v) => p.set('wait', v)}>
          Wait until paid, then continue
        </Check>
      </Field>
    </>
  );
};
