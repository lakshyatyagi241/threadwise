'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { contactLabel, type ContactHit, type Ref } from '../api/schemas';
import { salesDocsApi } from '../api/service';
import { errorKind, fieldErrors } from '../lib/errors';
import { CloseIcon, ContactIcon, DealIcon, PlusIcon } from './icons';

/** What picking a contact hands back: the link, and the contact's own details to fill the buyer fields with. */
export interface PickedContact {
  ref: Ref;
  email: string;
  phone: string;
}

interface Props {
  kind: 'contact' | 'deal';
  value: Ref | null;
  onChange: (next: Ref | null, hit?: PickedContact) => void;
  disabled?: boolean;
  id?: string;
  /** Contact only: offer to create the contact from what was typed. */
  allowCreate?: boolean;
}

/**
 * Links a contact or a deal: search by name (250 ms after typing stops), pick one, or clear the link. For a contact, the
 * list ends with "Create contact": the buyer does not have to exist yet.
 */
export function RecordPicker({ kind, value, onChange, disabled, id, allowCreate }: Props) {
  const t = useTranslations('sales-docs.picker');
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const Icon = kind === 'contact' ? ContactIcon : DealIcon;

  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text), 250);
    return () => window.clearTimeout(h);
  }, [text]);

  const hits = useQuery({
    queryKey: ['sales-docs', 'search', kind, term],
    queryFn: async ({
      signal,
    }): Promise<Array<{ ref: Ref; hint: string; email: string; phone: string }>> =>
      kind === 'contact'
        ? (await salesDocsApi.searchContacts(term, signal)).map((c) => ({
            ref: { id: c.id, name: contactLabel(c) },
            hint: c.phone ?? c.email ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
          }))
        : (await salesDocsApi.searchDeals(term, signal)).map((d) => ({
            ref: { id: d.id, name: d.title },
            hint: d.contact?.name ?? '',
            email: '',
            phone: '',
          })),
    enabled: open && !value,
    retry: false,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{value.name || t('unnamed')}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t(kind === 'contact' ? 'unlinkContact' : 'unlinkDeal')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={text}
        disabled={disabled}
        placeholder={t(kind === 'contact' ? 'searchContact' : 'searchDeal')}
        aria-label={t(kind === 'contact' ? 'searchContact' : 'searchDeal')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('results')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 min-w-56 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {hits.isFetching && (
            <li className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Spinner /> {t('searching')}
            </li>
          )}
          {!hits.isFetching && hits.isError && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('unavailable')}</li>
          )}
          {!hits.isFetching && !hits.isError && (hits.data?.length ?? 0) === 0 && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('none')}</li>
          )}
          {!hits.isFetching &&
            (hits.data ?? []).map((r) => (
              <li key={r.ref.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  // mousedown fires before the input's blur closes the list
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(r.ref, { ref: r.ref, email: r.email, phone: r.phone });
                    setText('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm hover:bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r.ref.name}</span>
                  {r.hint && (
                    <span className="shrink-0 text-xs text-muted-foreground">{r.hint}</span>
                  )}
                </button>
              </li>
            ))}
          {allowCreate && (
            <li role="option" aria-selected={false} className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm font-medium text-brand hover:bg-muted dark:text-primary"
              >
                <PlusIcon /> {text.trim() ? t('createNamed', { name: text.trim() }) : t('create')}
              </button>
            </li>
          )}
        </ul>
      )}
      {allowCreate && (
        <CreateContactModal
          open={creating}
          initialName={text.trim()}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            const ref = { id: c.id, name: contactLabel(c) };
            onChange(ref, { ref, email: c.email ?? '', phone: c.phone ?? '' });
            setText('');
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

/** The buyer is not a contact yet: name (required), email and phone, saved to Contacts and linked in one step. */
function CreateContactModal({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onCreated: (c: ContactHit) => void;
}) {
  const t = useTranslations('sales-docs.picker');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('createTitle')}
      eyebrow={t('createEyebrow')}
      closeLabel={t('close')}
    >
      {/* mounted only while open, so every opening starts from a blank form */}
      {open && (
        <CreateContactForm
          initialName={initialName}
          onBusy={setBusy}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Modal>
  );
}

function CreateContactForm({
  initialName,
  onBusy,
  onClose,
  onCreated,
}: {
  initialName: string;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onCreated: (c: ContactHit) => void;
}) {
  const t = useTranslations('sales-docs.picker');
  const base = useId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () =>
      salesDocsApi.createContact({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      }),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      toast(t('contactCreated', { name: contactLabel(c) }), 'success');
      onCreated(c);
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      setErrors({
        name: fe.name ? t('nameInvalid') : '',
        email: fe.email ? t('emailInvalid') : '',
        phone: fe.phone ? t('phoneInvalid') : '',
        form: Object.keys(fe).length
          ? ''
          : errorKind(e) === 'forbidden'
            ? t('forbidden')
            : t('createFailed'),
      });
    },
  });

  const emailBad = !!email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSubmit = !!name.trim() && !emailBad && !create.isPending;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) create.mutate();
      }}
    >
      <Field label={t('nameLabel')} htmlFor={`${base}-name`} error={errors.name}>
        <Input
          id={`${base}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          autoFocus
        />
      </Field>
      <Field
        label={t('emailLabel')}
        htmlFor={`${base}-email`}
        error={errors.email || (emailBad ? t('emailInvalid') : undefined)}
      >
        <Input
          id={`${base}-email`}
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field
        label={t('phoneLabel')}
        htmlFor={`${base}-phone`}
        error={errors.phone}
        hint={t('phoneHint')}
      >
        <Input
          id={`${base}-phone`}
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      {errors.form && (
        <p role="alert" className="text-sm text-danger">
          {errors.form}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="brand" disabled={!canSubmit}>
          {create.isPending && <Spinner />} {t('createConfirm')}
        </Button>
      </div>
    </form>
  );
}
