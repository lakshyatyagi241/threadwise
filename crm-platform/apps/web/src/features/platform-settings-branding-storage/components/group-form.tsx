'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setGroupResponseSchema, type SetGroupResponse } from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  PasswordInput,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { timeZoneOptions } from '@/features/auth-registration-security/platform/lib/zones-countries';
import {
  ToggleRow,
  Section,
} from '@/features/auth-registration-security/platform/settings/section-parts';
import { allFields, type FieldSpec, type GroupSpec } from '../fields';
import { buildPatch, fieldForPath, patchSize, toDraft, type Draft } from '../lib/draft';
import { groupKey, hubKey } from '../lib/query-keys';
import { ConnectionTest } from './connection-test';

const NS = 'platform-settings-branding-storage';

/** One settings page: loads the group, edits it as a draft, saves only what changed under the rowVersion. */
export function GroupSettingsPage({ spec }: { spec: GroupSpec }) {
  const q = useQuery({
    queryKey: groupKey(spec.group),
    queryFn: ({ signal }) =>
      operatorFetch(`/settings/groups/${spec.group}`, { schema: setGroupResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  // `key` restarts the draft whenever the server copy is replaced (after a save or a reload).
  return <GroupForm key={q.data.rowVersion} spec={spec} data={q.data} />;
}

function GroupForm({ spec, data }: { spec: GroupSpec; data: SetGroupResponse }) {
  const t = useTranslations(NS);
  const tg = useTranslations(`${NS}.groups.${spec.group}`);
  const format = useFormatter();
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';

  const [draft, setDraft] = useState<Draft>(() => toDraft(data.values, spec));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState(false);
  const [fatal, setFatal] = useState<{ requestId?: string } | null>(null);

  const built = useMemo(() => buildPatch(data.values, draft, spec), [data.values, draft, spec]);
  const dirty = patchSize(built) + Object.keys(built.problems).length > 0;
  useUnsavedGuard(dirty);
  const zones = useMemo(
    () => timeZoneOptions(String(data.values.defaultTimezone ?? 'UTC')),
    [data.values.defaultTimezone],
  );

  const setField = (key: string, value: string | boolean) => {
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };
  const setSecret = (key: string, value: string) =>
    setDraft((d) => ({ ...d, secrets: { ...d.secrets, [key]: value } }));
  const setClear = (key: string, value: boolean) =>
    setDraft((d) => ({ ...d, clear: { ...d.clear, [key]: value } }));

  const label = (f: FieldSpec) => tg(`fields.${f.key}.label`);
  const hint = (f: FieldSpec) =>
    tg.has(`fields.${f.key}.hint`) ? tg(`fields.${f.key}.hint`) : undefined;

  const save = useMutation({
    mutationFn: (body: { rowVersion: number; values: unknown; secrets: unknown }) =>
      operatorFetch(`/settings/groups/${spec.group}`, {
        method: 'PATCH',
        body,
        schema: setGroupResponseSchema,
      }),
    onSuccess: (next, body) => {
      qc.setQueryData(groupKey(spec.group), next);
      void qc.invalidateQueries({ queryKey: hubKey });
      setErrors({});
      setBanner(null);
      setFatal(null);
      setConflict(false);
      toast.success(
        t('common.saved', {
          count:
            Object.keys(body.values as object).length + Object.keys(body.secrets as object).length,
        }),
      );
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'ROW_VERSION_CONFLICT') {
        setConflict(true);
        setFatal(null);
      } else if (err instanceof ApiError && err.status === 422) {
        const next: Record<string, string> = {};
        const items: string[] = [];
        for (const fe of err.fieldErrors) {
          const key = fieldForPath(fe.path, spec);
          const f = key ? allFields(spec).find((x) => x.key === key) : undefined;
          items.push(f ? `${label(f)}: ${fe.message}` : fe.message);
          if (key && !next[key]) next[key] = fe.message;
        }
        setErrors(next);
        setBanner(items);
        setFatal(null);
      } else if (!(err instanceof ApiError && err.code === 'UNAUTHENTICATED')) {
        setFatal({ requestId: err instanceof ApiError ? err.requestId : undefined });
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || save.isPending) return;
    const problemKeys = Object.keys(built.problems);
    if (problemKeys.length > 0) {
      const next: Record<string, string> = {};
      for (const k of problemKeys) {
        next[k] = t(
          built.problems[k] === 'required' ? 'common.numberRequired' : 'common.numberInteger',
        );
      }
      setErrors(next);
      setBanner(
        problemKeys.map((k) => {
          const f = allFields(spec).find((x) => x.key === k)!;
          return `${label(f)}: ${next[k]}`;
        }),
      );
      return;
    }
    if (patchSize(built) === 0) return;
    setBanner(null);
    save.mutate({ rowVersion: data.rowVersion, values: built.values, secrets: built.secrets });
  }

  const control = (f: FieldSpec) => {
    const id = `set-${spec.group}-${f.key}`;
    const err = errors[f.key] || undefined;
    const value = draft.fields[f.key];
    if (f.kind === 'toggle') {
      return (
        <ToggleRow
          key={f.key}
          id={id}
          label={label(f)}
          hint={hint(f)}
          checked={value === true}
          onChange={(v) => setField(f.key, v)}
          disabled={!canEdit}
          error={err}
        />
      );
    }
    let input;
    if (f.kind === 'secret') {
      const isSet = data.secrets[f.key]?.isSet === true;
      input = (
        <div className="space-y-2">
          <PasswordInput
            id={id}
            value={draft.secrets[f.key] ?? ''}
            onChange={(e) => setSecret(f.key, e.target.value)}
            readOnly={!canEdit}
            disabled={draft.clear[f.key] === true}
            autoComplete="new-password"
            placeholder={isSet ? '••••••••' : ''}
            showLabel={t('common.secretShow')}
            hideLabel={t('common.secretHide')}
          />
          <p className="text-xs text-muted-foreground">
            {isSet ? t('common.secretSet') : t('common.secretUnset')}
          </p>
          {isSet && canEdit && (
            <Checkbox
              id={`${id}-clear`}
              checked={draft.clear[f.key] === true}
              onChange={(e) => setClear(f.key, e.target.checked)}
              label={t('common.secretClear')}
            />
          )}
        </div>
      );
    } else if (f.kind === 'select' || f.kind === 'timezone') {
      const options = f.kind === 'timezone' ? zones : (f.options ?? []);
      input = (
        <Select
          id={id}
          value={String(value ?? '')}
          onChange={(e) => setField(f.key, e.target.value)}
          disabled={!canEdit}
          invalid={Boolean(err)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o === '' ? '-' : o}
            </option>
          ))}
        </Select>
      );
    } else if (f.kind === 'textarea') {
      input = (
        <Textarea
          id={id}
          value={String(value ?? '')}
          onChange={(e) => setField(f.key, e.target.value)}
          readOnly={!canEdit}
          invalid={Boolean(err)}
          rows={f.mono ? 8 : 3}
          spellCheck={false}
          className={cn(f.mono && 'font-mono')}
        />
      );
    } else if (f.kind === 'color') {
      const hex = String(value ?? '');
      input = (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={label(f)}
            value={/^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#000000'}
            onChange={(e) => setField(f.key, e.target.value.toUpperCase())}
            disabled={!canEdit}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-background p-1"
          />
          <Input
            id={id}
            value={hex}
            onChange={(e) => setField(f.key, e.target.value)}
            readOnly={!canEdit}
            invalid={Boolean(err)}
            placeholder="#RRGGBB"
            spellCheck={false}
            className="font-mono"
          />
        </div>
      );
    } else {
      input = (
        <Input
          id={id}
          type={f.kind === 'number' ? 'number' : f.kind === 'email' ? 'email' : 'text'}
          inputMode={f.kind === 'number' ? 'numeric' : undefined}
          min={f.min}
          max={f.max}
          value={String(value ?? '')}
          onChange={(e) => setField(f.key, e.target.value)}
          readOnly={!canEdit}
          invalid={Boolean(err)}
          autoComplete="off"
          spellCheck={false}
          className={cn((f.mono || f.kind === 'url') && 'font-mono')}
        />
      );
    }
    return (
      <Field
        key={f.key}
        label={label(f)}
        htmlFor={id}
        hint={f.kind === 'secret' ? hint(f) : hint(f)}
        error={err}
      >
        {input}
      </Field>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Link href="/admin/settings" className="text-sm text-muted-foreground hover:text-foreground">
        {t('common.back')}
      </Link>
      <PageHeader
        eyebrow={t('hub.kicker')}
        title={tg('title')}
        description={tg('description')}
        actions={
          <Button type="submit" disabled={!canEdit || !dirty || save.isPending}>
            {save.isPending && <Spinner label={t('common.saving')} />}
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        }
      />
      <p className="text-xs text-muted-foreground">
        {data.updatedAt
          ? t('common.updated', {
              when: format.dateTime(new Date(data.updatedAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : t('common.neverSaved')}
      </p>

      {!canEdit && <Alert tone="info">{t('common.readOnly')}</Alert>}
      {conflict && (
        <Alert tone="danger" className="space-y-2">
          <p>{t('common.conflict')}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: groupKey(spec.group) });
              setConflict(false);
            }}
          >
            {t('common.reload')}
          </Button>
        </Alert>
      )}
      {banner && (
        <Alert tone="danger" className="space-y-2">
          <p className="font-semibold">
            {t('common.rejected', { count: Math.max(1, banner.length) })}
          </p>
          <ul className="list-disc space-y-0.5 ps-5 text-xs">
            {banner.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {fatal && (
        <Alert tone="danger" className="space-y-1">
          <p>{t('common.unexpected')}</p>
          {fatal.requestId && (
            <p className="text-xs opacity-80">
              {t('common.requestId')}: <span className="font-mono">{fatal.requestId}</span>
            </p>
          )}
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {spec.sections.map((s) => (
          <Section key={s.id} kicker={tg('title')} title={tg(`sections.${s.id}.title`)}>
            <div className="space-y-4">{s.fields.map(control)}</div>
          </Section>
        ))}
        {spec.test && canEdit && <ConnectionTest test={spec.test} saved={data} unsaved={dirty} />}
      </div>
    </form>
  );
}
