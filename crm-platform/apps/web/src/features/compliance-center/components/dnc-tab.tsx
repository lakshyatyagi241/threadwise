'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { DNC_ADD_MAX, type DncAddResult } from '@crm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Spinner,
  Textarea,
  useToast,
} from '@crm/ui';
import { KEYS, useDncList } from '../api/hooks';
import { complianceApi } from '../api/service';
import { splitDncCsv } from '../lib/dnc-file';
import { errorKey } from '../lib/errors';
import { CARD } from './fields';

const empty: DncAddResult = { added: 0, alreadyListed: 0, invalid: 0, invalidSamples: [] };
const sum = (a: DncAddResult, b: DncAddResult): DncAddResult => ({
  added: a.added + b.added,
  alreadyListed: a.alreadyListed + b.alreadyListed,
  invalid: a.invalid + b.invalid,
  invalidSamples: [...a.invalidSamples, ...b.invalidSamples].slice(0, 10),
});

/**
 * The Do-Not-Call list (BL-181, spec docs/specs/privacy-and-data-governance.md 11.11): numbers that get no marketing by voice or SMS.
 * Added by hand, pasted, or from a CSV; the ConsentGate reads it. Nothing is checked against a national registry from here: a workspace
 * loads the extract it is entitled to download (source "registry extract").
 */
export function DncTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations('compliance-center.dnc');
  const te = useTranslations('compliance-center.errors');
  const f = useFormatter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const list = useDncList(true, q, cursor);
  const [numbers, setNumbers] = useState('');
  const [country, setCountry] = useState('');
  const [note, setNote] = useState('');
  const [fromRegistry, setFromRegistry] = useState(false);
  const [result, setResult] = useState<DncAddResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<{ id: string; phone: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (r: DncAddResult) => {
    setResult(r);
    setError(null);
    setCursors([]);
    void qc.invalidateQueries({ queryKey: KEYS.dnc });
    void qc.invalidateQueries({ queryKey: KEYS.checklist });
    toast(t('added', { count: r.added }), 'success');
  };

  const add = useMutation({
    mutationFn: async () => {
      const all = numbers
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      let total = empty;
      for (let i = 0; i < all.length; i += DNC_ADD_MAX) {
        total = sum(
          total,
          await complianceApi.addDnc({
            numbers: all.slice(i, i + DNC_ADD_MAX),
            defaultCountryCode: country.trim() || undefined,
            source: 'manual',
            note: note.trim() || undefined,
          }),
        );
      }
      return total;
    },
    onSuccess: (r) => {
      setNumbers('');
      done(r);
    },
    onError: (e) => setError(e),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const pieces = splitDncCsv(await file.text());
      let total = empty;
      for (const [i, csv] of pieces.entries()) {
        setProgress({ done: i, of: pieces.length });
        total = sum(
          total,
          await complianceApi.importDnc({
            csv,
            defaultCountryCode: country.trim() || undefined,
            source: fromRegistry ? 'registry_export' : 'import',
            note: note.trim() || undefined,
          }),
        );
      }
      return total;
    },
    onSuccess: done,
    onError: (e) => setError(e),
    onSettled: () => {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => complianceApi.removeDnc(id),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: KEYS.dnc });
      toast(t('removed'), 'success');
    },
    onError: (e) => {
      setRemoving(null);
      setError(e);
    },
  });

  return (
    <div className="space-y-4" data-testid="dnc-tab">
      <Alert tone="info">{t('intro')}</Alert>

      {canManage && (
        <section className={CARD}>
          <h3 className="text-sm font-semibold">{t('addTitle')}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              label={t('numbers')}
              htmlFor="dnc-numbers"
              hint={t('numbersHint', { max: DNC_ADD_MAX })}
            >
              <Textarea
                id="dnc-numbers"
                rows={4}
                dir="ltr"
                value={numbers}
                onChange={(e) => setNumbers(e.target.value)}
              />
            </Field>
            <Field label={t('country')} htmlFor="dnc-country" hint={t('countryHint')}>
              <Input
                id="dnc-country"
                dir="ltr"
                inputMode="tel"
                placeholder="+91"
                maxLength={8}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Field>
            <Field label={t('note')} htmlFor="dnc-note" hint={t('noteHint')}>
              <Input
                id="dnc-note"
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              disabled={numbers.trim() === '' || add.isPending || upload.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? t('adding') : t('add')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('or')}</span>
            <input
              ref={fileRef}
              id="dnc-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
            <Button
              variant="secondary"
              disabled={add.isPending || upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {upload.isPending ? t('importing') : t('import')}
            </Button>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={fromRegistry}
                onChange={(e) => setFromRegistry(e.target.checked)}
              />
              {t('fromRegistry')}
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('importHint')}</p>
          {progress && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {t('progress', { done: progress.done + 1, of: progress.of })}
            </p>
          )}
          {result && (
            <Alert tone="success" className="mt-3" data-testid="dnc-result">
              {t('result', {
                added: result.added,
                already: result.alreadyListed,
                invalid: result.invalid,
              })}
              {result.invalidSamples.length > 0 && (
                <span dir="ltr" className="mt-1 block break-all text-xs">
                  {t('invalidSamples', { samples: result.invalidSamples.join(', ') })}
                </span>
              )}
            </Alert>
          )}
        </section>
      )}

      {error !== null && <Alert tone="danger">{te(errorKey(error))}</Alert>}

      <section className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('listTitle')}</h3>
            <p className="text-xs text-muted-foreground" data-testid="dnc-total">
              {list.data ? t('total', { count: list.data.total }) : ''}
            </p>
          </div>
          <Field label={t('search')} htmlFor="dnc-search">
            <Input
              id="dnc-search"
              dir="ltr"
              inputMode="tel"
              value={q}
              maxLength={40}
              onChange={(e) => {
                setQ(e.target.value);
                setCursors([]);
              }}
            />
          </Field>
        </div>
        {list.isError ? (
          <Alert tone="danger" className="mt-3">
            {te(errorKey(list.error))}
          </Alert>
        ) : !list.data ? (
          <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : list.data.data.length === 0 ? (
          <EmptyState title={q ? t('noMatch') : t('empty')} description={q ? undefined : t('emptyHint')} />
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border" aria-label={t('listTitle')}>
              {list.data.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <span dir="ltr" className="font-medium">
                      {e.phone}
                    </span>
                    <span className="ms-3 text-xs text-muted-foreground">
                      {t(`source.${e.source}`)} ·{' '}
                      {f.dateTime(new Date(e.createdAt), { dateStyle: 'medium' })}
                      {e.addedBy?.name ? ` · ${e.addedBy.name}` : ''}
                    </span>
                    {e.note && <p className="break-words text-xs text-muted-foreground">{e.note}</p>}
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t('removeLabel', { phone: e.phone })}
                      onClick={() => setRemoving({ id: e.id, phone: e.phone })}
                    >
                      {t('remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={cursors.length === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                {t('newer')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!list.data.page.hasMore}
                onClick={() => {
                  const next = list.data?.page.nextCursor;
                  if (next) setCursors((c) => [...c, next]);
                }}
              >
                {t('older')}
              </Button>
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        title={t('confirm.title')}
        message={t('confirm.message', { phone: removing?.phone ?? '' })}
        confirmLabel={t('confirm.confirm')}
        cancelLabel={t('confirm.cancel')}
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

