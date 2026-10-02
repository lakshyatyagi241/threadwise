'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  createSegment,
  invalidateSegments,
  KEYS,
  updateSegment,
  useSegment,
} from '../api/segments';
import { useSegmentCatalog } from '../api/lookups';
import {
  SEGMENT_DESCRIPTION_MAX,
  SEGMENT_NAME_MAX,
  type Segment,
  type SegmentVisibility,
} from '../api/schemas';
import { ruleReducer, type RuleAction } from '../lib/builder';
import { errorKind, fieldErrorsOf } from '../lib/errors';
import { invalidConditions, kindLookup, type FieldDef } from '../lib/fields';
import {
  SEGMENT_COLORS,
  blankForm,
  formFromSegment,
  formSignature,
  formToInput,
  hasProblems,
  mapServerProblems,
  validateForm,
  type ServerProblems,
} from '../lib/form';
import {
  conditionsOf,
  countConditions,
  MAX_CONDITIONS,
  pruneIncomplete,
  signature,
  type Group,
} from '../lib/model';
import { summarize } from '../lib/summary';
import { ROUTES } from '../lib/url';
import { conditionAtPath, parseRules, toWire } from '../lib/wire';
import { ArrowLeftIcon, LockIcon, UsersIcon } from './icons';
import { LivePreview } from './live-preview';
import { ErrorLine, GroupVsSegment } from './parts';
import { RuleBuilder, Section, type ConditionWarning } from './rule-builder';
import { useUnsavedGuard } from './use-unsaved-guard';
import { useSummaryContext } from './use-summary';

/**
 * `/segments/new` and `/segments/:id/edit`: the details (name, description, colour, who can see it), the rule builder
 * and the live preview. The page loads the segment (when editing) and waits for the lookups, then hands a plain form to
 * `BuilderForm`, which owns every edit; a newer version from the server remounts it with that version's data.
 */
export function SegmentBuilder({ id }: { id?: string }) {
  const t = useTranslations('segments.builder');
  const router = useRouter();
  const canCreate = useCan('record.segments.create');
  const canUpdate = useCan('record.segments.update');
  const catalog = useSegmentCatalog();
  const query = useSegment(id ?? '');
  const editing = id !== undefined;
  const allowed = editing ? canUpdate : canCreate;

  const back = (
    <Link
      href={editing && query.data ? ROUTES.detail(query.data.id) : ROUTES.hub}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ArrowLeftIcon className="size-3.5 rtl:rotate-180" />
      {editing ? t('backToSegment') : t('backToSegments')}
    </Link>
  );

  if (editing && query.isPending) return <BuilderSkeleton label={t('loading')} />;
  if (editing && query.isError) {
    const gone = errorKind(query.error) === 'notFound';
    return (
      <div className="space-y-3">
        {back}
        {gone ? (
          <Alert tone="warning">{t('notFound')}</Alert>
        ) : (
          <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
        )}
        <Button variant="secondary" onClick={() => router.push(ROUTES.hub)}>
          {t('backToSegments')}
        </Button>
      </div>
    );
  }
  const segment = editing ? query.data : undefined;
  return (
    <BuilderForm
      key={segment ? `${segment.id}:${segment.rowVersion}` : 'new'}
      segment={segment}
      catalog={catalog}
      allowed={allowed && (segment?.canEdit ?? true)}
      back={back}
      onReload={segment ? () => void query.refetch() : undefined}
    />
  );
}

function BuilderSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="grid animate-pulse gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div className="space-y-4">
        <div className="h-48 rounded-xl bg-muted" />
        <div className="h-72 rounded-xl bg-muted" />
      </div>
      <div className="h-72 rounded-xl bg-muted" />
    </div>
  );
}

/** The server's flags (by path) as warnings on the conditions they name, kept only while the condition is unchanged. */
function serverWarnings(
  segment: Segment | undefined,
  root: Group,
): Map<string, { sig: string; reason: string }> {
  const out = new Map<string, { sig: string; reason: string }>();
  for (const bad of segment?.invalidConditions ?? []) {
    const c = conditionAtPath(root, bad.path);
    if (c) out.set(c.id, { sig: signature(c), reason: bad.reason });
  }
  return out;
}

function BuilderForm({
  segment,
  catalog: lookups,
  allowed,
  back,
  onReload,
}: {
  segment: Segment | undefined;
  catalog: ReturnType<typeof useSegmentCatalog>;
  allowed: boolean;
  back: ReactNode;
  onReload?: () => void;
}) {
  const t = useTranslations('segments.builder');
  const tf = useTranslations('segments.fields');
  const tv = useTranslations('segments.visibility');
  const tp = useTranslations('segments.problem');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const format = useFormatter();
  const { catalog } = lookups;
  const editing = Boolean(segment);

  const initial = useMemo(() => (segment ? formFromSegment(segment) : blankForm()), [segment]);
  const initialSignature = useMemo(() => formSignature(initial), [initial]);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [color, setColor] = useState(initial.color);
  const [visibility, setVisibility] = useState<SegmentVisibility>(initial.visibility);
  const [rules, setRules] = useState<Group>(initial.rules);
  const dispatch = (a: RuleAction) => setRules((r) => ruleReducer(r, a, catalog));
  const [showProblems, setShowProblems] = useState(false);
  const [server, setServer] = useState<ServerProblems>({ conditions: {} });
  const [conflict, setConflict] = useState(false);
  const [rulesStale, setRulesStale] = useState(false);

  const form = { name, description, color, visibility, rules };
  const dirty = formSignature(form) !== initialSignature;
  const guard = useUnsavedGuard(dirty && allowed);

  const problems = useMemo(() => validateForm(form, catalog), [name, description, rules, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const kindOf = useMemo(() => kindLookup(catalog), [catalog]);
  const pruned = useMemo(() => pruneIncomplete(rules, kindOf), [rules, kindOf]);
  const previewRules = useMemo(() => parseRules(toWire(rules, catalog)), [rules, catalog]);

  // Conditions that point at something deleted: found against the loaded lookups, and flagged by the server on load.
  const initialRoot = initial.rules;
  const flagged = useMemo(() => serverWarnings(segment, initialRoot), [segment, initialRoot]);
  const warnings = useMemo(() => {
    const out = new Map<string, ConditionWarning>();
    for (const [cid, reason] of invalidConditions(rules, catalog, lookups.ready))
      out.set(cid, reason);
    for (const c of conditionsOf(rules)) {
      const hit = flagged.get(c.id);
      if (hit && !out.has(c.id) && hit.sig === signature(c))
        out.set(c.id, { type: 'server', reason: hit.reason });
    }
    return out;
  }, [rules, catalog, lookups.ready, flagged]);

  const summaryCtx = useSummaryContext(catalog);
  const sentence = summarize(rules, summaryCtx);
  const stageLabel = (v: string) =>
    catalog.find((f) => f.id === 'lifecycleStage')?.options?.find((o) => o.value === v)?.label ?? v;

  const save = useMutation({
    mutationFn: async () => {
      const input = formToInput(form, catalog);
      if (!input) throw new Error('rules are not valid yet');
      return segment
        ? updateSegment(segment.id, { ...input, rowVersion: segment.rowVersion })
        : createSegment(input);
    },
    onSuccess: async (saved) => {
      guard.release();
      await invalidateSegments(qc);
      qc.setQueryData(KEYS.one(saved.id), saved);
      toast(t(editing ? 'saved' : 'created', { name: saved.name }), 'success');
      router.push(ROUTES.detail(saved.id));
    },
    onError: (e) => {
      const kind = errorKind(e);
      if (kind === 'conflict') {
        setConflict(true);
        return;
      }
      if (kind === 'validation') {
        setServer(mapServerProblems(fieldErrorsOf(e), rules));
        setShowProblems(true);
      } else if (kind === 'nameTaken') {
        setServer({ conditions: {}, name: t('nameTaken') });
      } else if (kind === 'rulesInvalid') {
        // Something the rules point at is gone: reload the lookups so the stale conditions are flagged.
        setRulesStale(true);
        void qc.invalidateQueries();
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending || !allowed) return;
    setServer({ conditions: {} });
    setRulesStale(false);
    setConflict(false);
    setShowProblems(true);
    if (hasProblems(problems)) {
      const firstCondition = Object.keys(problems.conditions)[0];
      const target = problems.name
        ? 'segment-name'
        : problems.description
          ? 'segment-description'
          : null;
      if (target) document.getElementById(target)?.focus();
      else if (firstCondition)
        document.getElementById('segment-rules')?.scrollIntoView({ block: 'center' });
      return;
    }
    save.mutate();
  }

  const nameError =
    server.name ?? (showProblems && problems.name ? tp(`name.${problems.name}`) : undefined);
  const descriptionError =
    server.description ??
    (showProblems && problems.description ? tp('description.tooLong') : undefined);
  const rulesProblem =
    server.rules ?? (showProblems && problems.rules ? tp(`rules.${problems.rules}`) : undefined);
  const otherError =
    save.isError &&
    !['conflict', 'validation', 'nameTaken', 'rulesInvalid'].includes(errorKind(save.error));

  const savedAt = segment
    ? format.dateTime(new Date(segment.updatedAt), { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="min-w-0 space-y-1">
          {back}
          <h1 className="truncate text-xl font-bold tracking-tight">
            {editing ? t('editTitle', { name: segment?.name ?? '' }) : t('createTitle')}
          </h1>
          {editing && (
            <p className="text-xs text-muted-foreground">{t('lastSaved', { when: savedAt })}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="h-10"
            onClick={() => guard.ask(editing && segment ? ROUTES.detail(segment.id) : ROUTES.hub)}
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            className="h-10 px-5"
            disabled={!allowed || save.isPending}
          >
            {save.isPending && <Spinner />}
            {t(editing ? 'save' : 'create')}
          </Button>
        </div>
      </header>

      {!allowed && <Alert tone="warning">{t(editing ? 'cannotEdit' : 'cannotCreate')}</Alert>}
      {conflict && (
        <Alert tone="warning" role="alert" className="space-y-2">
          <p className="font-medium">{t('conflictTitle')}</p>
          <p>{t('conflict')}</p>
          <Button variant="secondary" size="sm" onClick={() => onReload?.()}>
            {t('conflictReload')}
          </Button>
        </Alert>
      )}
      {rulesStale && <Alert tone="warning">{t('rulesStale')}</Alert>}
      {otherError && <ErrorLine error={save.error} />}
      {lookups.failed && <Alert tone="warning">{t('lookupsFailed')}</Alert>}

      <details open={!editing} className="group rounded-xl border border-border bg-background">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          {t('helpSummary')}
          <span aria-hidden="true" className="text-xs text-muted-foreground group-open:hidden">
            {t('show')}
          </span>
          <span
            aria-hidden="true"
            className="hidden text-xs text-muted-foreground group-open:inline"
          >
            {t('hide')}
          </span>
        </summary>
        <div className="space-y-2 border-t border-border p-4">
          <GroupVsSegment />
          <p className="text-xs text-muted-foreground">{t('helpFoot')}</p>
        </div>
      </details>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Section title={t('detailsTitle')}>
            <fieldset disabled={!allowed} className="space-y-4">
              <Field label={`${t('name')} *`} htmlFor="segment-name" error={nameError}>
                <Input
                  id="segment-name"
                  value={name}
                  maxLength={SEGMENT_NAME_MAX + 20}
                  invalid={Boolean(nameError)}
                  placeholder={t('namePlaceholder')}
                  autoFocus={!editing}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (server.name) setServer((s) => ({ ...s, name: undefined }));
                  }}
                />
              </Field>
              <Field
                label={t('description')}
                htmlFor="segment-description"
                error={descriptionError}
                hint={t('descriptionHint', { max: SEGMENT_DESCRIPTION_MAX })}
              >
                <Textarea
                  id="segment-description"
                  rows={2}
                  value={description}
                  invalid={Boolean(descriptionError)}
                  placeholder={t('descriptionPlaceholder')}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">{t('color')}</legend>
                  <div role="radiogroup" aria-label={t('color')} className="flex flex-wrap gap-2">
                    {SEGMENT_COLORS.map((c) => (
                      <label key={c} className="cursor-pointer">
                        <input
                          type="radio"
                          name="segment-color"
                          value={c}
                          checked={color === c}
                          onChange={() => setColor(c)}
                          className="peer sr-only"
                          aria-label={c}
                        />
                        <span
                          aria-hidden="true"
                          style={{ background: c }}
                          className="block size-8 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-primary"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">{t('visibility')}</legend>
                  <div role="radiogroup" aria-label={t('visibility')} className="grid gap-2">
                    {(['private', 'shared'] as const).map((v) => (
                      <label
                        key={v}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                          visibility === v
                            ? 'border-brand bg-brand/5'
                            : 'border-border hover:bg-muted',
                        )}
                      >
                        <input
                          type="radio"
                          name="segment-visibility"
                          value={v}
                          checked={visibility === v}
                          onChange={() => setVisibility(v)}
                          className="mt-1 accent-[var(--brand)]"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            {v === 'private' ? (
                              <LockIcon className="size-3.5" />
                            ) : (
                              <UsersIcon className="size-3.5" />
                            )}
                            {tv(v)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {tv(v === 'private' ? 'privateHint' : 'sharedHint')}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </fieldset>
          </Section>

          <div id="segment-rules" className="scroll-mt-4">
            <Section title={t('rulesTitle')} hint={t('rulesHint')}>
              <div className="space-y-3">
                <div
                  aria-live="polite"
                  className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
                >
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('summaryLabel')}
                  </span>
                  {sentence ? (
                    <span>{t('summaryLead', { rules: sentence })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t('summaryEmpty')}</span>
                  )}
                </div>
                {rulesProblem && (
                  <Alert tone="danger" role="alert">
                    {rulesProblem}
                  </Alert>
                )}
                <RuleBuilder
                  root={rules}
                  catalog={catalog}
                  fieldLabel={(f: FieldDef) => ('key' in f.label ? tf(f.label.key) : f.label.text)}
                  dispatch={dispatch}
                  warnings={warnings}
                  problems={problems.conditions}
                  showProblems={showProblems}
                  serverProblems={server.conditions}
                  disabled={!allowed}
                />
                <p className="text-xs text-muted-foreground">
                  {t('counts', { conditions: countConditions(rules), max: MAX_CONDITIONS })}
                </p>
              </div>
            </Section>
          </div>
        </div>

        <LivePreview
          className="lg:sticky lg:top-4"
          rules={previewRules}
          incomplete={pruned.dropped}
          stageLabel={stageLabel}
        />
      </div>

      <ConfirmDialog
        open={guard.pending !== null}
        title={t('discardTitle')}
        message={t('discardMessage')}
        confirmLabel={t('discard')}
        cancelLabel={t('keepEditing')}
        tone="danger"
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </form>
  );
}
