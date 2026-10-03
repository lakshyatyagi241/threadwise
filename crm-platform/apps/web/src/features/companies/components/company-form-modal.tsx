'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { companiesApi, invalidateCompanies, useMembers } from '../api/companies';
import type { CompanyResponse } from '../api/schemas';
import { errorKind, fieldErrors } from '../lib/errors';
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

export interface CompanyFormModalProps {
  /** Present: edit this company. Absent: create. */
  company?: CompanyResponse;
  onClose: () => void;
  onSaved?: (company: CompanyResponse) => void;
}

type FormKey = keyof CompanyFormValues | 'form';

/**
 * "New company" and "Edit company" (WD-CTP-003/004). WaDesk's modal has a name, an industry, a website, an email, a phone and notes;
 * the size, the address and the owner sit under "More details" (WaDesk stored them but showed no way to set them). Mount it
 * only while it is open: it starts from the company every time.
 */
export function CompanyFormModal({ company, onClose, onSaved }: CompanyFormModalProps) {
  const t = useTranslations('companies.form');
  const toastText = useTranslations('companies.toast');
  const tErr = useTranslations('companies.errors');
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
  const set = <K extends keyof CompanyFormValues>(k: K, v: CompanyFormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));

  const problem = (kind: FormErrorKind | undefined, limit?: number) =>
    kind ? t(`problems.${kind}`, { limit: limit ?? 0 }) : undefined;

  async function submit() {
    const found = validate(values);
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
        const patch = toUpdateInput(values, company);
        if (patch === null) {
          onClose();
          return;
        }
        saved = await companiesApi.update(company.id, patch);
      } else {
        saved = await companiesApi.create(toCreateInput(values));
      }
      await invalidateCompanies(qc, saved.id);
      toast(toastText(editing ? 'updated' : 'created'), 'success');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      const server = fieldErrors(e);
      const kind = errorKind(e);
      if (kind === 'conflict' && company) void invalidateCompanies(qc, company.id);
      setErrors({
        name: server.name ? t('problems.required') : undefined,
        email: server.email ? t('problems.email') : undefined,
        ownerId: kind === 'ownerInvalid' ? t('problems.ownerInvalid') : undefined,
        form:
          Object.keys(server).length === 0 && kind !== 'ownerInvalid'
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
          <Button variant="brand" onClick={() => void submit()} disabled={busy}>
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
      </form>
    </Modal>
  );
}
