'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { StoreCustomer } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Spinner, Textarea, useToast } from '@crm/ui';
import { useSaveCustomer, useUpdateCustomer } from '../api/hooks';
import {
  customerToForm,
  emptyCustomerForm,
  toSaveInput,
  toUpdateInput,
  validateCustomerForm,
  type CustomerForm,
  type CustomerProblems,
} from '../lib/customer-form';
import { fieldErrors } from '../lib/errors';
import { useErrorLine } from './parts';

/**
 * Add a saved customer (saved by phone: an existing phone is updated) or edit one (the phone is the key and cannot change).
 * Mount it only while it is open.
 */
export function CustomerFormModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: StoreCustomer | null;
  onClose: () => void;
  onSaved?: (c: StoreCustomer) => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.customers');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const errorLine = useErrorLine();
  const { toast } = useToast();
  const save = useSaveCustomer();
  const update = useUpdateCustomer(customer?.id ?? '');
  const editing = customer !== null;
  const [form, setForm] = useState<CustomerForm>(() =>
    customer ? customerToForm(customer) : emptyCustomerForm(),
  );
  const [problems, setProblems] = useState<CustomerProblems>({});
  const [server, setServer] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const pending = save.isPending || update.isPending;

  const set = (key: keyof CustomerForm, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setProblems((p) => ({ ...p, [key]: undefined }));
    setServer((s) => ({ ...s, [key]: '' }));
  };
  const phoneProblem = problems.phone ? t(`problems.${problems.phone}`) : server.phone || undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validateCustomerForm(form, editing);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setFailure(null);
    const options = {
      onSuccess: (saved: StoreCustomer) => {
        toast(editing ? t('updated') : t('saved'), 'success');
        onSaved?.(saved);
        onClose();
      },
      onError: (err: unknown) => {
        setServer(fieldErrors(err));
        setFailure(errorLine(err));
      },
    };
    if (customer) update.mutate(toUpdateInput(form, customer.rowVersion), options);
    else save.mutate(toSaveInput(form), options);
  };

  const FORM_ID = 'customer-form';
  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!pending) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={editing ? t('formTitleEdit') : t('formTitleAdd')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={pending}>
            {pending && <Spinner />}
            {t('save')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
        {failure && <Alert tone="danger">{failure}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t('phone')}
            htmlFor="cust-phone"
            hint={editing ? t('phoneLockedHint') : t('phoneHint')}
            error={phoneProblem}
          >
            <Input
              id="cust-phone"
              dir="ltr"
              value={form.phone}
              inputMode="tel"
              maxLength={32}
              readOnly={editing}
              autoComplete="off"
              invalid={Boolean(phoneProblem)}
              className={editing ? 'bg-muted text-muted-foreground' : undefined}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label={t('name')} htmlFor="cust-name" error={server.name || undefined}>
            <Input
              id="cust-name"
              value={form.name}
              maxLength={191}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field
            label={t('company')}
            htmlFor="cust-company"
            error={server.company || undefined}
            className="sm:col-span-2"
          >
            <Input
              id="cust-company"
              value={form.company}
              maxLength={191}
              onChange={(e) => set('company', e.target.value)}
            />
          </Field>
        </div>
        <Field
          label={t('address')}
          htmlFor="cust-address"
          hint={t('addressHint')}
          error={server.address || undefined}
        >
          <Textarea
            id="cust-address"
            rows={4}
            value={form.address}
            maxLength={2000}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
