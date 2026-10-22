'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  REGISTRATION_ASKED,
  updateComplianceInfoInputSchema,
  WABA_ENTITY_TYPES,
  type WabaComplianceInfo,
  type WabaEntityType,
} from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Spinner } from '@crm/ui';
import { useCompliance, useUpdateCompliance } from '../api/hooks';
import { useErrorText } from './use-error-text';

/** The compliance form: the legal name, the business type, the registration answer and the two contact sides Meta asks for. */
export function ComplianceCard({ id }: { id: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.profile');
  const errorText = useErrorText();
  const q = useCompliance(id);
  return (
    <Card className="p-4 md:col-span-2">
      <h3 className="font-semibold">{t('complianceTitle')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('complianceHint')}</p>
      {q.isPending ? (
        <Spinner label={t('loading')} />
      ) : q.isError ? (
        <Alert tone="warning">{errorText(q.error).text}</Alert>
      ) : (
        <ComplianceForm id={id} record={q.data} />
      )}
    </Card>
  );
}

const CONTACT_FIELDS = ['email', 'mobile', 'landline'] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];
type Contact = Record<ContactField, string>;

interface FormState {
  entityName: string;
  entityType: WabaEntityType;
  entityTypeCustom: string;
  isRegistered: boolean | null;
  customerCare: Contact;
  grievanceOfficer: Contact & { name: string };
}

/**
 * Which message a field's problem gets. The keys are the contract's own field paths, so a client-side check and a server
 * rejection land on the same field with the same words, in every language.
 */
const MESSAGE_KEY: Record<string, string> = {
  entityName: 'legalNameRequired',
  entityTypeCustom: 'businessTypeCustomRequired',
  isRegistered: 'registeredRequired',
  customerCare: 'contactRequired',
  'customerCare.email': 'emailInvalid',
  'customerCare.mobile': 'phoneInvalid',
  'customerCare.landline': 'phoneInvalid',
  grievanceOfficer: 'contactRequired',
  'grievanceOfficer.name': 'officerNameRequired',
  'grievanceOfficer.email': 'emailInvalid',
  'grievanceOfficer.mobile': 'phoneInvalid',
  'grievanceOfficer.landline': 'phoneInvalid',
};

function ComplianceForm({ id, record }: { id: string; record: WabaComplianceInfo }) {
  const t = useTranslations('whatsapp-cloud-api-waba.profile');
  const errorText = useErrorText();
  const update = useUpdateCompliance(id);
  const [v, setV] = useState<FormState>(() => ({
    entityName: record.entityName ?? '',
    entityType: record.entityType ?? 'OTHER',
    entityTypeCustom: record.entityTypeCustom ?? '',
    isRegistered: record.isRegistered,
    customerCare: {
      email: record.customerCare.email ?? '',
      mobile: record.customerCare.mobile ?? '',
      landline: record.customerCare.landline ?? '',
    },
    grievanceOfficer: {
      name: record.grievanceOfficer.name ?? '',
      email: record.grievanceOfficer.email ?? '',
      mobile: record.grievanceOfficer.mobile ?? '',
      landline: record.grievanceOfficer.landline ?? '',
    },
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const asked = REGISTRATION_ASKED.includes(v.entityType);

  /** Each problem's path to its message; a path with no key keeps the server's own text. */
  const toErrors = (issues: Array<{ path: string; message: string }>) => {
    const out: Record<string, string> = {};
    for (const issue of issues) {
      if (out[issue.path]) continue;
      const key = MESSAGE_KEY[issue.path];
      out[issue.path] = key ? t(key) : issue.message;
    }
    return out;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = updateComplianceInfoInputSchema.safeParse({
      entityName: v.entityName.trim(),
      entityType: v.entityType,
      ...(v.entityType === 'OTHER' ? { entityTypeCustom: v.entityTypeCustom.trim() } : {}),
      ...(asked && v.isRegistered !== null ? { isRegistered: v.isRegistered } : {}),
      customerCare: trimContact(v.customerCare),
      grievanceOfficer: {
        name: v.grievanceOfficer.name.trim(),
        ...trimContact(v.grievanceOfficer),
      },
    });
    setMsg(null);
    if (!parsed.success) {
      setErrors(
        toErrors(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))),
      );
      return;
    }
    setErrors({});
    update.mutate(parsed.data, {
      onSuccess: () => setMsg({ tone: 'success', text: t('complianceSaved') }),
      onError: (err) => {
        const et = errorText(err);
        if (et.fieldErrors.length) setErrors(toErrors(et.fieldErrors));
        setMsg({ tone: 'danger', text: et.text });
      },
    });
  };

  const setCare = (field: ContactField, value: string) =>
    setV((s) => ({ ...s, customerCare: { ...s.customerCare, [field]: value } }));
  const setOfficer = (field: ContactField | 'name', value: string) =>
    setV((s) => ({ ...s, grievanceOfficer: { ...s.grievanceOfficer, [field]: value } }));

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {msg && (
        <div className="sm:col-span-2">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label={t('legalName')} htmlFor="cp-name" error={errors.entityName}>
          <Input
            id="cp-name"
            placeholder={t('legalNamePlaceholder')}
            value={v.entityName}
            onChange={(e) => setV((s) => ({ ...s, entityName: e.target.value }))}
            invalid={!!errors.entityName}
          />
        </Field>
      </div>
      <Field label={t('businessType')} htmlFor="cp-type">
        <Select
          id="cp-type"
          value={v.entityType}
          onChange={(e) => setV((s) => ({ ...s, entityType: e.target.value as WabaEntityType }))}
        >
          {WABA_ENTITY_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`entityType.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      {v.entityType === 'OTHER' && (
        <Field
          label={t('businessTypeCustom')}
          htmlFor="cp-type-custom"
          error={errors.entityTypeCustom}
        >
          <Input
            id="cp-type-custom"
            maxLength={128}
            value={v.entityTypeCustom}
            onChange={(e) => setV((s) => ({ ...s, entityTypeCustom: e.target.value }))}
            invalid={!!errors.entityTypeCustom}
          />
        </Field>
      )}
      {asked && (
        <fieldset className="sm:col-span-2 space-y-2">
          <legend className="font-medium">{t('registered')}</legend>
          <div className="flex gap-6">
            {[true, false].map((answer) => (
              <label key={String(answer)} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cp-registered"
                  checked={v.isRegistered === answer}
                  onChange={() => setV((s) => ({ ...s, isRegistered: answer }))}
                />
                {t(answer ? 'registeredYes' : 'registeredNo')}
              </label>
            ))}
          </div>
          {errors.isRegistered && (
            <p role="alert" className="text-xs text-danger">
              {errors.isRegistered}
            </p>
          )}
        </fieldset>
      )}
      <fieldset className="sm:col-span-2 grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
        <legend className="px-1 font-medium">{t('careTitle')}</legend>
        <p className="text-xs text-muted-foreground sm:col-span-2">{t('careHint')}</p>
        {errors.customerCare && (
          <p role="alert" className="text-xs text-danger sm:col-span-2">
            {errors.customerCare}
          </p>
        )}
        {CONTACT_FIELDS.map((field) => (
          <Field
            key={field}
            label={t(field)}
            htmlFor={`cp-care-${field}`}
            hint={field === 'email' ? undefined : t('phoneHint')}
            error={errors[`customerCare.${field}`]}
          >
            <Input
              id={`cp-care-${field}`}
              type={field === 'email' ? 'email' : 'tel'}
              dir="ltr"
              value={v.customerCare[field]}
              onChange={(e) => setCare(field, e.target.value)}
              invalid={!!errors[`customerCare.${field}`]}
            />
          </Field>
        ))}
      </fieldset>
      <fieldset className="sm:col-span-2 grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
        <legend className="px-1 font-medium">{t('officerTitle')}</legend>
        <p className="text-xs text-muted-foreground sm:col-span-2">{t('officerHint')}</p>
        {errors.grievanceOfficer && (
          <p role="alert" className="text-xs text-danger sm:col-span-2">
            {errors.grievanceOfficer}
          </p>
        )}
        <div className="sm:col-span-2">
          <Field
            label={t('officerName')}
            htmlFor="cp-officer-name"
            error={errors['grievanceOfficer.name']}
          >
            <Input
              id="cp-officer-name"
              value={v.grievanceOfficer.name}
              onChange={(e) => setOfficer('name', e.target.value)}
              invalid={!!errors['grievanceOfficer.name']}
            />
          </Field>
        </div>
        {CONTACT_FIELDS.map((field) => (
          <Field
            key={field}
            label={t(field)}
            htmlFor={`cp-officer-${field}`}
            hint={field === 'email' ? undefined : t('phoneHint')}
            error={errors[`grievanceOfficer.${field}`]}
          >
            <Input
              id={`cp-officer-${field}`}
              type={field === 'email' ? 'email' : 'tel'}
              dir="ltr"
              value={v.grievanceOfficer[field]}
              onChange={(e) => setOfficer(field, e.target.value)}
              invalid={!!errors[`grievanceOfficer.${field}`]}
            />
          </Field>
        ))}
      </fieldset>
      <div className="flex items-end sm:col-span-2">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('savingCompliance') : t('saveCompliance')}
        </Button>
      </div>
    </form>
  );
}

function trimContact(c: Contact): Contact {
  return { email: c.email.trim(), mobile: c.mobile.trim(), landline: c.landline.trim() };
}
