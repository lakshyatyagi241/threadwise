'use client';

import { useEffect, useId, useMemo, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_REJECT_REASONS,
  type ImportField,
} from '@crm/contracts';
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  StatTile,
  cn,
  useToast,
} from '@crm/ui';
import { useStatusOptions } from '../api/attributes';
import { invalidateContacts, KEYS } from '../api/contacts';
import { useGroups } from '../api/groups';
import {
  downloadRejects,
  getImportJob,
  isImportFinished,
  previewImport,
  sampleCsv,
  startImport,
  type ImportOptions,
} from '../api/import-export';
import { useTags } from '../api/tags';
import type { ContactImportJob, ContactImportPreview } from '../api/schemas';
import { downloadBlob, downloadCsv } from '../lib/download';
import { errorKind } from '../lib/errors';
import { statusChoices } from '../lib/option-sets';
import { importSummaryParts } from '../lib/import-summary';
import { ErrorLine } from './error-line';
import { DownloadIcon, FileIcon, UploadIcon } from './icons';

/** Fields shown first; the rest sit behind "More fields". */
const MAIN_FIELDS: readonly ImportField[] = [
  'name',
  'lastName',
  'phone',
  'email',
  'countryCode',
  'group',
  'language',
];

type Mapping = Partial<Record<ImportField, number | null>>;

/**
 * Bulk upload (WD-CON-027..032). Pick a CSV and the API says which columns it recognised and what the file would do
 * (WaDesk had no preview): rows that would be created or updated, the ones it would reject and why, the groups it
 * would create, the plan's remaining quota. Set the values every imported contact gets, upload, follow a large
 * import to the end, download the rejected rows.
 */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('contacts-attributes-tags.import');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={t('eyebrow')}
      title={t('title')}
      closeLabel={t('close')}
    >
      {open && <ImportBody onClose={onClose} />}
    </Modal>
  );
}

function ImportBody({ onClose }: { onClose: () => void }) {
  const t = useTranslations('contacts-attributes-tags.import');
  const ts = useTranslations('contacts-attributes-tags.form');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const groups = useGroups();
  const tags = useTags();
  const statusOptions = useStatusOptions();

  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [fileError, setFileError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [groupId, setGroupId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);

  const statuses = useMemo(
    () => statusChoices(statusOptions.data, (v) => ts(`statuses.${v}`)),
    [statusOptions.data, ts],
  );

  const hasMapping = Object.keys(mapping).length > 0;
  const options: ImportOptions = {
    ...(hasMapping ? { mapping } : {}),
    ...(status ? { status } : {}),
    ...(source.trim() ? { source: source.trim() } : {}),
    ...(groupId ? { groupId } : {}),
    ...(tagIds.length > 0 ? { tagIds } : {}),
  };

  // What the file would do. Only the column mapping changes the answer, so the knobs below do not re-upload it.
  const preview = useQuery({
    queryKey: ['cat', 'import-preview', file?.name, file?.size, file?.lastModified, mapping],
    queryFn: ({ signal }) => previewImport(file!, hasMapping ? { mapping } : {}, signal),
    enabled: file !== null,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });

  const start = useMutation({
    mutationFn: () => startImport(file!, options),
    onSuccess: (job) => setJobId(job.id),
  });

  const job = useQuery({
    queryKey: ['cat', 'import-job', jobId],
    queryFn: ({ signal }) => getImportJob(jobId!, signal),
    enabled: jobId !== null,
    // A big file runs as a background job: ask again until it ends.
    refetchInterval: (q) => (q.state.data && isImportFinished(q.state.data) ? false : 1500),
    gcTime: 0,
  });

  const finished = job.data && isImportFinished(job.data) ? job.data : null;
  const finishedId = finished?.id;
  const finishedStatus = finished?.status;
  const finishedCreated = finished?.created ?? 0;
  const finishedUpdated = finished?.updated ?? 0;
  const finishedInvalid = finished?.invalid ?? 0;
  useEffect(() => {
    if (!finishedId) return;
    void Promise.all([
      invalidateContacts(qc),
      qc.invalidateQueries({ queryKey: KEYS.groups }),
      qc.invalidateQueries({ queryKey: KEYS.tags }),
    ]);
    if (finishedStatus === 'completed') {
      // "Imported 0 contacts." alone is wrong when the file only refreshed existing ones, so say what else happened.
      const parts = importSummaryParts({
        created: finishedCreated,
        updated: finishedUpdated,
        invalid: finishedInvalid,
      });
      toast(parts.map((x) => t(x.key, { count: x.count })).join(' '), 'success');
    }
    // Once per finished job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedId]);

  function choose(next: File | undefined) {
    setFileError(false);
    if (!next) return;
    if (next.size > IMPORT_MAX_BYTES) {
      setFileError(true);
      return;
    }
    setMapping({});
    setFile(next);
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  };

  if (jobId !== null) {
    return <JobView job={job.data} error={job.isError ? job.error : null} onClose={onClose} />;
  }

  const p = preview.data;
  const ready =
    file !== null && p !== undefined && p.missingRequired.length === 0 && p.totals.valid > 0;
  const overQuota =
    p !== undefined && p.quota.remaining !== null && p.totals.willCreate > p.quota.remaining;
  const mb = Math.round(IMPORT_MAX_BYTES / (1024 * 1024));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-sm font-medium">
          {t('file')} <span className="text-danger">*</span>
        </div>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-primary px-3 py-3 transition focus-within:ring-2 focus-within:ring-primary hover:bg-primary/5',
            (dragging || file) && 'bg-primary/5',
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {file ? <FileIcon /> : <UploadIcon />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold" dir="auto">
              {file ? file.name : t('chooseFile')}
            </span>
            <span className="block text-xs text-muted-foreground">{t('fileLimits', { mb })}</span>
          </span>
          <span className="shrink-0 rounded-full border border-primary px-2.5 py-1 text-xs font-semibold text-primary">
            {file ? t('change') : t('browse')}
          </span>
          <input
            id={`${uid}-file`}
            type="file"
            accept=".csv,.txt,text/csv"
            className="sr-only"
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {fileError && (
          <p role="alert" className="text-xs text-danger">
            {t('fileTooLarge', { mb })}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('detectTitle')}
        </div>
        <p className="px-3 py-2.5 text-sm text-muted-foreground">{t('detectHint')}</p>
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => downloadCsv('contacts-sample.csv', sampleCsv())}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <DownloadIcon /> {t('sample')}
          </button>
        </div>
      </div>

      {file && preview.isPending && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('checking')}
        </div>
      )}
      {file && preview.isError && (
        <PreviewError error={preview.error} onRetry={() => void preview.refetch()} />
      )}
      {p && (
        <PreviewPanel
          preview={p}
          overQuota={overQuota}
          onMap={(field, column) => setMapping({ ...p.mapping, ...mapping, [field]: column })}
        />
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <div className="bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('applyTitle')}
        </div>
        <div className="grid gap-3 p-3 sm:grid-cols-2">
          <Field label={t('status')} htmlFor={`${uid}-status`} hint={t('statusHint')}>
            <Select id={`${uid}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('none')}</option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('source')} htmlFor={`${uid}-source`}>
            <Input
              id={`${uid}-source`}
              value={source}
              maxLength={128}
              placeholder={t('sourcePlaceholder')}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
          <Field
            className="sm:col-span-2"
            label={t('group')}
            htmlFor={`${uid}-group`}
            hint={groups.isError ? undefined : t('groupHint')}
            error={groups.isError ? t('groupsFailed') : undefined}
          >
            <Select
              id={`${uid}-group`}
              value={groupId}
              disabled={groups.isError}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">{t('none')}</option>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          {(tags.data ?? []).length > 0 && (
            <fieldset className="space-y-1.5 sm:col-span-2">
              <legend className="text-sm font-medium">{t('tags')}</legend>
              <div className="flex flex-wrap gap-1.5">
                {(tags.data ?? []).map((tag) => {
                  const on = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setTagIds(on ? tagIds.filter((x) => x !== tag.id) : [...tagIds, tag.id])
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-xs font-medium transition',
                        on
                          ? 'border-primary bg-primary/10'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {on && <span aria-hidden="true">&#10003; </span>}
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </div>

      {start.isError && <PreviewError error={start.error} />}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={start.isPending}>
          {t('cancel')}
        </Button>
        <Button onClick={() => start.mutate()} disabled={!ready || start.isPending}>
          {start.isPending ? <Spinner /> : <UploadIcon />}
          {start.isPending
            ? t('working')
            : ready
              ? t('upload', { count: p.totals.valid })
              : t('uploadIdle')}
        </Button>
      </div>
    </div>
  );
}

/** A failed preview or upload, in our words: a bad file and an oversized one have their own copy. */
function PreviewError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations('contacts-attributes-tags.import');
  const kind = errorKind(error);
  if (kind === 'importFile' || kind === 'tooLarge') {
    return <Alert tone="danger">{t(kind === 'tooLarge' ? 'errorTooLarge' : 'errorFile')}</Alert>;
  }
  return <ErrorLine error={error} onRetry={onRetry} />;
}

function PreviewPanel({
  preview,
  overQuota,
  onMap,
}: {
  preview: ContactImportPreview;
  overQuota: boolean;
  onMap: (field: ImportField, column: number | null) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.import');
  const uid = useId();
  const [more, setMore] = useState(false);
  const fields = more ? IMPORT_FIELDS : MAIN_FIELDS;
  const totals = preview.totals;
  const reason = (r: string) =>
    (IMPORT_REJECT_REASONS as readonly string[]).includes(r) ? t(`reasons.${r}`) : r;
  const headers = preview.headers.slice(0, 6);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-sm font-medium">{t('previewTitle')}</div>
      {preview.missingRequired.length > 0 && (
        <Alert tone="danger">
          {t('missingRequired', {
            fields: preview.missingRequired.map((f) => t(`fields.${f}`)).join(', '),
          })}
        </Alert>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field) => {
          const current = preview.mapping[field];
          return (
            <div key={field} className="flex items-center justify-between gap-2 text-sm">
              <label htmlFor={`${uid}-${field}`} className="shrink-0 text-muted-foreground">
                {t(`fields.${field}`)}
                {(field === 'name' || field === 'phone') && <span className="text-danger"> *</span>}
              </label>
              <Select
                id={`${uid}-${field}`}
                className="h-8 max-w-[11rem]"
                value={current === undefined || current === null ? '' : String(current)}
                onChange={(e) =>
                  onMap(field, e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">{t('notInFile')}</option>
                {preview.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || t('columnN', { n: i + 1 })}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="text-xs font-semibold text-primary hover:underline"
      >
        {more ? t('fewerFields') : t('moreFields')}
      </button>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-live="polite">
        <StatTile label={t('totals.rows')} value={totals.rows.toLocaleString()} />
        <StatTile
          tone="accent"
          label={t('totals.willCreate')}
          value={totals.willCreate.toLocaleString()}
        />
        <StatTile label={t('totals.willUpdate')} value={totals.willUpdate.toLocaleString()} />
        <StatTile
          tone={totals.invalid ? 'warning' : 'default'}
          label={t('totals.invalid')}
          value={totals.invalid.toLocaleString()}
        />
        <StatTile
          label={t('totals.duplicateInFile')}
          value={totals.duplicateInFile.toLocaleString()}
        />
        <StatTile
          label={t('totals.quota')}
          value={
            preview.quota.remaining === null
              ? t('unlimited')
              : preview.quota.remaining.toLocaleString()
          }
        />
      </div>
      {overQuota && (
        <Alert tone="warning">{t('overQuota', { remaining: preview.quota.remaining ?? 0 })}</Alert>
      )}
      {preview.runsAsJob && <Alert tone="info">{t('runsAsJob')}</Alert>}
      {preview.newGroups.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('newGroups', { names: preview.newGroups.slice(0, 8).join(', ') })}
        </p>
      )}
      {preview.newTags.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('newTags', { names: preview.newTags.slice(0, 8).join(', ') })}
        </p>
      )}

      {preview.sampleRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="py-1 pe-2 text-start font-medium" dir="auto">
                    {h || t('columnN', { n: i + 1 })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row, ri) => (
                <tr key={ri} className="border-t border-border align-top">
                  {headers.map((h, i) => (
                    <td key={i} className="py-1 pe-2" dir="auto">
                      {row[h] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.invalidSamples.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium">{t('invalidSamples')}</div>
          <ul className="space-y-0.5 text-xs text-danger">
            {preview.invalidSamples.slice(0, 5).map((i) => (
              <li key={i.row}>{t('rowReason', { row: i.row, reason: reason(i.reason) })}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function JobView({
  job,
  error,
  onClose,
}: {
  job: ContactImportJob | undefined;
  error: unknown;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.import');
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function rejects() {
    if (!job) return;
    setBusy(true);
    try {
      downloadBlob('contacts-import-rejects.csv', await downloadRejects(job.id));
    } catch {
      toast(t('rejectsFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorLine error={error} />;
  if (!job || !isImportFinished(job)) {
    const pct =
      job && job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm">
          <Spinner /> {job?.status === 'queued' ? t('queued') : t('running')}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t('progress')}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('progressText', { done: job?.processedRows ?? 0, total: job?.totalRows ?? 0 })}
        </p>
        <p className="text-xs text-muted-foreground">{t('canClose')}</p>
        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            {t('closeWhileRunning')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {job.status === 'failed' && <Alert tone="danger">{job.error ?? t('failed')}</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile tone="accent" label={t('created')} value={job.created.toLocaleString()} />
        <StatTile label={t('updated')} value={job.updated.toLocaleString()} />
        <StatTile
          tone={job.invalid ? 'warning' : 'default'}
          label={t('invalid')}
          value={job.invalid.toLocaleString()}
        />
        <StatTile
          label={t('totals.duplicateInFile')}
          value={job.duplicatesInFile.toLocaleString()}
        />
        {job.limitExceeded > 0 && (
          <StatTile
            tone="warning"
            label={t('limitExceeded')}
            value={job.limitExceeded.toLocaleString()}
          />
        )}
      </div>
      {job.limitExceeded > 0 && <Alert tone="warning">{t('limitExceededNote')}</Alert>}
      {job.invalid > 0 && (
        <Button variant="secondary" size="sm" onClick={() => void rejects()} disabled={busy}>
          {busy ? <Spinner /> : <DownloadIcon />} {t('downloadRejects')}
        </Button>
      )}
      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={onClose}>{t('done')}</Button>
      </div>
    </div>
  );
}
