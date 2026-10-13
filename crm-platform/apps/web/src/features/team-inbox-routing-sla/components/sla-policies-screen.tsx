'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Spinner,
  Switch,
  useToast,
} from '@crm/ui';
import { CONVERSATION_PRIORITIES, type InboxSlaPolicy } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { PlanPaywall } from '@/features/plans-subscriptions-trials/components/plan-paywall';
import { SLA_KEYS, slaApi, useSlaPolicies } from '../api/sla';
import { draftOf, emptyDraft, toInput, type SlaDraft } from '../lib/sla-form';

/**
 * `/sla-policies` (Settings > Automation, "Response targets"): the policies that set how long a customer may wait for a first reply and
 * how long a conversation may stay unresolved. Reading needs `inbox.settings.read`, changing needs `inbox.sla.manage`; a plan without
 * SLA policies gets the paywall sheet. The first policy is the default: new conversations take their clock from it.
 */
export function SlaPoliciesScreen() {
  const t = useTranslations('team-inbox-routing-sla.sla');
  const canManage = useCan('inbox.sla.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const pathname = usePathname();
  const q = useSlaPolicies();
  const [draft, setDraft] = useState<SlaDraft | null>(null);
  const [editing, setEditing] = useState<InboxSlaPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<'name' | 'minutes' | null>(null);
  const [toDelete, setToDelete] = useState<InboxSlaPolicy | null>(null);
  const [deleting, setDeleting] = useState(false);

  const policies = q.data?.data ?? [];
  const locked = q.error instanceof ApiError && q.error.code === 'PLAN_FEATURE_LOCKED';
  const form = draft ?? emptyDraft(policies.length === 0);

  const reload = () => qc.invalidateQueries({ queryKey: SLA_KEYS.policies });
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.isRowVersionConflict) toast(t('conflict'), 'danger');
    else toast(e instanceof ApiError && e.message ? e.message : t('loadFailed'), 'danger');
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const parsed = toInput(form);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      if (editing) {
        await slaApi.update(editing.id, { rowVersion: editing.rowVersion, ...parsed.value });
        toast(t('saved'));
      } else {
        await slaApi.create(parsed.value);
        toast(t('created'));
      }
      setDraft(null);
      setEditing(null);
      await reload();
    } catch (e) {
      fail(e);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await slaApi.remove(toDelete.id);
      toast(t('deleted'));
      setToDelete(null);
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setDeleting(false);
    }
  };

  const set = (patch: Partial<SlaDraft>) => setDraft({ ...form, ...patch });
  const setOverride = (priority: string, index: 0 | 1, value: string) => {
    const current = form.overrides[priority] ?? ['', ''];
    const next: [string, string] = index === 0 ? [value, current[1]] : [current[0], value];
    set({ overrides: { ...form.overrides, [priority]: next } });
  };

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      {locked && <PlanPaywall gates={[{ href: pathname, feature: 'inbox_sla' }]} enabled={[]} />}
      <header className="space-y-2">
        <Link
          href="/settings/automation"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t('back')}
        </Link>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <Alert tone="info">
        <p className="mb-1 font-medium">{t('howTitle')}</p>
        <ol className="list-decimal space-y-0.5 ps-5 text-sm">
          <li>{t('how1')}</li>
          <li>{t('how2')}</li>
          <li>{t('how3')}</li>
          <li>{t('how4')}</li>
        </ol>
      </Alert>

      {canManage && !locked && (
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-3 rounded-lg border border-border p-4"
          data-testid="sla-form"
        >
          <h2 className="text-sm font-medium">{editing ? t('editTitle') : t('newTitle')}</h2>
          <Field label={t('name')}>
            <Input
              value={form.name}
              maxLength={128}
              onChange={(e) => set({ name: e.target.value })}
              data-testid="sla-name"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('firstResponse')} hint={t('minutesHint')}>
              <Input
                inputMode="numeric"
                value={form.firstResponse}
                onChange={(e) => set({ firstResponse: e.target.value })}
                data-testid="sla-first"
              />
            </Field>
            <Field label={t('resolution')}>
              <Input
                inputMode="numeric"
                value={form.resolution}
                onChange={(e) => set({ resolution: e.target.value })}
                data-testid="sla-resolution"
              />
            </Field>
          </div>
          <div className="space-y-2">
            <Toggle
              label={t('pause')}
              hint={t('pauseHint')}
              checked={form.pause}
              onChange={(v) => set({ pause: v })}
            />
            <Toggle
              label={t('businessHours')}
              hint={t('businessHoursHint')}
              checked={form.businessHours}
              onChange={(v) => set({ businessHours: v })}
            />
            <Toggle
              label={t('makeDefault')}
              checked={form.isDefault}
              onChange={(v) => set({ isDefault: v })}
            />
          </div>
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t('overridesTitle')}</summary>
            <p className="mt-1 text-xs text-muted-foreground">{t('overridesHint')}</p>
            <div className="mt-2 space-y-2">
              {CONVERSATION_PRIORITIES.map((p) => (
                <div key={p} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-2">
                  <span className="text-sm">{t(`priority.${p}`)}</span>
                  <Input
                    aria-label={`${t(`priority.${p}`)}: ${t('firstResponse')}`}
                    inputMode="numeric"
                    value={form.overrides[p]?.[0] ?? ''}
                    onChange={(e) => setOverride(p, 0, e.target.value)}
                  />
                  <Input
                    aria-label={`${t(`priority.${p}`)}: ${t('resolution')}`}
                    inputMode="numeric"
                    value={form.overrides[p]?.[1] ?? ''}
                    onChange={(e) => setOverride(p, 1, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </details>
          {problem === 'name' && (
            <p role="alert" className="text-sm text-danger">
              {t('name')}
            </p>
          )}
          {problem === 'minutes' && (
            <p role="alert" className="text-sm text-danger" data-testid="sla-minutes-error">
              {t('minutesInvalid')}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving} data-testid="sla-save">
              {saving ? <Spinner /> : null}
              {editing ? t('save') : t('create')}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setDraft(null);
                  setProblem(null);
                }}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        </form>
      )}

      {q.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      )}
      {q.isError && !locked && (
        <p role="alert" className="text-sm text-danger">
          {t('loadFailed')}
        </p>
      )}
      {q.data && policies.length === 0 && (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      )}
      {policies.length > 0 && (
        <ul className="space-y-3" data-testid="sla-list">
          {policies.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate" dir="auto">
                    {p.name}
                  </span>
                  {p.isDefault && <Badge tone="success">{t('defaultChip')}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.firstResponseMinutes === null && p.resolutionMinutes === null
                    ? t('noTarget')
                    : [
                        p.firstResponseMinutes !== null
                          ? t('firstShort', { minutes: p.firstResponseMinutes })
                          : null,
                        p.resolutionMinutes !== null
                          ? t('resolutionShort', { minutes: p.resolutionMinutes })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {t('inUse', { count: p.conversationCount })}
              </span>
              {canManage && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(p);
                      setDraft(draftOf(p));
                      setProblem(null);
                    }}
                  >
                    {t('edit')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setToDelete(p)}>
                    {t('delete')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: toDelete?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setToDelete(null)}
      />
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
