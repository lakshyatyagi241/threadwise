'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@crm/ui';
import {
  COUNTRY_OPTIONS,
  LIMITS,
  MAX_EXTRA_ROWS,
  checkTaxId,
  gstinFacts,
  gstinStateMismatch,
  normalizedTaxId,
  profileOf,
  stateOptions,
} from '../lib/profile-form';
import { RowsEditor, Section, SubHeading, type EditorCtx } from './business-profile-ui';

const OTHER = '__other';

/** Business: who the seller is on every invoice: name, address, country and state, contact, registration, tax id, statutory extras. */
export function BusinessSection({ form, set, err, readOnly }: EditorCtx) {
  const t = useTranslations('invoicing.settings.business');
  const uid = useId();
  const country = form.sellerCountry.trim().toUpperCase();
  const known = COUNTRY_OPTIONS.some((c) => c.code === country);
  const [other, setOther] = useState(() => country !== '' && !known);
  const states = useMemo(() => stateOptions(country), [country]);

  function changeCountry(value: string) {
    const next = value === OTHER ? '' : value;
    setOther(value === OTHER);
    // A state belongs to its country's list: keep it only when neither side has a list.
    if (stateOptions(country) || stateOptions(next)) set('sellerState', '');
    set('sellerCountry', next);
  }

  const selectValue = known ? country : other || country ? OTHER : '';
  const stateKnown = states?.some((s) => s.code === form.sellerState.trim().toUpperCase()) ?? false;

  return (
    <Section id="business" title={t('title')} description={t('description')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('name')}
          htmlFor={`${uid}-name`}
          hint={t('nameHint')}
          error={err('sellerName')}
        >
          <Input
            id={`${uid}-name`}
            value={form.sellerName}
            maxLength={LIMITS.sellerName + 20}
            disabled={readOnly}
            invalid={!!err('sellerName')}
            autoComplete="organization"
            dir="auto"
            onChange={(e) => set('sellerName', e.target.value)}
          />
        </Field>
        <Field
          label={t('registration')}
          htmlFor={`${uid}-reg`}
          hint={t('registrationHint')}
          error={err('sellerRegistrationNo')}
        >
          <Input
            id={`${uid}-reg`}
            value={form.sellerRegistrationNo}
            maxLength={LIMITS.sellerRegistrationNo + 20}
            disabled={readOnly}
            invalid={!!err('sellerRegistrationNo')}
            dir="auto"
            onChange={(e) => set('sellerRegistrationNo', e.target.value)}
          />
        </Field>
        <Field
          label={t('address')}
          htmlFor={`${uid}-addr`}
          hint={t('addressHint')}
          error={err('sellerAddress')}
          className="sm:col-span-2"
        >
          <Textarea
            id={`${uid}-addr`}
            rows={3}
            value={form.sellerAddress}
            disabled={readOnly}
            invalid={!!err('sellerAddress')}
            autoComplete="street-address"
            dir="auto"
            onChange={(e) => set('sellerAddress', e.target.value)}
          />
        </Field>

        <Field
          label={t('country')}
          htmlFor={`${uid}-country`}
          hint={t('countryHint')}
          error={err('sellerCountry')}
        >
          <Select
            id={`${uid}-country`}
            value={selectValue}
            disabled={readOnly}
            invalid={!!err('sellerCountry')}
            onChange={(e) => changeCountry(e.target.value)}
          >
            <option value="">{t('countryChoose')}</option>
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
            <option value={OTHER}>{t('countryOther')}</option>
          </Select>
        </Field>
        {selectValue === OTHER ? (
          <Field
            label={t('countryCode')}
            htmlFor={`${uid}-ccode`}
            hint={t('countryCodeHint')}
            error={err('sellerCountry')}
          >
            <Input
              id={`${uid}-ccode`}
              value={form.sellerCountry}
              maxLength={2}
              disabled={readOnly}
              invalid={!!err('sellerCountry')}
              dir="ltr"
              className="uppercase"
              onChange={(e) => set('sellerCountry', e.target.value.toUpperCase())}
            />
          </Field>
        ) : (
          <Field
            label={t('state')}
            htmlFor={`${uid}-state`}
            hint={states ? t('stateHintList') : t('stateHintFree')}
            error={err('sellerState')}
          >
            {states ? (
              <Select
                id={`${uid}-state`}
                value={form.sellerState}
                disabled={readOnly}
                invalid={!!err('sellerState')}
                onChange={(e) => set('sellerState', e.target.value)}
              >
                <option value="">{t('stateChoose')}</option>
                {form.sellerState && !stateKnown && (
                  <option value={form.sellerState}>{form.sellerState}</option>
                )}
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={`${uid}-state`}
                value={form.sellerState}
                maxLength={3}
                disabled={readOnly}
                invalid={!!err('sellerState')}
                dir="ltr"
                className="uppercase"
                onChange={(e) => set('sellerState', e.target.value.toUpperCase())}
              />
            )}
          </Field>
        )}
        {selectValue === OTHER && (
          <Field
            label={t('state')}
            htmlFor={`${uid}-state2`}
            hint={t('stateHintFree')}
            error={err('sellerState')}
          >
            <Input
              id={`${uid}-state2`}
              value={form.sellerState}
              maxLength={3}
              disabled={readOnly}
              invalid={!!err('sellerState')}
              dir="ltr"
              className="uppercase"
              onChange={(e) => set('sellerState', e.target.value.toUpperCase())}
            />
          </Field>
        )}

        <Field label={t('phone')} htmlFor={`${uid}-phone`} error={err('sellerPhone')}>
          <Input
            id={`${uid}-phone`}
            type="tel"
            value={form.sellerPhone}
            maxLength={LIMITS.sellerPhone + 10}
            disabled={readOnly}
            invalid={!!err('sellerPhone')}
            autoComplete="tel"
            dir="ltr"
            onChange={(e) => set('sellerPhone', e.target.value)}
          />
        </Field>
        <Field
          label={t('email')}
          htmlFor={`${uid}-email`}
          hint={t('emailHint')}
          error={err('supportEmail')}
        >
          <Input
            id={`${uid}-email`}
            type="email"
            value={form.supportEmail}
            disabled={readOnly}
            invalid={!!err('supportEmail')}
            autoComplete="email"
            dir="ltr"
            onChange={(e) => set('supportEmail', e.target.value)}
          />
        </Field>
      </div>

      <TaxIdField ctx={{ form, set, err, readOnly }} />

      <div className="space-y-3 border-t border-border pt-5">
        <SubHeading hint={t('extraHint', { max: MAX_EXTRA_ROWS })}>{t('extraTitle')}</SubHeading>
        <RowsEditor
          rows={form.extraFields}
          onChange={(rows) => set('extraFields', rows)}
          max={MAX_EXTRA_ROWS}
          errPrefix="extraFields"
          err={err}
          disabled={readOnly}
          suggestions={['CIN', 'LUT No', 'PAN', 'MSME / Udyam', 'Company number']}
          labelMax={40}
          valueMax={LIMITS.extraValue}
          labelPlaceholder={t('extraLabelPlaceholder')}
          valuePlaceholder={t('extraValuePlaceholder')}
        />
      </div>
    </Section>
  );
}

/**
 * The seller's tax id with a live check by the validator of the seller country's profile. It never blocks saving: a failed check
 * is a warning (the number may be right and the checker out of date), and a passing one proves the FORMAT, not the registration.
 */
function TaxIdField({ ctx }: { ctx: Pick<EditorCtx, 'form' | 'set' | 'err' | 'readOnly'> }) {
  const { form, set, err, readOnly } = ctx;
  const t = useTranslations('invoicing.settings.taxId');
  const id = useId();
  const check = useMemo(
    () => checkTaxId(form.sellerCountry, form.sellerTaxId),
    [form.sellerCountry, form.sellerTaxId],
  );
  const result = check.result;
  const facts = gstinFacts(check);
  const mismatch = gstinStateMismatch(check, form.sellerCountry, form.sellerState);
  const profile = profileOf(form.sellerCountry);
  const requirement = check.requirement;

  return (
    <div className="space-y-2 border-t border-border pt-5">
      <Field
        label={check.label ? t('label', { label: check.label }) : t('genericLabel')}
        htmlFor={`${id}-tax`}
        error={err('sellerTaxId')}
      >
        <Input
          id={`${id}-tax`}
          value={form.sellerTaxId}
          maxLength={LIMITS.sellerTaxId + 20}
          disabled={readOnly}
          invalid={!!err('sellerTaxId')}
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-tax-note`}
          placeholder={check.example ?? undefined}
          onChange={(e) => set('sellerTaxId', e.target.value)}
          onBlur={() => {
            const n = normalizedTaxId(form.sellerCountry, form.sellerTaxId);
            if (n !== form.sellerTaxId) set('sellerTaxId', n);
          }}
        />
      </Field>
      <div id={`${id}-tax-note`} className="space-y-2" aria-live="polite">
        {check.state === 'no_country' && (
          <p className="text-xs text-muted-foreground">{t('noCountry')}</p>
        )}
        {check.state === 'no_spec' && (
          <p className="text-xs text-muted-foreground">
            {t('noSpec', { country: profile?.name ?? '' })}
          </p>
        )}
        {check.state === 'empty' && (
          <p className="text-xs text-muted-foreground">
            {t('emptyHint', { label: check.label ?? '', example: check.example ?? '' })}
            {requirement === 'required' && ` ${t('requirement.required')}`}
            {requirement === 'required_if_registered' &&
              ` ${t('requirement.required_if_registered')}`}
            {requirement === 'b2b_only' && ` ${t('requirement.b2b_only')}`}
          </p>
        )}
        {check.state === 'checked' && result && (
          <>
            {result.valid ? (
              <Alert tone="success">
                {result.level === 'checksum'
                  ? t('validChecksum', { label: check.label ?? '' })
                  : t('validFormat', { label: check.label ?? '' })}
                {facts && (
                  <span className="mt-1 block text-xs">
                    {t('gstinState', { state: facts.stateName, code: facts.stateCode })} {' · '}{' '}
                    {t('gstinPan', { pan: facts.pan })}
                  </span>
                )}
              </Alert>
            ) : (
              <Alert tone="warning">
                <span className="font-medium">
                  {result.level === 'checksum'
                    ? t('invalidChecksum', { label: check.label ?? '' })
                    : t('invalidFormat', { label: check.label ?? '' })}
                </span>
                {result.reason && (
                  <span className="mt-1 block text-xs" dir="auto">
                    {result.reason}
                  </span>
                )}
                <span className="mt-1 block text-xs">{t('canStillSave')}</span>
              </Alert>
            )}
            {mismatch && facts && (
              <Alert tone="warning">
                {t('mismatch', { state: facts.stateName, code: facts.stateCode })}
              </Alert>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">{t('formatNote')}</p>
      </div>
    </div>
  );
}
