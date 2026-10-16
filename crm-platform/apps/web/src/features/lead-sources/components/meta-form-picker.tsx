'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { MetaLeadForm, MetaLeadPage } from '@crm/contracts';
import { Button, ConfirmDialog, EmptyState, useToast } from '@crm/ui';
import { leadKeys } from '../api';
import { connectMetaForm, disconnectMetaForm, fetchMetaForms } from '../meta-api';
import { sortForms } from '../lib/meta-view';
import { MetaFailure } from './meta-failure';
import { MetaFormsTable } from './meta-forms-table';
import { MetaMappingDialog } from './meta-mapping-dialog';
import { MetaRulesDialog } from './meta-rules-dialog';
import { Loading } from './ui';
import type { MetaLogin } from './use-meta-login';

/**
 * "Choose lead forms" for one Page: the Page's forms are read from Meta (so this can take a moment and can fail on Meta's side),
 * and each is picked or stopped here. Picking a form makes its lead source and opens the Map fields dialog straight away, with every
 * question already sent where Meta says it belongs. Mounted only while open, so Meta is asked only when a person looks.
 */
export function MetaFormPicker({
  page,
  login,
  canLogin,
}: {
  page: MetaLeadPage;
  login: MetaLogin;
  canLogin: boolean;
}) {
  const t = useTranslations('lead-sources.meta.forms');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<{ kind: 'map' | 'rules'; form: MetaLeadForm } | null>(null);
  const [stopping, setStopping] = useState<MetaLeadForm | null>(null);

  const forms = useQuery({
    queryKey: leadKeys.metaForms(page.id),
    queryFn: ({ signal }) => fetchMetaForms(page.id, signal),
    retry: false,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: leadKeys.metaForms(page.id) });
    // The Page's "forms connected" count and the sources list change with every pick and stop.
    void qc.invalidateQueries({ queryKey: leadKeys.meta, exact: true });
    void qc.invalidateQueries({ queryKey: leadKeys.list });
  };

  const pick = useMutation({
    mutationFn: (form: MetaLeadForm) => connectMetaForm(page.id, form.formId),
    onSuccess: (form) => {
      refresh();
      toast(t('pickedToast', { name: form.name }));
      // The mapping starts from Meta's own suggestion for each question; the person checks it and saves.
      setDialog({ kind: 'map', form });
    },
  });

  const stop = useMutation({
    mutationFn: (form: MetaLeadForm) => disconnectMetaForm(page.id, form.formId),
    onSuccess: (_void, form) => {
      refresh();
      if (form.sourceId) qc.removeQueries({ queryKey: leadKeys.one(form.sourceId) });
      toast(t('stoppedToast', { name: form.name }));
      setStopping(null);
    },
    onError: () => setStopping(null),
  });

  const busy = pick.isPending || stop.isPending;
  const failure = pick.error ?? stop.error;
  const rows = sortForms(forms.data?.data ?? []);

  return (
    <section
      aria-label={t('title', { name: page.name ?? page.pageId })}
      className="space-y-3 border-t border-border pt-4"
      data-testid="meta-form-picker"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t('title', { name: page.name ?? page.pageId })}</h4>
        <Button
          size="sm"
          variant="secondary"
          disabled={forms.isFetching || busy}
          onClick={() => void forms.refetch()}
        >
          {t('refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('intro')}</p>

      {failure && (
        <MetaFailure
          error={failure}
          login={login}
          canLogin={canLogin}
          onRetry={() => {
            pick.reset();
            stop.reset();
          }}
        />
      )}

      {forms.isPending ? (
        <Loading label={t('loading')} />
      ) : forms.isError ? (
        <MetaFailure
          error={forms.error}
          login={login}
          canLogin={canLogin}
          onRetry={() => void forms.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} message={t('empty')} />
      ) : (
        <MetaFormsTable
          forms={rows}
          busy={busy}
          pickingId={pick.isPending ? (pick.variables?.formId ?? null) : null}
          actions={{
            onPick: (form) => {
              pick.reset();
              pick.mutate(form);
            },
            onStop: (form) => {
              stop.reset();
              setStopping(form);
            },
            onMap: (form) => setDialog({ kind: 'map', form }),
            onRules: (form) => setDialog({ kind: 'rules', form }),
          }}
        />
      )}

      <MetaMappingDialog
        form={dialog?.kind === 'map' ? dialog.form : null}
        onClose={() => setDialog(null)}
      />
      <MetaRulesDialog
        form={dialog?.kind === 'rules' ? dialog.form : null}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={stopping !== null}
        tone="danger"
        title={t('confirmStop.title', { name: stopping?.name ?? '' })}
        message={t('confirmStop.body')}
        confirmLabel={t('confirmStop.action')}
        cancelLabel={t('confirmStop.cancel')}
        busy={stop.isPending}
        onConfirm={() => stopping && stop.mutate(stopping)}
        onClose={() => setStopping(null)}
      />
    </section>
  );
}
