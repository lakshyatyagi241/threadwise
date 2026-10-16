'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { LeadSourceResponse, MetaLeadForm } from '@crm/contracts';
import { Alert, Button, Modal, Spinner, useToast } from '@crm/ui';
import { fetchSource, leadKeys, updateSource } from '../api';
import { draftFromSource, type Problems, type SourceDraft } from '../lib/draft';
import { issuesByPath, leadError, type LeadError } from '../lib/errors';
import { buildRulesUpdate, rulesDirty, rulesProblems } from '../lib/form-rules';
import { DefaultsFields, type SetDraft } from './source-fields';
import { ErrorText, Loading } from './ui';

/**
 * "Assignment and deal" for a Meta lead form: the owner rule, the deal, the notifications and the starting stage of the form's lead
 * source, with the same fields every source has. Saving writes only `defaults` (with the row version it was read at). The Modal stays
 * mounted so focus returns to the button that opened it; its content (and its requests) exist only while a form is chosen.
 */
export function MetaRulesDialog({
  form,
  onClose,
}: {
  form: MetaLeadForm | null;
  onClose: () => void;
}) {
  const t = useTranslations('lead-sources.meta.rules');
  return (
    <Modal
      open={form !== null}
      onClose={onClose}
      size="lg"
      title={t('title', { name: form?.name ?? '' })}
      closeLabel={t('close')}
    >
      {form && <RulesBody form={form} onClose={onClose} />}
    </Modal>
  );
}

function RulesBody({ form, onClose }: { form: MetaLeadForm; onClose: () => void }) {
  const t = useTranslations('lead-sources.meta.rules');
  const sourceId = form.sourceId;
  const source = useQuery({
    queryKey: leadKeys.one(sourceId ?? 'none'),
    queryFn: ({ signal }) => fetchSource(sourceId!, signal),
    enabled: sourceId !== null,
    retry: false,
  });

  if (sourceId === null) return <Alert tone="danger">{t('noSource')}</Alert>;
  if (source.isPending) return <Loading label={t('loading')} />;
  if (source.isError) {
    return <ErrorText error={source.error} onRetry={() => void source.refetch()} />;
  }
  return (
    <RulesForm key={source.data.rowVersion} form={form} source={source.data} onClose={onClose} />
  );
}

function RulesForm({
  form,
  source,
  onClose,
}: {
  form: MetaLeadForm;
  source: LeadSourceResponse;
  onClose: () => void;
}) {
  const t = useTranslations('lead-sources');
  const qc = useQueryClient();
  const { toast } = useToast();
  const baseline = draftFromSource(source);
  const [draft, setDraft] = useState<SourceDraft>(baseline);
  const [showProblems, setShowProblems] = useState(false);
  const [failure, setFailure] = useState<LeadError | null>(null);

  const set: SetDraft = (fn) => {
    setFailure(null);
    setDraft(fn);
  };
  const found = rulesProblems(draft);
  const problems: Problems = showProblems ? found : {};
  const dirty = rulesDirty(draft, baseline);

  const save = useMutation({
    mutationFn: () => updateSource(source.id, buildRulesUpdate(draft, source.rowVersion)),
    onSuccess: (fresh) => {
      qc.setQueryData(leadKeys.one(fresh.id), fresh);
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      toast(t('meta.rules.saved', { name: form.name }));
      onClose();
    },
    onError: (error) => setFailure(leadError(error)),
  });

  const reload = async () => {
    await qc.fetchQuery({
      queryKey: leadKeys.one(source.id),
      queryFn: ({ signal }) => fetchSource(source.id, signal),
      staleTime: 0,
    });
  };

  return (
    <form
      className="space-y-4"
      noValidate
      aria-label={t('meta.rules.title', { name: form.name })}
      onSubmit={(e) => {
        e.preventDefault();
        if (save.isPending) return;
        if (Object.keys(found).length > 0) {
          setShowProblems(true);
          return;
        }
        setFailure(null);
        save.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{t('meta.rules.intro')}</p>
      <DefaultsFields
        draft={draft}
        set={set}
        problems={problems}
        server={issuesByPath(failure)}
        disabled={save.isPending}
      />

      {failure?.kind === 'conflict' ? (
        <Alert tone="warning" className="space-y-2" data-testid="conflict">
          <p>{t('meta.rules.conflict')}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void reload()}>
            {t('detail.reload')}
          </Button>
        </Alert>
      ) : failure && (failure.kind !== 'field' || failure.issues.length === 0) ? (
        <ErrorText mapped={failure} />
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('meta.rules.cancel')}
        </Button>
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending && <Spinner />}
          {t('meta.rules.save')}
        </Button>
      </div>
    </form>
  );
}
