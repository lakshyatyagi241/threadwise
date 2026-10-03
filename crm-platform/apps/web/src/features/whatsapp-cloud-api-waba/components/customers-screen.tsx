'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CustomerProfile } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, EmptyState, Field, Input, Spinner, Textarea } from '@crm/ui';
import { useCustomers, useRemoveCustomer, useSaveCustomer } from '../api/hooks';
import { useErrorText } from './use-error-text';

type Notice = { tone: 'success' | 'danger'; text: string };
const BLANK = { phone: '', name: '', company: '', address: '' };

/** WD-WABA-055, 056: the shop's saved customers: add or edit by phone, search, remove. */
export function CustomersScreen() {
  const t = useTranslations('whatsapp-cloud-api-waba.customers');
  const tc = useTranslations('whatsapp-cloud-api-waba.common');
  const errorText = useErrorText();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useCustomers(q.trim(), page);
  const save = useSaveCustomer();
  const remove = useRemoveCustomer();

  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<CustomerProfile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [phoneError, setPhoneError] = useState(false);

  const items = list.data?.items ?? [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const set = (k: keyof typeof BLANK) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const clear = () => {
    setForm(BLANK);
    setEditing(null);
    setPhoneError(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/\d/.test(form.phone)) return setPhoneError(true);
    setPhoneError(false);
    save.mutate(form, {
      onSuccess: () => {
        clear();
        setNotice({ tone: 'success', text: t('saved') });
      },
      onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
    });
  };

  const edit = (c: CustomerProfile) => {
    setEditing(c.id);
    setForm({
      phone: c.phone,
      name: c.name ?? '',
      company: c.company ?? '',
      address: c.address ?? '',
    });
    setNotice(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      {notice && (
        <Alert tone={notice.tone}>
          <div className="flex items-start justify-between gap-2">
            <div>{notice.text}</div>
            <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
              {tc('dismiss')}
            </button>
          </div>
        </Alert>
      )}

      <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4" noValidate>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{editing ? t('formEdit') : t('formAdd')}</h2>
          {editing && (
            <Button type="button" variant="ghost" onClick={clear}>
              {t('clear')}
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t('phone')}
            htmlFor="cust-phone"
            hint={t('phoneHint')}
            error={phoneError ? t('invalidPhone') : undefined}
          >
            <Input
              id="cust-phone"
              value={form.phone}
              inputMode="tel"
              maxLength={32}
              onChange={(e) => set('phone')(e.target.value)}
            />
          </Field>
          <Field label={t('name')} htmlFor="cust-name">
            <Input
              id="cust-name"
              value={form.name}
              maxLength={191}
              onChange={(e) => set('name')(e.target.value)}
            />
          </Field>
          <Field label={t('company')} htmlFor="cust-company">
            <Input
              id="cust-company"
              value={form.company}
              maxLength={191}
              onChange={(e) => set('company')(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('address')} htmlFor="cust-address">
          <Textarea
            id="cust-address"
            rows={3}
            value={form.address}
            maxLength={2000}
            onChange={(e) => set('address')(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
      </form>

      <div className="space-y-3">
        <Input
          aria-label={t('searchLabel')}
          placeholder={t('search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {list.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : list.isError ? (
          <Alert tone="danger">
            {t('loadFailed')}{' '}
            <button type="button" className="underline" onClick={() => list.refetch()}>
              {t('retry')}
            </button>
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-start">
                  <tr>
                    <th className="p-3 text-start font-medium">{t('colCustomer')}</th>
                    <th className="p-3 text-start font-medium">{t('colAddress')}</th>
                    <th className="p-3 text-start font-medium">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className="border-t border-border align-top">
                      <td className="p-3">
                        <div className="font-medium">{c.name ?? '—'}</div>
                        {c.company && <div className="text-muted-foreground">{c.company}</div>}
                        <div className="text-muted-foreground">+{c.phone}</div>
                      </td>
                      <td className="whitespace-pre-line p-3">{c.address ?? '—'}</td>
                      <td className="p-3">
                        <div className="flex gap-3">
                          <button type="button" className="underline" onClick={() => edit(c)}>
                            {t('edit')}
                          </button>
                          <button
                            type="button"
                            className="text-danger underline"
                            onClick={() => setPending(c)}
                          >
                            {t('delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{t('total', { count: list.data?.total ?? 0 })}</span>
              <div className="flex items-center gap-3">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t('prev')}
                </Button>
                <span>{t('page', { page, pages })}</span>
                <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  {t('next')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={t('confirmTitle')}
        message={t('confirmMessage')}
        confirmLabel={t('confirmDelete')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() =>
          pending &&
          remove.mutate(pending.id, {
            onSuccess: () => {
              if (editing === pending.id) clear();
              setPending(null);
              setNotice({ tone: 'success', text: t('removed') });
            },
            onError: (err) => {
              setPending(null);
              setNotice({ tone: 'danger', text: errorText(err).text });
            },
          })
        }
        onClose={() => setPending(null)}
      />
    </div>
  );
}
