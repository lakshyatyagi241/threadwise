'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { FORM_PAYMENT_AMOUNT_TYPES, type FormPaymentAmountType } from '@crm/contracts';
import { Alert, Input, Select } from '@crm/ui';
import { useFormPaymentGateway } from '../api/forms';
import { paymentFieldChoices, paymentIssue, toMajorText, toMinor } from '../lib/payment';
import type { Definition } from '../lib/types';
import { FieldBox, Section, SwitchRow } from './settings-tab';

/**
 * A price typed as text ("499.00") and handed up as minor units only when it is a legal amount, so a half-typed "49" never becomes a
 * saved price. The text follows the saved value when it changes from outside.
 */
function MoneyInput({
  label,
  hint,
  error,
  value,
  currency,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: number | undefined;
  currency: string;
  disabled: boolean;
  onCommit: (minor: number | undefined) => void;
}) {
  const [text, setText] = useState(toMajorText(value, currency));
  const [seen, setSeen] = useState({ value, currency });
  if (seen.value !== value || seen.currency !== currency) {
    setSeen({ value, currency });
    if (toMinor(text, currency) !== value) setText(toMajorText(value, currency));
  }
  const invalid = text.trim() !== '' && toMinor(text, currency) === null;
  return (
    <FieldBox label={label} hint={hint} error={error ?? (invalid ? label : undefined)}>
      {(a) => (
        <Input
          {...a}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          className="max-w-48"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            onCommit(
              e.target.value.trim() === ''
                ? undefined
                : (toMinor(e.target.value, currency) ?? undefined),
            );
          }}
        />
      )}
    </FieldBox>
  );
}

/**
 * "Payment": charge the visitor on the workspace's gateway after they submit (spec section 10). The panel edits the draft's
 * `payment` block and, for "from a choice field", the price of each option of the chosen field. Money is never decided here: the
 * server works the amount out from the published version. The panel says plainly when no gateway can take the payment.
 */
export function PaymentPanel({
  draft,
  setDraft,
  disabled,
}: {
  draft: Definition;
  setDraft: Dispatch<SetStateAction<Definition>>;
  disabled: boolean;
}) {
  const t = useTranslations('web-forms.payment');
  const gateway = useFormPaymentGateway();
  const p = draft.payment;
  const issue = paymentIssue(draft);
  const choices = p.amountType === 'fixed' ? [] : paymentFieldChoices(draft, p.amountType);
  const chosen = draft.steps
    .flatMap((s) => s.blocks)
    .find((b) => b.type === 'field' && b.id === p.fieldId);

  const setPayment = (patch: Partial<Definition['payment']>) =>
    setDraft((d) => ({ ...d, payment: { ...d.payment, ...patch } }));
  const setOptionAmount = (value: string, amountMinor: number | undefined) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.type === 'field' && b.id === d.payment.fieldId
            ? {
                ...b,
                options: b.options?.map((o) => {
                  if (o.value !== value) return o;
                  const { amountMinor: _drop, ...rest } = o;
                  return amountMinor === undefined ? rest : { ...rest, amountMinor };
                }),
              }
            : b,
        ),
      })),
    }));

  const gw = gateway.data;
  const blocked = p.enabled && gw && !gw.ready;
  const issueText = issue ? t(`issues.${issue}`) : undefined;

  return (
    <Section title={t('title')} description={t('description')}>
      <SwitchRow
        label={t('enabled')}
        hint={t('enabledHint')}
        checked={p.enabled}
        disabled={disabled}
        onChange={(enabled) => setPayment({ enabled })}
      />

      {gateway.isPending && (
        <p className="text-xs text-muted-foreground">{t('gateway.checking')}</p>
      )}
      {gateway.isError && <Alert tone="warning">{t('gateway.failed')}</Alert>}
      {gw?.ready && (
        <p className="text-xs text-muted-foreground" data-testid="payment-gateway-ready">
          {t('gateway.ready', {
            name: gw.name ?? gw.slug ?? '',
            mode: t(`gateway.mode.${gw.mode ?? 'live'}`),
          })}
        </p>
      )}
      {(blocked || (gw && !gw.ready && !p.enabled)) && gw && !gw.ready && (
        <Alert tone="warning">
          <span data-testid="payment-gateway-missing">
            {gw.reason === 'no_link_support'
              ? t('gateway.noLink', { name: gw.name ?? gw.slug ?? '' })
              : t('gateway.none')}{' '}
            <Link href="/store/gateways" className="underline">
              {t('gateway.open')}
            </Link>
          </span>
        </Alert>
      )}

      {p.enabled && (
        <div className="space-y-4" data-testid="payment-config">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBox label={t('amountType')} hint={t(`amountTypeHints.${p.amountType}`)}>
              {(a) => (
                <Select
                  {...a}
                  value={p.amountType}
                  disabled={disabled}
                  onChange={(e) => {
                    const amountType = e.target.value as FormPaymentAmountType;
                    // The field belongs to the way the amount is read: a new way starts without one, so no stale field stays bound.
                    setPayment({ amountType, fieldId: undefined });
                  }}
                >
                  {FORM_PAYMENT_AMOUNT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`amountTypes.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FieldBox>
            <FieldBox label={t('currency')} hint={t('currencyHint')}>
              {(a) => (
                <Input
                  {...a}
                  dir="ltr"
                  maxLength={3}
                  autoCapitalize="characters"
                  className="max-w-32"
                  value={p.currency}
                  disabled={disabled}
                  onChange={(e) => setPayment({ currency: e.target.value.toUpperCase() })}
                />
              )}
            </FieldBox>
          </div>

          {p.amountType === 'fixed' && (
            <MoneyInput
              label={t('amount')}
              hint={t('amountHint', { currency: p.currency })}
              error={issue === 'amountRequired' ? issueText : undefined}
              value={p.amountMinor}
              currency={p.currency}
              disabled={disabled}
              onCommit={(amountMinor) => setPayment({ amountMinor })}
            />
          )}

          {p.amountType !== 'fixed' && (
            <FieldBox
              label={p.amountType === 'from_field' ? t('fieldChoice') : t('fieldNumber')}
              hint={
                choices.length === 0
                  ? t(p.amountType === 'from_field' ? 'noChoiceFields' : 'noNumberFields')
                  : undefined
              }
              error={
                issue === 'fieldRequired' || issue === 'fieldNotRequired' ? issueText : undefined
              }
            >
              {(a) => (
                <Select
                  {...a}
                  value={p.fieldId ?? ''}
                  disabled={disabled || choices.length === 0}
                  onChange={(e) => setPayment({ fieldId: e.target.value || undefined })}
                >
                  <option value="">{t('fieldNone')}</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </FieldBox>
          )}

          {p.amountType === 'from_field' && chosen?.type === 'field' && (
            <div className="space-y-3" data-testid="payment-option-prices">
              <p className="text-sm font-medium">{t('optionPrices')}</p>
              {issue === 'optionsNeedAmounts' && (
                <p role="alert" className="text-xs text-danger">
                  {issueText}
                </p>
              )}
              {(chosen.options ?? []).map((o) => (
                <MoneyInput
                  key={o.value}
                  label={t('optionPrice', { label: o.label })}
                  value={o.amountMinor}
                  currency={p.currency}
                  disabled={disabled}
                  onCommit={(amountMinor) => setOptionAmount(o.value, amountMinor)}
                />
              ))}
            </div>
          )}

          {p.amountType === 'pay_what_you_want' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyInput
                label={t('min')}
                hint={t('minHint')}
                error={issue === 'minRequired' || issue === 'minAboveMax' ? issueText : undefined}
                value={p.minMinor}
                currency={p.currency}
                disabled={disabled}
                onCommit={(minMinor) => setPayment({ minMinor })}
              />
              <MoneyInput
                label={t('max')}
                hint={t('maxHint')}
                value={p.maxMinor}
                currency={p.currency}
                disabled={disabled}
                onCommit={(maxMinor) => setPayment({ maxMinor })}
              />
            </div>
          )}

          <FieldBox label={t('descriptionLabel')} hint={t('descriptionHint')}>
            {(a) => (
              <Input
                {...a}
                maxLength={120}
                value={p.description ?? ''}
                disabled={disabled}
                onChange={(e) => setPayment({ description: e.target.value || undefined })}
              />
            )}
          </FieldBox>
        </div>
      )}
    </Section>
  );
}
