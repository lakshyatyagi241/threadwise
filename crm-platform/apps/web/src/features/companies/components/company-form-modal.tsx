'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
// The shared property inputs come from their own file, not the contacts domain's index (see `lib/properties.ts`).
import { attributesAfterChange } from '@/features/contacts-attributes-tags/lib/cascade';
import { CustomFieldsSection } from '@/features/contacts-attributes-tags/components/custom-fields-section';
import { companiesApi, invalidateCompanies, useMembers } from '../api/companies';
import { useCompanyProperties } from '../api/properties';
import type { CompanyResponse } from '../api/schemas';
import { errorKind, fieldErrors, propertyErrorKind } from '../lib/errors';
import {
  EMPTY_FORM,
  LIMITS,
  fromCompany,
  toCreateInput,
  toUpdateInput,
  validate,
  type CompanyFormValues,
  type FormErrorKind,
} from '../lib/form';
import {
  createValues,
  inputsOf,
  propertyProblems,
  updateValues,
  type PropertyInputs,
} from '../lib/properties';

export interface CompanyFormModalProps {
  /** Present: edit this company. Absent: create. */
  company?: CompanyResponse;
  onClose: () => void;
  onSaved?: (company: CompanyResponse) => void;
}

type FormKey = keyof CompanyFormValues | 'form';

/**
 * "New company" and "Edit company" (TW-CTP-003/004). Reference's modal has a name, an industry, a website, an email, a phone and notes;
 * the size, the address and the owner sit under "More details" (Reference stored them but showed no way to set them). Mount it
 * only while it is open: it starts from the company every time.
 */
export function CompanyFormModal({ company, onClose, onSaved }: CompanyFormModalProps) {
  const t = useTranslations('companies.form');
  const toastText = useTranslations('companies.toast');
  const tErr = useTranslations('companies.errors');
  const tProp = useTranslations('companies.form.propertyProblems');
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const members = useMembers();
  const editing = company !== undefined;
  const [values, setValues] = useState<CompanyFormValues>(() =>
    company ? fromCompany(company) : { ...EMPTY_FORM, ownerId: session.user.id },
  );
  const [errors, setErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [busy, setBusy] = useState(false);
  // The workspace's company properties: what the person typed over what the company holds, and the message per property.
  const props = useCompanyProperties();
  const [typed, setTyped] = useState<PropertyInputs>({});
  const [propErrors, setPropErrors] = useState<Record<string, string>>({});
  const inputs: PropertyInputs = {
    ...inputsOf(props.fields, company?.customFields ?? {}),
    ...typed,
  };
  const set = <K extends keyof CompanyFormValues>(k: K, v: CompanyFormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  const problem = (kind: FormErrorKind | undefined, limit?: number) =>
    kind ? t(`problems.${kind}`, { limit: limit ?? 0 }) : undefined;

  async function submit() {
    const found = validate(values);
    const wrong = propertyProblems(props.fields, props.dependencies, inputs);
    setPropErrors(Object.fromEntries(Object.entries(wrong).map(([k, kind]) => [k, tProp(kind)])));
    if (Object.keys(wrong).length > 0 && Object.keys(found).length === 0) {
      document.getElementById(`company-prop-${Object.keys(wrong)[0]}`)?.focus();
      return;
    }
    if (Object.keys(found).length > 0) {
      setErrors(
        Object.fromEntries(
          Object.entries(found).map(([k, kind]) => [
            k,
            problem(kind, k in LIMITS ? LIMITS[k as keyof typeof LIMITS] : undefined),
          ]),
        ),
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      let saved: CompanyResponse;
      if (company) {
        const own = updateValues(props.fields, props.dependencies, inputs, company.customFields);
        const fieldsPatch = toUpdateInput(values, company);
        if (fieldsPatch === null && own === null) {
          onClose();
          return;
        }
        saved = await companiesApi.update(company.id, {
          ...(fieldsPatch ?? { rowVersion: company.rowVersion }),
          ...(own ? { customFields: own } : {}),
        });
      } else {
        const own = createValues(props.fields, props.dependencies, inputs);
        saved = await companiesApi.create({
          ...toCreateInput(values),
          ...(Object.keys(own).length > 0 ? { customFields: own } : {}),
        });
      }
      await invalidateCompanies(qc, saved.id);
      toast(toastText(editing ? 'updated' : 'created'), 'success');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      const server = fieldErrors(e);
      const kind = errorKind(e);
      if (kind === 'conflict' && company) void invalidateCompanies(qc, company.id);
      const why = propertyErrorKind(e);
      if (why) {
        setPropErrors(
          Object.fromEntries(
            Object.keys(server)
              .filter((k) => k.startsWith('customFields.'))
              .map((k) => [k.slice('customFields.'.length), tProp(why)]),
          ),
        );
      }
      setErrors({
        name: server.name ? t('problems.required') : undefined,
        email: server.email ? t('problems.email') : undefined,
        ownerId: kind === 'ownerInvalid' ? t('problems.ownerInvalid') : undefined,
        form:
          Object.keys(server).length === 0 && kind !== 'ownerInvalid' && !why
            ? tErr(kind)
            : server.phone ||
                server.website ||
                server.industry ||
                server.sizeRange ||
                server.address ||
                server.notes
              ? t('problems.invalid')
              : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const people = members.data ?? [];
  const ownerKnown = !values.ownerId || people.some((m) => m.id === values.ownerId);

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={editing ? t('editTitle') : t('newTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy || props.loading}>
            {busy && <Spinner />}
            {editing ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {errors.form && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errors.form}
          </p>
        )}
        <Field
          label={t('name')}
          htmlFor="company-name"
          error={errors.name}
          className="sm:col-span-2"
        >
          <Input
            id="company-name"
            autoFocus
            required
            maxLength={LIMITS.name}
            value={values.name}
            invalid={!!errors.name}
            placeholder={t('namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field label={t('industry')} htmlFor="company-industry" error={errors.industry}>
          <Input
            id="company-industry"
            maxLength={LIMITS.industry}
            value={values.industry}
            invalid={!!errors.industry}
            onChange={(e) => set('industry', e.target.value)}
          />
        </Field>
        <Field label={t('website')} htmlFor="company-website" error={errors.website}>
          <Input
            id="company-website"
            dir="ltr"
            maxLength={LIMITS.website}
            value={values.website}
            invalid={!!errors.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </Field>
        <Field label={t('email')} htmlFor="company-email" error={errors.email}>
          <Input
            id="company-email"
            type="email"
            dir="ltr"
            maxLength={LIMITS.email}
            value={values.email}
            invalid={!!errors.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
        <Field label={t('phone')} htmlFor="company-phone" error={errors.phone}>
          <Input
            id="company-phone"
            type="tel"
            dir="ltr"
            maxLength={LIMITS.phone}
            value={values.phone}
            invalid={!!errors.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>
        <Field
          label={t('notes')}
          htmlFor="company-notes"
          error={errors.notes}
          className="sm:col-span-2"
        >
          <Textarea
            id="company-notes"
            rows={2}
            maxLength={LIMITS.notes}
            value={values.notes}
            invalid={!!errors.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
        <details className="group sm:col-span-2" open={editing}>
          <summary className="cursor-pointer text-sm font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary">
            {t('moreDetails')}
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label={t('sizeRange')}
              htmlFor="company-size"
              error={errors.sizeRange}
              hint={t('sizeHint')}
            >
              <Input
                id="company-size"
                maxLength={LIMITS.sizeRange}
                value={values.sizeRange}
                invalid={!!errors.sizeRange}
                onChange={(e) => set('sizeRange', e.target.value)}
              />
            </Field>
            <Field label={t('owner')} htmlFor="company-owner" error={errors.ownerId}>
              <Select
                id="company-owner"
                value={values.ownerId}
                invalid={!!errors.ownerId}
                onChange={(e) => set('ownerId', e.target.value)}
              >
                <option value="">{t('noOwner')}</option>
                {!ownerKnown && company?.owner && (
                  <option value={company.owner.id}>{company.owner.name}</option>
                )}
                {people.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === session.user.id ? t('me', { name: m.fullName }) : m.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('address')}
              htmlFor="company-address"
              error={errors.address}
              className="sm:col-span-2"
            >
              <Textarea
                id="company-address"
                rows={2}
                maxLength={LIMITS.address}
                value={values.address}
                invalid={!!errors.address}
                onChange={(e) => set('address', e.target.value)}
              />
            </Field>
          </div>
        </details>
        {props.fields.length > 0 && (
          <div className="sm:col-span-2">
            <CustomFieldsSection
              fields={props.fields}
              sections={props.sections}
              dependencies={props.dependencies}
              optionDependencies={props.optionDependencies}
              values={inputs}
              errors={propErrors}
              idPrefix="company"
              looseTitle={t('propertiesTitle')}
              hint={t('propertiesHint')}
              onChange={(key, value) => {
                // While the cascades load, nothing can be told apart from "no cascade": no value is cleared on that account.
                setTyped((cur) =>
                  props.loading
                    ? { ...cur, [key]: value }
                    : attributesAfterChange(
                        inputs,
                        key,
                        value,
                        props.fields,
                        props.dependencies,
                        props.optionDependencies,
                      ),
                );
                setPropErrors(({ [key]: _gone, ...rest }) => rest);
              }}
            />
          </div>
        )}
      </form>
    </Modal>
  );
}
