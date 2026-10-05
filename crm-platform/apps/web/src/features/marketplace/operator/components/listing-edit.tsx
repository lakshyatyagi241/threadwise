'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MarketOperatorAppDetail } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { marketKeys, updateApp } from '../api';
import { isConflict, marketError } from '../lib/errors';
import {
  draftFromListing,
  isDirty,
  listingProblems,
  serverFieldKey,
  updatePatch,
  type ListingDraft,
} from '../lib/listing-form';
import { MARKET_PERMISSIONS, type MarketAccess } from '../lib/permissions';
import { ListingFields } from './listing-fields';
import { ErrorLine } from './ui';

const NS = 'marketplace.operator.edit';

/**
 * The listing's own text and placement, edited in place (tagline, page content, first-party, featured, plan feature, sort order).
 * The save sends `rowVersion` and only the fields that changed; a 409 says someone else saved first and offers a reload, never a retry.
 * Without `platform.market.manage` the form is read-only and says which key edits it.
 */
export function ListingEdit({
  detail,
  access,
}: {
  detail: MarketOperatorAppDetail;
  access: MarketAccess;
}) {
  // A saved or reloaded listing has a new rowVersion: the form starts over from it.
  return <EditForm key={`${detail.id}:${detail.rowVersion}`} detail={detail} access={access} />;
}

function EditForm({ detail, access }: { detail: MarketOperatorAppDetail; access: MarketAccess }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const initial = useMemo(() => draftFromListing(detail), [detail]);
  const [draft, setDraft] = useState<ListingDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const problems = useMemo(() => listingProblems(draft), [draft]);
  const dirty = isDirty(initial, draft);
  useUnsavedGuard(dirty);

  const reload = () => {
    void qc.invalidateQueries({ queryKey: marketKeys.appAll(detail.slug) });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
  };

  const save = useMutation({
    mutationFn: () =>
      updateApp(detail.slug, { rowVersion: detail.rowVersion, ...updatePatch(initial, draft) }),
    onSuccess: () => {
      toast.success(t('saved', { name: detail.name }));
      reload();
    },
    onError: (e) => {
      const fields: Record<string, string> = {};
      for (const p of marketError(e).problems) {
        const key = p.target === 'field' ? serverFieldKey(p.path) : null;
        if (key && !fields[key]) fields[key] = p.message;
      }
      setServerFields(fields);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setServerFields({});
    if (Object.keys(problems).length > 0 || !dirty) return;
    save.mutate();
  };

  const readOnly = !access.manage;

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-busy={save.isPending}>
      {readOnly && <Alert>{t('readOnly', { permission: MARKET_PERMISSIONS.manage })}</Alert>}
      {isConflict(save.error) && (
        <Alert tone="warning" className="space-y-2">
          <p>{t('conflict')}</p>
          <Button variant="secondary" size="sm" onClick={reload}>
            {t('reload')}
          </Button>
        </Alert>
      )}
      {save.error && !isConflict(save.error) && <ErrorLine error={save.error} />}

      <ListingFields
        draft={draft}
        onChange={setDraft}
        problems={problems}
        server={serverFields}
        showErrors={attempted}
        disabled={readOnly || save.isPending}
      />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending || !dirty}>
            {save.isPending && <Spinner />}
            {save.isPending ? t('saving') : t('save')}
          </Button>
          <Button
            variant="secondary"
            disabled={save.isPending || !dirty}
            onClick={() => {
              setDraft(initial);
              setAttempted(false);
              setServerFields({});
              save.reset();
            }}
          >
            {t('discard')}
          </Button>
          {!dirty && <p className="text-xs text-muted-foreground">{t('nothingToSave')}</p>}
        </div>
      )}
    </form>
  );
}
