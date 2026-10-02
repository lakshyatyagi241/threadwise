'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceCurrencyResponse } from '@crm/contracts';
import { Alert, Button, Card, Field, Select, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CURRENCY_KEYS, workspaceCurrencyApi } from '../api';
import { optionLabel } from '../lib/table';
import {
  FOLLOW_DEFAULT,
  OWNER_PERMISSION,
  isDirty,
  selectedValue,
  workspaceBody,
  workspaceErrorKind,
} from '../lib/workspace';

const NS = 'coupons-credits-referral-currency.currencies.workspace';

/** Settings > Currency: the workspace's display currency. Everyone sees it; only the owner can change it. */
export function WorkspaceCurrencyPage() {
  const t = useTranslations(NS);
  const tb = useTranslations('settings');
  const isOwner = useCan(OWNER_PERMISSION);
  const q = useQuery({
    queryKey: CURRENCY_KEYS.workspace,
    queryFn: ({ signal }) => workspaceCurrencyApi.get(signal),
    refetchOnWindowFocus: false,
  });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/settings" className="text-sm font-medium text-muted-foreground hover:underline">
        {tb('backToSettings')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      {q.isPending ? (
        <div
          role="status"
          className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner label={t('loading')} />
          {t('loading')}
        </div>
      ) : q.isError ? (
        <Alert tone="danger" className="space-y-2">
          <p>{t(`errors.${workspaceErrorKind(q.error) === 'network' ? 'network' : 'generic'}`)}</p>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      ) : (
        <WorkspaceCurrencyForm data={q.data} isOwner={isOwner} />
      )}
    </div>
  );
}

/** The select plus Save. A non-owner gets it disabled with the owner-only note, and no submit is possible. */
export function WorkspaceCurrencyForm({
  data,
  isOwner,
}: {
  data: WorkspaceCurrencyResponse;
  isOwner: boolean;
}) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const [value, setValue] = useState(selectedValue(data));
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof workspaceErrorKind> | null>(null);

  const save = useMutation({
    mutationFn: () => workspaceCurrencyApi.set(workspaceBody(value)),
    onMutate: () => {
      setSaved(false);
      setFailure(null);
    },
    onSuccess: (next) => {
      qc.setQueryData(CURRENCY_KEYS.workspace, next);
      setSaved(true);
    },
    onError: (err) => setFailure(workspaceErrorKind(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    save.mutate();
  };
  const fieldError =
    failure === 'invalid' || failure === 'validation' ? t(`errors.${failure}`) : undefined;
  const bannerError = failure && !fieldError ? t(`errors.${failure}`) : undefined;

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" aria-label={t('title')}>
        {!isOwner && <p className="text-sm italic text-muted-foreground">{t('ownerOnly')}</p>}
        <Field label={t('label')} htmlFor="workspace-currency" hint={t('hint')} error={fieldError}>
          <Select
            id="workspace-currency"
            name="currency"
            value={value}
            disabled={!isOwner || save.isPending}
            invalid={fieldError !== undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
              setFailure(null);
            }}
          >
            <option value={FOLLOW_DEFAULT}>
              {t('platformDefault', { code: data.platformDefault })}
            </option>
            {data.options.map((o) => (
              <option key={o.code} value={o.code}>
                {optionLabel(o)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">{t('current', { code: data.effective })}</p>
        {bannerError && <Alert tone="danger">{bannerError}</Alert>}
        {saved && <Alert tone="success">{t('saved')}</Alert>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="submit" disabled={!isOwner || save.isPending || !isDirty(data, value)}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
