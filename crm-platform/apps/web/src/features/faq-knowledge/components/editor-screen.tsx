'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FAQ_LIMITS, type FaqEntry, type FaqVariation } from '@crm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Slider,
  Spinner,
  Tabs,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, refreshFaqs, useFaqCategories, useFaqEntry, useFaqSettings } from '../api/hooks';
import { faqApi } from '../api/service';
import { errorKey, isRowVersionConflict, serverFieldProblems } from '../lib/errors';
import {
  draftFromEntry,
  emptyDraft,
  isDirty,
  mapServerProblems,
  toCreateInput,
  toUpdateInput,
  validateDraft,
  type DraftField,
  type DraftProblems,
  type FaqDraft,
} from '../lib/model';
import { clearPrefill, readPrefill, type Prefill } from '../lib/prefill';
import { FlowPicker } from './flow-picker';
import { FaqIcon, TrashIcon } from './icons';
import { LoadError, NoAccess, PageHeader, SectionCard, SkeletonRows } from './parts';
import { TryIt } from './try-it';
import { useLeaveGuard } from './use-leave-guard';
import { VariationsPanel, type VariationRow } from './variations-panel';

const rowOf = (v: FaqVariation): VariationRow => ({
  key: v.id,
  id: v.id,
  text: v.text,
  source: v.source,
  embedState: v.embedState,
  embedError: v.embedError,
  rowVersion: v.rowVersion,
});

/** `/faq/new` and `/faq/<id>`: the question and its answer on the left, every phrasing and its indexing state on the right. */
export function FaqEditorScreen({ id }: { id?: string }) {
  const t = useTranslations('faq.editor');
  const router = useRouter();
  const canRead = useCan('faq.entries.read');
  const canCreate = useCan('faq.entries.create');
  const canUpdate = useCan('faq.entries.update');
  const canDelete = useCan('faq.entries.delete');
  const isNew = id === undefined;
  const entry = useFaqEntry(id ?? null);

  if (!canRead) return <NoAccess permission="faq.entries.read" />;
  if (isNew && !canCreate) return <NoAccess permission="faq.entries.create" />;
  if (!isNew) {
    if (entry.isError)
      return (
        <section className="space-y-4">
          <LoadError
            errorKey={errorKey(entry.error)}
            error={entry.error}
            onRetry={() => void entry.refetch()}
          />
          <Link href="/faq" className="text-sm underline">
            {t('backToList')}
          </Link>
        </section>
      );
    if (!entry.data) return <SkeletonRows rows={6} />;
  }
  return (
    <EditorBody
      key={entry.data?.id ?? 'new'}
      entry={entry.data ?? null}
      canSave={isNew ? canCreate : canUpdate}
      canDelete={canDelete}
      router={router}
    />
  );
}

function EditorBody({
  entry,
  canSave,
  canDelete,
  router,
}: {
  entry: FaqEntry | null;
  canSave: boolean;
  canDelete: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const t = useTranslations('faq.editor');
  const te = useTranslations('faq.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canAddVariations = useCan('faq.entries.create');
  const canEditVariations = useCan('faq.entries.update');
  const canRemoveVariations = useCan('faq.entries.delete');
  const settings = useFaqSettings(true);
  const categories = useFaqCategories(true);
  const isNew = entry === null;

  const [prefill] = useState<Prefill | null>(() => (isNew ? readPrefill() : null));
  const initial = useMemo(
    () => (entry ? draftFromEntry(entry) : emptyDraft({ question: prefill?.question })),
    // The baseline is the draft at load; saves replace it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [baseline, setBaseline] = useState<FaqDraft>(initial);
  const [draft, setDraft] = useState<FaqDraft>(initial);
  const [version, setVersion] = useState(entry?.rowVersion ?? 0);
  const [localRows, setLocalRows] = useState<VariationRow[]>([]);
  const [problems, setProblems] = useState<DraftProblems>({});
  const [serverFields, setServerFields] = useState<Partial<Record<DraftField, string>>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const dirty = !leaving && (isDirty(draft, baseline) || (isNew && localRows.length > 0));
  const guard = useLeaveGuard(dirty);
  const set = (patch: Partial<FaqDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setServerFields({});
    setFormError(null);
    // A message about a field goes away as soon as the field is right (it is not kept until the next save).
    setProblems((shown) => {
      const fields = Object.keys(shown) as DraftField[];
      if (fields.length === 0) return shown;
      const now = validateDraft(next);
      return Object.fromEntries(fields.filter((f) => now[f]).map((f) => [f, now[f]]));
    });
  };

  const s = settings.data;
  const atFaqLimit = isNew && !!s && s.usage.faqs >= s.limits.maxFaqs;
  const liveEntry = useFaqEntry(entry?.id ?? null).data ?? entry;
  const liveRows = isNew ? localRows : (liveEntry?.variations ?? []).map(rowOf);

  const put = (e: FaqEntry) => qc.setQueryData(KEYS.entry(e.id), e);

  /**
   * After a failed save, keyboard focus goes to the first field with a problem. It waits for the screen to show the problem (an
   * effect after the render), so the field is already marked invalid when it is looked for.
   */
  const [focusTick, setFocusTick] = useState(0);
  const focusFirstInvalid = () => setFocusTick((n) => n + 1);
  useEffect(() => {
    if (focusTick === 0) return;
    document
      .querySelector<HTMLElement>('form [aria-invalid="true"], form #faq-flow-error')
      ?.focus();
  }, [focusTick]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return faqApi.create(
          toCreateInput(
            draft,
            localRows.map((r) => r.text),
            prefill?.resolveLogId,
          ),
        );
      }
      return faqApi.update(entry.id, toUpdateInput(draft, version));
    },
    onSuccess: (e) => {
      void refreshFaqs(qc);
      clearPrefill();
      toast(t(isNew ? 'created' : 'saved'));
      if (isNew) {
        setLeaving(true);
        router.replace(`/faq/${e.id}`);
      } else {
        put(e);
        setBaseline(draft);
        setVersion(e.rowVersion);
      }
    },
    onError: (err) => {
      setConflict(isRowVersionConflict(err));
      const { fields } = mapServerProblems(serverFieldProblems(err));
      const key = errorKey(err);
      if (key === 'duplicateQuestion') fields.question = te('duplicateQuestion');
      if (key === 'flowNotFound') fields.flowId = te('flowNotFound');
      setServerFields(fields);
      setFormError(Object.keys(fields).length > 0 && key !== 'limitReached' ? null : err);
      if (Object.keys(fields).length > 0) focusFirstInvalid();
    },
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSave || save.isPending || atFaqLimit) return;
    const p = validateDraft(draft);
    setProblems(p);
    setServerFields({});
    if (Object.keys(p).length > 0) {
      focusFirstInvalid();
      return;
    }
    save.mutate();
  };

  // Ctrl/Cmd+S saves, as in the other editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keepMine = useMutation({
    mutationFn: () => faqApi.get(entry!.id),
    onSuccess: (fresh) => {
      put(fresh);
      setVersion(fresh.rowVersion);
      setConflict(false);
      setFormError(null);
      toast(t('conflict.kept'), 'info');
    },
    onError: (err) => setFormError(err),
  });
  const loadLatest = useMutation({
    mutationFn: () => faqApi.get(entry!.id),
    onSuccess: (fresh) => {
      put(fresh);
      const d = draftFromEntry(fresh);
      setDraft(d);
      setBaseline(d);
      setVersion(fresh.rowVersion);
      setConflict(false);
      setFormError(null);
    },
    onError: (err) => setFormError(err),
  });
  const remove = useMutation({
    mutationFn: () => faqApi.remove(entry!.id),
    onSuccess: () => {
      setLeaving(true);
      // Everything is stale except the entry that was just deleted: asking for it again would only be a 404.
      const gone = KEYS.entry(entry!.id);
      void qc.cancelQueries({ queryKey: gone });
      void qc.invalidateQueries({
        queryKey: KEYS.all,
        predicate: (q) => !(q.queryKey[1] === 'entry' && q.queryKey[2] === gone[2]),
      });
      toast(t('deleted'));
      router.replace('/faq');
    },
    onError: (err) => {
      setConfirmDelete(false);
      setFormError(err);
    },
  });

  // --- variations: server-backed when saved, local before ------------------------------------------------------------
  const refreshEntry = () => qc.invalidateQueries({ queryKey: KEYS.all });
  const onAdd = async (texts: string[], source: 'manual' | 'ai') => {
    if (isNew) {
      setLocalRows((cur) => [
        ...cur,
        ...texts.map((text): VariationRow => ({ key: text, text, source })),
      ]);
      return;
    }
    for (let i = 0; i < texts.length; i += FAQ_LIMITS.variationsPerRequest) {
      await faqApi.addVariations(entry.id, {
        texts: texts.slice(i, i + FAQ_LIMITS.variationsPerRequest),
        source,
      });
    }
    await refreshEntry();
  };
  const onEdit = async (row: VariationRow, text: string) => {
    if (isNew || !row.id || row.rowVersion === undefined) {
      setLocalRows((cur) => cur.map((r) => (r.key === row.key ? { ...r, key: text, text } : r)));
      return;
    }
    await faqApi.updateVariation(entry.id, row.id, { text, rowVersion: row.rowVersion });
    await refreshEntry();
  };
  const onRemove = async (row: VariationRow) => {
    if (isNew || !row.id) {
      setLocalRows((cur) => cur.filter((r) => r.key !== row.key));
      return;
    }
    await faqApi.removeVariation(entry.id, row.id);
    await refreshEntry();
  };
  const onSuggest = isNew
    ? null
    : async () =>
        (await faqApi.generate(entry.id, { count: FAQ_LIMITS.generateDefault })).suggestions;

  const fieldError = (f: DraftField): string | undefined => {
    const server = serverFields[f];
    if (server) return server;
    const p = problems[f];
    if (!p) return undefined;
    return t(`problem.${f}.${p}`, {
      max:
        f === 'question'
          ? FAQ_LIMITS.question
          : f === 'category'
            ? FAQ_LIMITS.category
            : FAQ_LIMITS.answerText,
    });
  };
  const readOnly = !canSave;
  const answerTab = draft.answerType;
  const flowMissing =
    !isNew &&
    draft.answerType === 'flow' &&
    entry.flowName === null &&
    draft.flowId === entry.flowId;
  const customThreshold = draft.thresholdOverride !== null;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PageHeader
        back={{ href: '/faq', label: t('back') }}
        icon={<FaqIcon className="size-5" />}
        title={isNew ? t('newTitle') : t('editTitle')}
        subtitle={isNew ? t('newSubtitle') : undefined}
        status={
          dirty ? (
            <span className="text-xs font-medium text-warning" role="status">
              {t('unsaved')}
            </span>
          ) : undefined
        }
        actions={
          <>
            {!isNew && canDelete && (
              <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                <TrashIcon />
                {t('delete')}
              </Button>
            )}
            <Link
              href="/faq"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('cancel')}
            </Link>
            {canSave && (
              <Button
                type="submit"
                variant="brand"
                disabled={save.isPending || atFaqLimit || (!isNew && !dirty)}
              >
                {save.isPending && <Spinner />}
                {isNew ? t('create') : t('save')}
              </Button>
            )}
          </>
        }
      />

      {readOnly && <Alert tone="info">{t('readOnly')}</Alert>}
      {atFaqLimit && s && <Alert tone="warning">{t('faqLimit', { max: s.limits.maxFaqs })}</Alert>}
      {prefill && <Alert tone="info">{t('prefilled')}</Alert>}
      {conflict && (
        <Alert tone="warning" className="space-y-2">
          <p className="font-semibold">{t('conflict.title')}</p>
          <p>{t('conflict.body')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => keepMine.mutate()}
              disabled={keepMine.isPending}
            >
              {t('conflict.keep')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => loadLatest.mutate()}
              disabled={loadLatest.isPending}
            >
              {t('conflict.reload')}
            </Button>
          </div>
        </Alert>
      )}
      {formError !== null && !conflict && (
        <LoadError errorKey={errorKey(formError)} error={formError} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SectionCard id="faq-q" title={t('question.title')} hint={t('question.hint')}>
            <Field
              label={t('question.label')}
              htmlFor="faq-question"
              error={fieldError('question')}
              hint={t('question.count', { count: draft.question.length, max: FAQ_LIMITS.question })}
            >
              <Textarea
                id="faq-question"
                rows={2}
                value={draft.question}
                readOnly={readOnly}
                invalid={!!fieldError('question')}
                maxLength={FAQ_LIMITS.question + 50}
                onChange={(e) => set({ question: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('category.label')}
                htmlFor="faq-category"
                error={fieldError('category')}
                hint={t('category.hint')}
              >
                <Input
                  id="faq-category"
                  list="faq-categories"
                  value={draft.category}
                  readOnly={readOnly}
                  invalid={!!fieldError('category')}
                  onChange={(e) => set({ category: e.target.value })}
                />
                <datalist id="faq-categories">
                  {(categories.data ?? []).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('status.label')} htmlFor="faq-status" hint={t('status.hint')}>
                <Select
                  id="faq-status"
                  value={draft.status}
                  disabled={readOnly}
                  onChange={(e) => set({ status: e.target.value as FaqDraft['status'] })}
                >
                  <option value="active">{t('status.active')}</option>
                  <option value="paused">{t('status.paused')}</option>
                </Select>
              </Field>
            </div>
          </SectionCard>

          <SectionCard id="faq-a" title={t('answer.title')} hint={t('answer.hint')}>
            <Tabs
              value={answerTab}
              onValueChange={(v) => !readOnly && set({ answerType: v as FaqDraft['answerType'] })}
              items={[
                {
                  id: 'text',
                  label: t('answer.text'),
                  content: (
                    <div className="space-y-3">
                      <Field
                        label={t('answer.textLabel')}
                        htmlFor="faq-answer"
                        error={fieldError('answerText')}
                        hint={
                          <span aria-live="polite">
                            {t('answer.count', {
                              count: draft.answerText.length,
                              max: FAQ_LIMITS.answerText,
                            })}
                          </span>
                        }
                      >
                        <Textarea
                          id="faq-answer"
                          rows={6}
                          value={draft.answerText}
                          readOnly={readOnly}
                          invalid={!!fieldError('answerText')}
                          onChange={(e) => set({ answerText: e.target.value })}
                        />
                      </Field>
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t('answer.preview')}
                        </p>
                        <div className="rounded-lg bg-muted/60 p-3">
                          <p
                            className={cn(
                              'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ss-sm bg-success/15 px-3 py-2 text-sm',
                              draft.answerText.trim() === '' && 'text-muted-foreground',
                            )}
                          >
                            {draft.answerText.trim() === ''
                              ? t('answer.previewEmpty')
                              : draft.answerText}
                          </p>
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  id: 'flow',
                  label: t('answer.flow'),
                  content: (
                    <div className="space-y-2" id="faq-flow">
                      <p className="text-sm font-medium">{t('answer.flowLabel')}</p>
                      {readOnly ? (
                        <p className="text-sm">{draft.flowName ?? t('answer.noFlow')}</p>
                      ) : (
                        <FlowPicker
                          value={
                            draft.flowId ? { id: draft.flowId, name: draft.flowName ?? '' } : null
                          }
                          missing={flowMissing}
                          invalid={!!fieldError('flowId')}
                          describedBy="faq-flow-error"
                          onChange={(f) => set({ flowId: f.id, flowName: f.name })}
                        />
                      )}
                      {fieldError('flowId') && (
                        <p
                          id="faq-flow-error"
                          role="alert"
                          tabIndex={-1}
                          className="text-xs text-danger"
                        >
                          {fieldError('flowId')}
                        </p>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </SectionCard>

          <details className="rounded-xl border border-border bg-background">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {t('advanced.title')}
            </summary>
            <div className="space-y-3 border-t border-border p-4">
              <p className="text-sm text-muted-foreground">{t('advanced.body')}</p>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={customThreshold}
                  disabled={readOnly}
                  onChange={(e) =>
                    set({ thresholdOverride: e.target.checked ? (s?.threshold ?? 0.5) : null })
                  }
                />
                {t('advanced.custom')}
              </label>
              {customThreshold ? (
                <div className="space-y-1">
                  <label htmlFor="faq-threshold" className="text-sm font-medium">
                    {t('advanced.sliderLabel')}:{' '}
                    <span className="tabular-nums">
                      {Math.round((draft.thresholdOverride ?? 0) * 100)}%
                    </span>
                  </label>
                  <Slider
                    id="faq-threshold"
                    min={FAQ_LIMITS.thresholdMin}
                    max={FAQ_LIMITS.thresholdMax}
                    step={0.01}
                    value={draft.thresholdOverride ?? 0.5}
                    disabled={readOnly}
                    aria-valuetext={`${Math.round((draft.thresholdOverride ?? 0) * 100)}%`}
                    onValueChange={(v) => set({ thresholdOverride: Math.round(v * 100) / 100 })}
                  />
                  {fieldError('thresholdOverride') && (
                    <p role="alert" className="text-xs text-danger">
                      {fieldError('thresholdOverride')}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('advanced.workspace', { value: Math.round((s?.threshold ?? 0) * 100) })}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('advanced.following', { value: Math.round((s?.threshold ?? 0) * 100) })}
                </p>
              )}
            </div>
          </details>
        </div>

        <div className="space-y-4">
          <VariationsPanel
            question={draft.question}
            rows={liveRows}
            max={s?.limits.maxVariationsPerFaq ?? null}
            canAdd={canAddVariations && (isNew || !!entry)}
            canEdit={canEditVariations}
            canDelete={isNew ? true : canRemoveVariations}
            onAdd={onAdd}
            onEdit={onEdit}
            onRemove={onRemove}
            onSuggest={onSuggest}
          />
          {isNew ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('tryItSaveFirst')}
            </p>
          ) : (
            <TryIt />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteConfirm.title')}
        message={t('deleteConfirm.body')}
        confirmLabel={t('deleteConfirm.confirm')}
        cancelLabel={t('cancel')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
      <ConfirmDialog
        open={guard.target !== null}
        title={t('leave.title')}
        message={t('leave.body')}
        confirmLabel={t('leave.leave')}
        cancelLabel={t('leave.stay')}
        tone="danger"
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </form>
  );
}
