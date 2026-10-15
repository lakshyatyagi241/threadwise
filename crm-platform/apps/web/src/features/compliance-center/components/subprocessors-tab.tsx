'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  SUBPROCESSOR_STATUSES,
  buildDpaTemplate,
  type ComplianceSettings,
  type Subprocessor,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useSubprocessors } from '../api/hooks';
import { complianceApi } from '../api/service';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import {
  dpaFileName,
  emptySubprocessor,
  subprocessorProblems,
  subprocessorToForm,
  subprocessorToInput,
  type SettingsForm,
  type SubprocessorForm,
} from '../lib/model';
import { CARD } from './fields';

/**
 * The workspace's sub-processor list: the vendors that process personal data for it, with the purpose, the data, the location and the
 * link to the agreement. Edited here, audited, and optionally published on a public page `/trust/<workspace>`. Also the DPA template
 * download, filled in with the workspace's own details (a template for counsel, not an agreement).
 */
export function SubprocessorsTab({
  settings,
  form,
  patch,
  canManage,
}: {
  settings: ComplianceSettings;
  form: SettingsForm;
  patch: (p: Partial<SettingsForm>) => void;
  canManage: boolean;
}) {
  const t = useTranslations('compliance-center.subprocessors');
  const te = useTranslations('compliance-center.errors');
  const session = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useSubprocessors(true);
  const [editing, setEditing] = useState<{ id: string | null; version: number } | null>(null);
  const [draft, setDraft] = useState<SubprocessorForm>(emptySubprocessor());
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<Subprocessor | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEYS.subprocessors });
    void qc.invalidateQueries({ queryKey: KEYS.checklist });
  };

  const save = useMutation({
    mutationFn: () => {
      const input = subprocessorToInput(draft);
      return editing?.id
        ? complianceApi.changeSubprocessor(editing.id, { ...input, rowVersion: editing.version })
        : complianceApi.addSubprocessor(input);
    },
    onSuccess: () => {
      setEditing(null);
      setError(null);
      refresh();
      toast(t('saved'), 'success');
    },
    onError: (e) => {
      setError(e);
      if (isRowVersionConflict(e)) refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => complianceApi.removeSubprocessor(id),
    onSuccess: () => {
      setRemoving(null);
      refresh();
      toast(t('removed'), 'success');
    },
    onError: (e) => {
      setRemoving(null);
      setError(e);
    },
  });

  const problems = subprocessorProblems(draft);
  const open = (s: Subprocessor | null) => {
    setError(null);
    setDraft(s ? subprocessorToForm(s) : emptySubprocessor());
    setEditing({ id: s?.id ?? null, version: s?.rowVersion ?? 0 });
  };

  const downloadDpa = () => {
    const rows = q.data?.data ?? [];
    const text = buildDpaTemplate({
      workspaceName: session.org.name,
      officer: { name: form.dpo.name, email: form.dpo.email },
      privacyUrl: form.privacyUrl.trim() || null,
      termsUrl: form.termsUrl.trim() || null,
      regimes: form.regimes,
      subprocessors: rows
        .filter((s) => s.status === 'active')
        .map((s) => ({ name: s.name, purpose: s.purpose, location: s.location, dpaUrl: s.dpaUrl })),
    });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = dpaFileName(session.org.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const publicUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}/trust/${session.org.slug}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('listTitle')}</h3>
          {canManage && (
            <Button size="sm" onClick={() => open(null)} data-testid="add-subprocessor">
              {t('add')}
            </Button>
          )}
        </div>
        {error !== null && editing === null && (
          <Alert tone="danger" className="mt-3">
            {te(errorKey(error))}
          </Alert>
        )}
        {q.isError ? (
          <Alert tone="danger" className="mt-3">
            {te(errorKey(q.error))}
          </Alert>
        ) : !q.data ? (
          <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
          </div>
        ) : q.data.data.length === 0 ? (
          <EmptyState title={t('empty.title')} message={t('empty.body')} className="mt-3" />
        ) : (
          <ul className="mt-3 divide-y divide-border" data-testid="subprocessor-list">
            {q.data.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
                      {t(`status.${s.status}`)}
                    </Badge>
                  </div>
                  {s.purpose && <p className="text-sm">{s.purpose}</p>}
                  <p className="text-xs text-muted-foreground">
                    {[s.dataCategories, s.location].filter(Boolean).join(' - ')}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => open(s)}>
                      {t('edit')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRemoving(s)}>
                      {t('remove')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD} data-testid="public-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('public.title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('public.hint')}</p>
          </div>
          <Switch
            id="public-page"
            checked={form.subprocessorsPublic}
            onCheckedChange={(v) => patch({ subprocessorsPublic: v })}
            label={t('public.switch')}
            disabled={!canManage}
          />
        </div>
        {settings.subprocessorsPublic && form.subprocessorsPublic && (
          <p className="mt-3 break-all text-sm" dir="ltr" data-testid="public-url">
            <a
              className="text-primary underline-offset-2 hover:underline"
              href={`/trust/${session.org.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {publicUrl}
            </a>
          </p>
        )}
        {form.subprocessorsPublic !== settings.subprocessorsPublic && (
          <p className="mt-2 text-xs text-muted-foreground">{t('public.saveToApply')}</p>
        )}
      </section>

      <section className={CARD} data-testid="dpa-card">
        <h3 className="text-sm font-semibold">{t('dpa.title')}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('dpa.hint')}</p>
        <div className="mt-3">
          <Button
            variant="secondary"
            onClick={downloadDpa}
            disabled={!q.data}
            data-testid="dpa-download"
          >
            {t('dpa.download')}
          </Button>
        </div>
      </section>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('form.editTitle') : t('form.addTitle')}
        size="md"
        closeLabel={t('form.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t('form.cancel')}
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={problems.length > 0 || save.isPending}
              data-testid="save-subprocessor"
            >
              {save.isPending && <Spinner />}
              {t('form.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error !== null && editing !== null && <Alert tone="danger">{te(errorKey(error))}</Alert>}
          <Field
            label={t('form.name')}
            htmlFor="sp-name"
            error={problems.some((p) => p.path === 'name') ? t('form.required') : undefined}
          >
            <Input
              id="sp-name"
              value={draft.name}
              maxLength={120}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label={t('form.purpose')} htmlFor="sp-purpose">
            <Textarea
              id="sp-purpose"
              value={draft.purpose}
              maxLength={300}
              rows={2}
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
            />
          </Field>
          <Field label={t('form.data')} htmlFor="sp-data">
            <Input
              id="sp-data"
              value={draft.dataCategories}
              maxLength={300}
              onChange={(e) => setDraft({ ...draft, dataCategories: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('form.location')} htmlFor="sp-location" hint={t('form.locationHint')}>
              <Input
                id="sp-location"
                value={draft.location}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
            </Field>
            <Field label={t('form.status')} htmlFor="sp-status">
              <Select
                id="sp-status"
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as SubprocessorForm['status'] })
                }
              >
                {SUBPROCESSOR_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('form.website')}
              htmlFor="sp-website"
              error={
                problems.some((p) => p.path === 'websiteUrl') ? t('form.httpsOnly') : undefined
              }
            >
              <Input
                id="sp-website"
                type="url"
                dir="ltr"
                placeholder="https://"
                value={draft.websiteUrl}
                onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })}
              />
            </Field>
            <Field
              label={t('form.dpa')}
              htmlFor="sp-dpa"
              error={problems.some((p) => p.path === 'dpaUrl') ? t('form.httpsOnly') : undefined}
            >
              <Input
                id="sp-dpa"
                type="url"
                dir="ltr"
                placeholder="https://"
                value={draft.dpaUrl}
                onChange={(e) => setDraft({ ...draft, dpaUrl: e.target.value })}
              />
            </Field>
            <Field label={t('form.addedOn')} htmlFor="sp-added">
              <Input
                id="sp-added"
                type="date"
                value={draft.addedOn}
                onChange={(e) => setDraft({ ...draft, addedOn: e.target.value })}
              />
            </Field>
            <Field label={t('form.noticeSentOn')} htmlFor="sp-notice" hint={t('form.noticeHint')}>
              <Input
                id="sp-notice"
                type="date"
                value={draft.noticeSentOn}
                onChange={(e) => setDraft({ ...draft, noticeSentOn: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title={t('confirmRemove.title')}
        message={t('confirmRemove.body', { name: removing?.name ?? '' })}
        confirmLabel={t('confirmRemove.confirm')}
        cancelLabel={t('form.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
