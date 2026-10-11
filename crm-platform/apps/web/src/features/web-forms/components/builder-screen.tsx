'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Menu,
  MenuItem,
  Modal,
  Spinner,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  formAction,
  KEYS,
  restoreVersion,
  updateForm,
  useForm,
  useFormProperties,
  useFormVersions,
} from '../api/forms';
import { definitionProblems, isDirty, type DefinitionProblem } from '../lib/builder-model';
import { errorKind, publishProblems } from '../lib/errors';
import { STATUS_TONE } from '../lib/list-model';
import { useLeaveGuard } from '../lib/use-leave-guard';
import type { CrmProperty, Definition, FormDetail, FormLiveSettings } from '../lib/types';
import type { BuilderTabProps } from './builder-types';
import { BuildTab } from './build-tab';
import { DesignTab } from './design-tab';
import { PreviewDeviceToggle, PreviewFrame, type PreviewDevice } from './preview-frame';
import { SettingsTab } from './settings-tab';
import { ShareTab } from './share-tab';

const TABS = ['build', 'design', 'settings', 'share'] as const;
type TabId = (typeof TABS)[number];
const isTab = (v: string | null): v is TabId =>
  v !== null && (TABS as readonly string[]).includes(v);

/** `/forms/<id>`: the loader. The builder itself only mounts once the form is in hand, so its working copy starts from the saved one. */
export function BuilderScreen({ formId }: { formId: string }) {
  const t = useTranslations('web-forms.builder');
  const e = useTranslations('web-forms.errors');
  const form = useForm(formId);
  if (form.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (form.isError) {
    const kind = errorKind(form.error);
    return (
      <main className="mx-auto max-w-xl p-8">
        <EmptyState
          title={kind === 'notFound' ? t('notFoundTitle') : t('loadFailed')}
          message={kind === 'notFound' ? t('notFoundBody') : e(kind)}
          actions={
            <Link
              href="/forms"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              {t('backToForms')}
            </Link>
          }
        />
      </main>
    );
  }
  return <Builder initial={form.data} />;
}

interface Working {
  name: string;
  draft: Definition;
  live: FormLiveSettings;
}
const workingOf = (f: FormDetail): Working => ({ name: f.name, draft: f.draft, live: f.settings });

function Builder({ initial }: { initial: FormDetail }) {
  const t = useTranslations('web-forms.builder');
  const e = useTranslations('web-forms.errors');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useCan('record.forms.update');
  const canSubmissions = useCan('record.form-submissions.read');

  const [saved, setSaved] = useState<FormDetail>(initial);
  const [work, setWork] = useState<Working>(() => workingOf(initial));
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'action'>(null);
  const [problems, setProblems] = useState<Array<
    DefinitionProblem | { code: 'server'; path: string; reason: string }
  > | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [restoring, setRestoring] = useState<number | null>(null);
  // Counts every edit, so a save that finishes after the person kept typing never overwrites what they typed since.
  const edits = useRef(0);

  const contact = useFormProperties('contact');
  const company = useFormProperties('company');
  const properties: CrmProperty[] = useMemo(
    () => [...(contact.data ?? []), ...(company.data ?? [])],
    [contact.data, company.data],
  );
  const propertiesState =
    contact.isError || company.isError
      ? 'failed'
      : contact.isPending || company.isPending
        ? 'loading'
        : 'ready';

  const dirty = isDirty(work, workingOf(saved));
  const guard = useLeaveGuard(dirty && canEdit);

  const tabParam = params.get('tab');
  const tab: TabId = isTab(tabParam) ? tabParam : 'build';
  const setTab = (next: TabId) => {
    const sp = new URLSearchParams(params.toString());
    if (next === 'build') sp.delete('tab');
    else sp.set('tab', next);
    router.replace(sp.size ? `/forms/${saved.id}?${sp.toString()}` : `/forms/${saved.id}`);
  };

  const setDraft = useCallback((next: Definition | ((d: Definition) => Definition)) => {
    edits.current += 1;
    setWork((w) => ({ ...w, draft: typeof next === 'function' ? next(w.draft) : next }));
  }, []);
  const patchLive = useCallback((patch: Partial<FormLiveSettings>) => {
    edits.current += 1;
    setWork((w) => ({ ...w, live: { ...w.live, ...patch } }));
  }, []);
  const setName = useCallback((name: string) => {
    edits.current += 1;
    setWork((w) => ({ ...w, name }));
  }, []);

  // A page that is open in two places must not silently overwrite the other: a conflict says so and the person reloads.
  const fail = (err: unknown) => {
    const kind = errorKind(err);
    const detail =
      err instanceof ApiError && kind === 'definitionInvalid' ? err.fieldErrors[0]?.message : null;
    toast(
      kind === 'planLimit' ? e('planLimitForms') : detail ? `${e(kind)} (${detail})` : e(kind),
      'danger',
    );
  };

  const adopt = (next: FormDetail, sentAt: number) => {
    setSaved(next);
    void qc.invalidateQueries({ queryKey: KEYS.all });
    // The server may normalise what it stored (trimmed text, defaults): take its copy unless the person edited meanwhile.
    if (edits.current === sentAt) setWork(workingOf(next));
  };

  const save = async (): Promise<FormDetail | null> => {
    const sentAt = edits.current;
    setBusy('save');
    try {
      const out = await updateForm(saved.id, {
        name: work.name,
        definition: work.draft,
        settings: work.live,
        rowVersion: saved.rowVersion,
      });
      adopt(out, sentAt);
      toast(t('saved'), 'success');
      return out;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    const local = definitionProblems(work.draft, properties);
    if (local.length > 0) {
      setProblems(local);
      return;
    }
    let current: FormDetail | null = saved;
    if (dirty) {
      current = await save();
      if (!current) return;
    }
    const sentAt = edits.current;
    setBusy('publish');
    try {
      const out = await formAction(current.id, 'publish', current.rowVersion);
      adopt(out, sentAt);
      toast(t('published', { n: out.publishedVersion ?? 1 }), 'success');
      setTab('share');
    } catch (err) {
      const server = publishProblems(err);
      if (server.length > 0) setProblems(server.map((p) => ({ code: 'server' as const, ...p })));
      else fail(err);
    } finally {
      setBusy(null);
    }
  };

  const pauseOrResume = async (action: 'pause' | 'resume') => {
    const sentAt = edits.current;
    setBusy('action');
    try {
      const out = await formAction(saved.id, action, saved.rowVersion);
      adopt(out, sentAt);
      toast(t(action === 'pause' ? 'paused' : 'resumed'), 'success');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (version: number) => {
    setBusy('action');
    try {
      const out = await restoreVersion(saved.id, version, saved.rowVersion);
      edits.current += 1;
      setSaved(out);
      setWork(workingOf(out));
      void qc.invalidateQueries({ queryKey: KEYS.all });
      toast(t('restored', { n: version }), 'success');
      setRestoring(null);
      setVersionsOpen(false);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  // Ctrl or Cmd + S saves, as in every editor; a page with nothing to save lets the browser's own shortcut through.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (
        (ev.ctrlKey || ev.metaKey) &&
        ev.key.toLowerCase() === 's' &&
        canEdit &&
        dirty &&
        busy === null
      ) {
        ev.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, dirty, busy, work, saved]);

  const live = saved.publishedVersion !== null;
  const unpublished = live && (saved.hasUnpublishedChanges || dirty);
  const tabProps: BuilderTabProps = {
    form: saved,
    draft: work.draft,
    setDraft,
    live: work.live,
    patchLive,
    name: work.name,
    setName,
    canEdit,
    properties,
    onFormChange: (next) => {
      setSaved(next);
      void qc.invalidateQueries({ queryKey: KEYS.all });
    },
    busy: busy !== null,
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6">
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/forms"
              aria-label={t('back')}
              title={t('back')}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span aria-hidden="true" className="rtl:rotate-180">
                &#8592;
              </span>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight" dir="auto">
                {work.name || t('untitled')}
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge tone={STATUS_TONE[saved.status]}>{t(`status.${saved.status}`)}</Badge>
                {live ? (
                  <span>{t('liveVersion', { n: saved.publishedVersion ?? 0 })}</span>
                ) : (
                  <span>{t('neverPublished')}</span>
                )}
                {unpublished && <Badge tone="warning">{t('unpublished')}</Badge>}
                {dirty && <Badge>{t('unsaved')}</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
              {t('preview')}
            </Button>
            {canSubmissions && (
              <Link
                href={`/forms/${saved.id}/submissions`}
                className="inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('submissions', { count: saved.submissions })}
              </Link>
            )}
            <Menu label={t('more')} align="end" trigger={<span>{t('more')}</span>}>
              <MenuItem onSelect={() => setVersionsOpen(true)}>{t('versions')}</MenuItem>
              {canEdit && saved.status === 'published' && (
                <MenuItem onSelect={() => void pauseOrResume('pause')}>{t('pause')}</MenuItem>
              )}
              {canEdit && saved.status === 'paused' && (
                <MenuItem onSelect={() => void pauseOrResume('resume')}>{t('resume')}</MenuItem>
              )}
            </Menu>
            {canEdit && (
              <>
                <Button
                  variant="secondary"
                  disabled={!dirty || busy !== null}
                  onClick={() => void save()}
                >
                  {busy === 'save' && <Spinner />}
                  {t('save')}
                </Button>
                <Button
                  disabled={busy !== null || saved.status === 'archived'}
                  onClick={() => void publish()}
                  title={saved.status === 'archived' ? t('archivedNote') : undefined}
                >
                  {busy === 'publish' && <Spinner />}
                  {live ? t('publishChanges') : t('publish')}
                </Button>
              </>
            )}
          </div>
        </div>
        <div
          role="tablist"
          aria-label={t('tabs.label')}
          className="-mb-3 mt-3 flex gap-1 overflow-x-auto"
        >
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`forms-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="forms-tabpanel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(ev) => {
                const at = TABS.indexOf(id);
                const next =
                  ev.key === 'ArrowRight'
                    ? TABS[(at + 1) % TABS.length]
                    : ev.key === 'ArrowLeft'
                      ? TABS[(at + TABS.length - 1) % TABS.length]
                      : null;
                if (!next) return;
                ev.preventDefault();
                setTab(next);
                document.getElementById(`forms-tab-${next}`)?.focus();
              }}
              className={cn(
                'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {!canEdit && (
        <Alert className="mt-4" tone="info">
          {t('readOnly')}
        </Alert>
      )}
      {saved.status === 'archived' && (
        <Alert className="mt-4" tone="warning">
          {t('archivedNote')}
        </Alert>
      )}

      <div
        id="forms-tabpanel"
        role="tabpanel"
        aria-labelledby={`forms-tab-${tab}`}
        className="mt-5"
      >
        {tab === 'build' && <BuildTab {...tabProps} propertiesState={propertiesState} />}
        {tab === 'design' && <DesignTab {...tabProps} />}
        {tab === 'settings' && <SettingsTab {...tabProps} />}
        {tab === 'share' && <ShareTab {...tabProps} />}
      </div>

      {previewOpen && (
        <Modal
          open
          onClose={() => setPreviewOpen(false)}
          title={t('previewTitle')}
          closeLabel={t('close')}
          size="lg"
        >
          <div className="mb-3">
            <PreviewDeviceToggle value={previewDevice} onChange={setPreviewDevice} />
          </div>
          <div className="h-[70dvh] min-h-[420px]">
            <PreviewFrame form={work.draft} device={previewDevice} />
          </div>
        </Modal>
      )}

      <Modal
        open={problems !== null}
        onClose={() => setProblems(null)}
        title={t('problems.title')}
        closeLabel={t('close')}
        footer={<Button onClick={() => setProblems(null)}>{t('problems.ok')}</Button>}
      >
        <p className="mb-3 text-sm text-muted-foreground">{t('problems.intro')}</p>
        <ul className="list-disc space-y-1.5 ps-5 text-sm">
          {problems?.map((p, i) => (
            <li key={`${p.code}-${i}`}>
              {p.code === 'server'
                ? t.has(`problems.reason.${p.reason}`)
                  ? t(`problems.reason.${p.reason}`)
                  : t('problems.generic', { reason: p.reason })
                : t(`problems.code.${p.code}`, {
                    property: 'property' in p ? p.property : '',
                  })}
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        title={t('versionsTitle')}
        closeLabel={t('close')}
        size="md"
      >
        {versionsOpen && (
          <VersionsList
            formId={saved.id}
            canEdit={canEdit}
            locale={locale}
            onRestore={(n) => setRestoring(n)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={restoring !== null}
        title={t('restore.title', { n: restoring ?? 0 })}
        message={dirty ? t('restore.messageDirty') : t('restore.message')}
        confirmLabel={t('restore.confirm')}
        cancelLabel={t('cancel')}
        busy={busy === 'action'}
        onClose={() => setRestoring(null)}
        onConfirm={() => restoring !== null && void restore(restoring)}
      />

      <ConfirmDialog
        open={guard.target !== null}
        tone="danger"
        title={t('leave.title')}
        message={t('leave.message')}
        confirmLabel={t('leave.confirm')}
        cancelLabel={t('leave.stay')}
        onClose={guard.stay}
        onConfirm={guard.leave}
      />
    </div>
  );
}

function VersionsList({
  formId,
  canEdit,
  locale,
  onRestore,
}: {
  formId: string;
  canEdit: boolean;
  locale: string;
  onRestore: (n: number) => void;
}) {
  const t = useTranslations('web-forms.builder');
  const versions = useFormVersions(formId, true);
  if (versions.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (versions.isError) return <Alert tone="danger">{t('versionsFailed')}</Alert>;
  if (versions.data.length === 0)
    return <p className="text-sm text-muted-foreground">{t('versionsEmpty')}</p>;
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <ul className="divide-y divide-border">
      {versions.data.map((v) => (
        <li key={v.version} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              {t('versionN', { n: v.version })}
              {v.isLive && <Badge tone="success">{t('live')}</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {fmt.format(new Date(v.publishedAt))}
              {v.publishedBy ? ` - ${v.publishedBy.name}` : ''}
            </div>
          </div>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => onRestore(v.version)}>
              {t('restore.action')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
