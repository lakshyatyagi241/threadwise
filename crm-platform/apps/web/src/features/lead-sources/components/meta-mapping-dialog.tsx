'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { LeadSourceResponse, MetaLeadForm } from '@crm/contracts';
import { Alert, Button, Modal, Select, Spinner, useToast } from '@crm/ui';
import { fetchSource, leadKeys, updateSource, useContactProperties } from '../api';
import {
  mappingUpdateFromRows,
  parseTarget,
  propertyTarget,
  rowProblems,
  rowsFromMapping,
  sameMapping,
  type QuestionRow,
} from '../lib/form-mapping';
import { MAPPING_FIELDS } from '../lib/draft';
import { leadError, type LeadError } from '../lib/errors';
import { ErrorText, Loading } from './ui';

/**
 * "Map fields" for a Meta lead form: each question of the form is sent to a contact field, a contact property, or left to the
 * pipeline's automatic matching. Saving writes only the source's mapping (with the row version it was read at), keeps the rest of
 * the source, and keeps any attribution mapping already there. The Modal stays mounted so focus returns to the button that opened
 * it; its content (and its requests) exist only while a form is chosen.
 */
export function MetaMappingDialog({
  form,
  onClose,
}: {
  form: MetaLeadForm | null;
  onClose: () => void;
}) {
  const t = useTranslations('lead-sources.meta.mapping');
  return (
    <Modal
      open={form !== null}
      onClose={onClose}
      size="lg"
      title={t('title', { name: form?.name ?? '' })}
      closeLabel={t('close')}
    >
      {form && <MappingBody form={form} onClose={onClose} />}
    </Modal>
  );
}

function MappingBody({ form, onClose }: { form: MetaLeadForm; onClose: () => void }) {
  const t = useTranslations('lead-sources.meta.mapping');
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
  // A new row version (after a save or a reload) starts the rows again from the stored mapping.
  return (
    <MappingForm key={source.data.rowVersion} form={form} source={source.data} onClose={onClose} />
  );
}

function MappingForm({
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
  const properties = useContactProperties();
  const initial = rowsFromMapping(form.questions, source.mapping);
  const [rows, setRows] = useState<QuestionRow[]>(initial.rows);
  const [failure, setFailure] = useState<LeadError | null>(null);

  const problems = rowProblems(rows);
  const result = mappingUpdateFromRows(rows, source);
  const changed = result.ok ? !sameMapping(result.body.mapping, source.mapping) : true;

  const save = useMutation({
    mutationFn: () => {
      if (!result.ok) throw new Error('rows have problems');
      return updateSource(source.id, result.body);
    },
    onSuccess: (fresh) => {
      qc.setQueryData(leadKeys.one(fresh.id), fresh);
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      toast(t('meta.mapping.saved', { name: form.name }));
      onClose();
    },
    onError: (error) => setFailure(leadError(error)),
  });

  const reload = async () => {
    // A fresh copy changes the row version, which remounts this form on the stored mapping.
    await qc.fetchQuery({
      queryKey: leadKeys.one(source.id),
      queryFn: ({ signal }) => fetchSource(source.id, signal),
      staleTime: 0,
    });
  };

  const setTarget = (key: string, target: string) => {
    setFailure(null);
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, target } : r)));
  };

  const propertyOptions = properties.data ?? [];
  const selectedProperties = rows
    .map((r) => parseTarget(r.target))
    .flatMap((p) => (p.kind === 'property' ? [p.key] : []));

  return (
    <form
      className="space-y-4"
      noValidate
      aria-label={t('meta.mapping.title', { name: form.name })}
      onSubmit={(e) => {
        e.preventDefault();
        if (result.ok && changed && !save.isPending) save.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{t('meta.mapping.intro')}</p>
      {initial.fromSuggestions && rows.some((r) => r.target !== '') && (
        <Alert tone="info" data-testid="meta-mapping-suggested">
          {t('meta.mapping.suggested')}
        </Alert>
      )}
      {initial.multiUse.length > 0 && (
        <Alert tone="warning">
          {t('meta.mapping.multiUse', { keys: initial.multiUse.join(', ') })}
        </Alert>
      )}
      {properties.isError && <Alert tone="warning">{t('mapping.propertiesFailed')}</Alert>}

      {rows.length === 0 ? (
        <Alert tone="info">{t('meta.mapping.noQuestions')}</Alert>
      ) : (
        <ul
          className="divide-y divide-border rounded-md border border-border"
          data-testid="meta-mapping-rows"
        >
          {rows.map((r, i) => {
            const problem = problems[r.key];
            const selectId = `meta-map-${i}`;
            return (
              <li
                key={r.key}
                className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-start"
              >
                <div className="min-w-0 space-y-0.5">
                  <label
                    htmlFor={selectId}
                    className="block break-words text-sm font-medium"
                    dir="auto"
                  >
                    {r.label}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    <span dir="ltr">{r.type}</span> · <code dir="ltr">{r.key}</code>
                  </p>
                </div>
                <div className="space-y-1">
                  <Select
                    id={selectId}
                    value={r.target}
                    invalid={Boolean(problem)}
                    aria-describedby={problem ? `${selectId}-error` : undefined}
                    disabled={save.isPending}
                    onChange={(e) => setTarget(r.key, e.target.value)}
                  >
                    <option value="">{t('meta.mapping.ignore')}</option>
                    <optgroup label={t('meta.mapping.contactFields')}>
                      {MAPPING_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {t(`mapping.fields.${f}`)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={t('meta.mapping.contactProperties')}>
                      {propertyOptions.map((o) => (
                        <option key={o.key} value={propertyTarget(o.key)}>
                          {o.label} ({o.key})
                        </option>
                      ))}
                      {selectedProperties
                        .filter((k) => !propertyOptions.some((o) => o.key === k))
                        .filter((k, idx, all) => all.indexOf(k) === idx)
                        .map((k) => (
                          <option key={k} value={propertyTarget(k)}>
                            {k}
                          </option>
                        ))}
                    </optgroup>
                  </Select>
                  {problem && (
                    <p id={`${selectId}-error`} role="alert" className="text-xs text-danger">
                      {t(`meta.mapping.problems.${problem.code}`)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {failure?.kind === 'conflict' ? (
        <Alert tone="warning" className="space-y-2" data-testid="conflict">
          <p>{t('meta.mapping.conflict')}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void reload()}>
            {t('detail.reload')}
          </Button>
        </Alert>
      ) : failure ? (
        <ErrorText mapped={failure} />
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('meta.mapping.cancel')}
        </Button>
        <Button type="submit" disabled={!result.ok || !changed || save.isPending}>
          {save.isPending && <Spinner />}
          {t('meta.mapping.save')}
        </Button>
      </div>
    </form>
  );
}
