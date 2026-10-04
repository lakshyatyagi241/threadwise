'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FLB_TEMPLATE_PAGE_SIZE, type AdminFlowTemplate } from '@crm/contracts';
import { ConfirmDialog } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { adminTemplatesApi } from '../api/flows';
import { FLB_KEYS } from '../api/hooks';
import { ADMIN_FLASH_KEY } from './admin-template-form';

/** The type chip: message key and colours per template type. */
const TYPE_BADGE: Record<string, [string, string]> = {
  chat: ['typeChat', 'bg-[var(--flb-mint)] text-brand'],
  call: ['typeCall', 'bg-amber-100/60 text-[#7B5A14]'],
  instagram: ['typeInstagram', 'bg-[#EFE5F5] text-[#5B3D8A]'],
};
const GRID = 'grid grid-cols-[1.6fr_120px_120px_90px_90px_120px]';
/** `Str::limit`: cut at `n` characters, trim the right edge, add "...". */
const limit = (v: string, n: number) => (v.length <= n ? v : `${v.slice(0, n).trimEnd()}...`);

/** `/admin/flow-templates` (WD-FLB-011): stat tiles, the template table (20 per page), show / hide, edit and delete. */
export function AdminTemplatesScreen() {
  const t = useTranslations('flb.admin.list');
  const tc = useTranslations('flb.common');
  const qc = useQueryClient();
  const canWrite = useOperator().operator.role === 'super_admin';
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A save on the form leaves its notice for this page: shown once.
  useEffect(() => {
    try {
      const m = sessionStorage.getItem(ADMIN_FLASH_KEY);
      if (m) {
        sessionStorage.removeItem(ADMIN_FLASH_KEY);
        // One-time read of the notice a form left in sessionStorage (an external store), so the effect is the right place.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFlashMsg(m);
      }
    } catch {
      /* nothing stored */
    }
  }, []);
  const [deleting, setDeleting] = useState<AdminFlowTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: [...FLB_KEYS.admin, cursor ?? 'first'],
    queryFn: () => adminTemplatesApi.list({ limit: FLB_TEMPLATE_PAGE_SIZE, cursor }),
  });
  const reload = () => qc.invalidateQueries({ queryKey: FLB_KEYS.admin });
  const message = (e: unknown) =>
    e instanceof ApiError ? e.message : String((e as Error)?.message ?? e);

  const toggle = async (tpl: AdminFlowTemplate) => {
    setError(null);
    try {
      const r = await adminTemplatesApi.toggle(tpl.id);
      setFlashMsg(r.isActive ? t('visible') : t('hiddenToast'));
      await reload();
    } catch (e) {
      setError(message(e));
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await adminTemplatesApi.remove(deleting.id);
      setFlashMsg(t('deleted'));
      setDeleting(null);
      setCursors([]);
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const stats = q.data?.stats ?? { total: 0, visible: 0, cloned: 0 };
  const rows = q.data?.data ?? [];
  return (
    <div className="flb-root space-y-5" data-testid="admin-flow-templates">
      <nav className="font-mono text-[12px] text-muted-foreground" aria-label="Breadcrumb">
        <span className="tracking-[0.16em] uppercase">{t('crumbAdmin')}</span> ›{' '}
        <span className="text-foreground">{t('crumbTemplates')}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="font-serif text-[28px] leading-none font-normal tracking-tight sm:text-[40px]">
            {t('title')} <span className="text-brand italic">{t('titleAccent')}</span>.
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canWrite ? (
          <Link
            href="/admin/flow-templates/new"
            className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground hover:opacity-90"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            {t('add')}
          </Link>
        ) : null}
      </header>

      {flashMsg ? (
        <div
          role="status"
          className="rounded-2xl border border-primary/40 bg-[var(--flb-mint)]/50 px-4 py-3 text-[12.5px] font-medium text-brand"
        >
          {flashMsg}
        </div>
      ) : null}
      {!canWrite ? (
        <p className="rounded-xl border border-border bg-muted px-4 py-2.5 text-[12.5px] text-muted-foreground">
          {t('readOnly')}
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-[13px] text-danger"
        >
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          {
            label: t('statsTotal'),
            note: t('statsTotalNote'),
            value: stats.total,
            border: 'border-border',
            noteCls: 'text-muted-foreground',
          },
          {
            label: t('statsVisible'),
            note: t('statsVisibleNote'),
            value: stats.visible,
            border: 'border-primary/40',
            noteCls: 'text-brand',
          },
          {
            label: t('statsCloned'),
            note: t('statsClonedNote'),
            value: stats.cloned,
            border: 'border-border',
            noteCls: 'text-muted-foreground',
          },
        ].map((c) => (
          <div
            key={c.label}
            className={`rounded-2xl border bg-background p-4 shadow-sm ${c.border}`}
          >
            <div className="text-[11px] font-medium text-foreground/70">{c.label}</div>
            <div className="mt-1 font-serif text-[34px] leading-none">
              {c.value.toLocaleString('en-US')}
            </div>
            <div className={`mt-2 text-[11px] ${c.noteCls}`}>{c.note}</div>
          </div>
        ))}
      </div>

      {q.isError ? (
        <div className="rounded-2xl border border-border p-6 text-center text-sm">
          {t('loadFailed')}
        </div>
      ) : q.isPending ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{tc('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <div className="font-serif text-xl">{t('empty')}</div>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyNote')}</p>
          <Link
            href="/admin/flow-templates/new"
            className="mt-4 inline-block rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground"
          >
            {t('emptyAction')}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]" role="table" aria-label={t('table')}>
              <div
                role="row"
                className={`${GRID} items-center gap-3 border-b border-border bg-muted/50 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground`}
              >
                <div role="columnheader">{t('colTemplate')}</div>
                <div role="columnheader">{t('colType')}</div>
                <div role="columnheader">{t('colCategory')}</div>
                <div role="columnheader">{t('colSteps')}</div>
                <div role="columnheader">{t('colClones')}</div>
                <div role="columnheader" className="pr-2 text-right">
                  {t('colActions')}
                </div>
              </div>
              {rows.map((r) => {
                const badge = TYPE_BADGE[r.flowType];
                return (
                  <div
                    key={r.id}
                    role="row"
                    className={`${GRID} items-center gap-3 border-b border-border px-4 py-3 transition hover:bg-muted/50`}
                    data-template-row={r.id}
                  >
                    <div role="cell" className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold">{r.name}</span>
                        {!r.isActive ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-muted-foreground uppercase">
                            {t('hidden')}
                          </span>
                        ) : null}
                      </div>
                      {r.description ? (
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {limit(r.description, 90)}
                        </div>
                      ) : null}
                    </div>
                    <div role="cell">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${badge ? badge[1] : 'bg-muted text-muted-foreground'}`}
                      >
                        {badge ? t(badge[0]) : '—'}
                      </span>
                    </div>
                    <div role="cell" className="truncate text-[12px] text-muted-foreground">
                      {r.category || '—'}
                    </div>
                    <div role="cell" className="font-mono text-[12px]">
                      {r.steps}
                    </div>
                    <div role="cell" className="font-mono text-[12px]">
                      {r.cloneCount.toLocaleString('en-US')}
                    </div>
                    <div role="cell" className="flex items-center justify-end gap-1">
                      {canWrite ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggle(r)}
                            className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-muted ${r.isActive ? 'text-brand' : 'text-muted-foreground'}`}
                            aria-label={r.isActive ? t('toggleHide') : t('toggleShow')}
                            title={r.isActive ? t('toggleHide') : t('toggleShow')}
                          >
                            <svg
                              viewBox="0 0 16 16"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            >
                              {r.isActive ? (
                                <>
                                  <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
                                  <circle cx="8" cy="8" r="1.8" />
                                </>
                              ) : (
                                <path d="M2 2l12 12M6.5 6.6a2 2 0 0 0 2.8 2.8M4 4.6C2.4 5.7 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1 0 1.9-.2 2.7-.6M9.5 4.1A6.6 6.6 0 0 1 14.5 8s-.5.9-1.5 1.9" />
                              )}
                            </svg>
                          </button>
                          <Link
                            href={`/admin/flow-templates/${r.id}/edit`}
                            className="grid h-8 w-8 place-items-center rounded-lg text-foreground/70 transition hover:bg-muted"
                            aria-label={t('edit')}
                            title={t('edit')}
                          >
                            <svg
                              viewBox="0 0 16 16"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            >
                              <path d="M11 3l2 2-7 7H4v-2z" />
                            </svg>
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleting(r)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--flb-coral)] transition hover:bg-[var(--flb-coral)]/10"
                            aria-label={t('delete')}
                            title={t('delete')}
                          >
                            <svg
                              viewBox="0 0 16 16"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            >
                              <path d="M2.5 4h11M6 4V2.5h4V4M4.3 4l.6 9.5h6.2l.6-9.5" />
                            </svg>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (cursors.length > 0 || q.data?.page.hasMore) ? (
        <nav className="flex items-center justify-end gap-2 text-sm" aria-label="Pagination">
          <button
            type="button"
            disabled={cursors.length === 0}
            onClick={() => setCursors((c) => c.slice(0, -1))}
            className="rounded-full border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-muted-foreground">{cursors.length + 1}</span>
          <button
            type="button"
            disabled={!q.data?.page.hasMore}
            onClick={() =>
              q.data?.page.nextCursor && setCursors((c) => [...c, q.data!.page.nextCursor!])
            }
            className="rounded-full border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle')}
        message={t('deleteConfirm')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
