'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Input, Spinner, cn } from '@crm/ui';
import { COLLECTION_DESCRIPTION_MAX, COLLECTION_NAME_MAX } from '@crm/contracts';
import { fieldErrors, isRowVersionConflict } from '../lib/errors';
import {
  COLLECTION_MAX_PRODUCTS,
  collectionProblems,
  filterPick,
  togglePick,
  type CollectionForm,
  type PickItem,
} from '../lib/collection-model';
import { CheckIcon, SearchIcon } from './icons';
import { ErrorLine, KICKER, ProductThumb, TEXT_LINK } from './parts';
import { useErrorText } from './use-error-text';

/** The product checkbox grid of a collection form: a filter box, the n/30 counter and one card per product. */
function CollectionPicker({
  items,
  selected,
  onChange,
  id,
}: {
  items: PickItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  id: string;
}) {
  const t = useTranslations('catalogProducts.collections.picker');
  const [q, setQ] = useState('');
  const [refused, setRefused] = useState(false);
  const shown = filterPick(items, q);
  const chosen = new Set(selected);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('filter')}
          aria-label={t('filter')}
          className="flex-1 bg-transparent text-[12px] outline-none"
        />
        <span
          aria-live="polite"
          className={cn(
            'font-mono text-[10.5px]',
            refused ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {selected.length}/{COLLECTION_MAX_PRODUCTS}
        </span>
      </div>
      <ul
        id={id}
        className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto p-2 sm:grid-cols-3 lg:grid-cols-4"
      >
        {shown.map((p) => (
          <li key={p.id}>
            <label className="relative block cursor-pointer">
              <input
                type="checkbox"
                checked={chosen.has(p.id)}
                onChange={() => {
                  const out = togglePick(selected, p.id);
                  setRefused(out.refused);
                  onChange(out.selected);
                }}
                className="peer sr-only"
              />
              <span className="block rounded-lg border border-border p-2 transition hover:bg-muted peer-checked:border-brand peer-checked:ring-1 peer-checked:ring-brand/40 peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                <span className="mb-1.5 block aspect-square overflow-hidden rounded-md bg-muted">
                  <ProductThumb url={p.imageUrl} size="size-full" className="rounded-none" />
                </span>
                <span className="line-clamp-2 block text-[11px] font-medium leading-tight">
                  {p.name}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                  {p.priceDisplay}
                </span>
              </span>
              {chosen.has(p.id) && (
                <span className="absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-brand text-brand-foreground">
                  <CheckIcon className="size-2.5" strokeWidth={2.4} />
                </span>
              )}
            </label>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="col-span-full py-6 text-center text-[12px] text-muted-foreground">
            {items.length === 0 ? (
              <>
                {t('empty')}{' '}
                <Link href="/store/products/create" className={TEXT_LINK}>
                  {t('addOne')}
                </Link>
              </>
            ) : (
              t('noMatch')
            )}
          </li>
        )}
      </ul>
      {refused && (
        <p role="alert" className="border-t border-border px-3 py-1.5 text-[11px] text-danger">
          {t('max', { max: COLLECTION_MAX_PRODUCTS })}
        </p>
      )}
    </div>
  );
}

/**
 * The create and edit form of a collection (WD-CAT-017, 018): name, description and the product picker. A stale edit
 * (someone saved first) asks for a reload instead of overwriting.
 */
export function CollectionEditor({
  initial,
  items,
  submitLabel,
  idPrefix,
  onSubmit,
  onReload,
}: {
  initial: CollectionForm;
  items: PickItem[];
  submitLabel: string;
  idPrefix: string;
  /** Throws on failure; the editor shows the reason and keeps what was typed. */
  onSubmit: (form: CollectionForm) => Promise<void>;
  /** Shown with a row-version conflict: re-read the collection and reset the form. */
  onReload?: () => void;
}) {
  const t = useTranslations('catalogProducts.collections.form');
  const errorText = useErrorText();
  const [form, setForm] = useState<CollectionForm>(initial);
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const patch = (p: Partial<CollectionForm>) => setForm((f) => ({ ...f, ...p }));

  const problems = collectionProblems(form);
  const server = fieldErrors(error);
  const nameError = picked && problems.find((p) => p === 'nameRequired' || p === 'nameTooLong');
  const descError = picked && problems.includes('descriptionTooLong');
  const conflict = error !== null && isRowVersionConflict(error);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPicked(true);
    setError(null);
    if (problems.length > 0) {
      // the first thing to fix gets focus: the name, then the description, then the product grid
      const target = problems.some((p) => p === 'nameRequired' || p === 'nameTooLong')
        ? `${idPrefix}-name`
        : problems.includes('descriptionTooLong')
          ? `${idPrefix}-description`
          : null;
      (target
        ? document.getElementById(target)
        : document.querySelector<HTMLElement>(`#${CSS.escape(`${idPrefix}-picker`)} input`)
      )?.focus();
      return;
    }
    setBusy(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err);
      const fields = fieldErrors(err);
      const id =
        'name' in fields
          ? `${idPrefix}-name`
          : 'description' in fields
            ? `${idPrefix}-description`
            : null;
      if (id) document.getElementById(id)?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={<span className={KICKER}>{t('name')}</span>}
          htmlFor={`${idPrefix}-name`}
          error={nameError ? t(`problem.${nameError}`) : server.name}
        >
          <Input
            id={`${idPrefix}-name`}
            value={form.name}
            maxLength={COLLECTION_NAME_MAX}
            required
            placeholder={t('namePlaceholder')}
            invalid={Boolean(nameError || server.name)}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field
          label={<span className={KICKER}>{t('description')}</span>}
          htmlFor={`${idPrefix}-description`}
          error={descError ? t('problem.descriptionTooLong') : server.description}
        >
          <Input
            id={`${idPrefix}-description`}
            value={form.description}
            maxLength={COLLECTION_DESCRIPTION_MAX}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
      </div>

      <div>
        <span className={`${KICKER} mb-1.5 block`}>
          {t('products')}{' '}
          <span className="normal-case tracking-normal">
            ({t('upTo', { max: COLLECTION_MAX_PRODUCTS })})
          </span>
        </span>
        <CollectionPicker
          id={`${idPrefix}-picker`}
          items={items}
          selected={form.productIds}
          onChange={(productIds) => patch({ productIds })}
        />
        {picked && problems.includes('noProducts') && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {t('problem.noProducts')}
          </p>
        )}
      </div>

      {conflict ? (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{errorText(error)}</span>
          {onReload && (
            <Button size="sm" variant="secondary" onClick={onReload}>
              {t('reload')}
            </Button>
          )}
        </Alert>
      ) : error ? (
        <ErrorLine>{errorText(error)}</ErrorLine>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="brand"
          className="rounded-full px-4 text-[12.5px]"
          disabled={busy}
        >
          {busy && <Spinner />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
