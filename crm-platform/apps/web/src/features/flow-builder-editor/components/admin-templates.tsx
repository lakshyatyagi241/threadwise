'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FLB_TEMPLATE_PAGE_SIZE, type AdminFlowTemplate } from '@crm/contracts';
import { ConfirmDialog } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { adminTemplatesApi } from '../api/flows';
import { FLB_KEYS } from '../api/hooks';

const TYPE_LABEL: Record<string, string> = { chat: 'Chat', call: 'Call', instagram: 'Instagram' };

/** `/admin/flow-templates` (TW-FLB-011): stat tiles, the template table (20 per page), show / hide, edit and delete. */
export function AdminTemplatesScreen() {
  const t = useTranslations('flb.admin.list');
  const tc = useTranslations('flb.common');
  const qc = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminFlowTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: [...FLB_KEYS.admin, cursor ?? 'first'],
    queryFn: () => adminTemplatesApi.list({ limit: FLB_TEMPLATE_PAGE_SIZE, cursor }),
  });
  const reload = () => qc.invalidateQueries({ queryKey: FLB_KEYS.admin });
  const message = (e: unknown) => (e instanceof ApiError ? e.message : String((e as Error)?.message ?? e));

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t('eyebrow')}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link href="/admin/flow-templates/new" className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground hover:opacity-90">
          {t('add')}
        </Link>
      </header>

      {flashMsg ? (
        <div role="status" className="rounded-xl border border-primary/40 bg-[var(--flb-mint)] px-4 py-2.5 text-[13px] text-brand">{flashMsg}</div>
      ) : null}
      {error ? <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-[13px] text-danger">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          [t('statsTotal'), stats.total],
          [t('statsVisible'), stats.visible],
          [t('statsCloned'), stats.cloned],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <div className="text-[11px] font-medium text-foreground/70">{label}</div>
            <div className="mt-1 font-serif text-[30px] leading-none">{value}</div>
          </div>
        ))}
      </div>

      {q.isError ? (
        <div className="rounded-2xl border border-border p-6 text-center text-sm">{t('loadFailed')}</div>
      ) : q.isPending ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{tc('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <div className="font-serif text-xl">{t('empty')}</div>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyNote')}</p>
          <Link href="/admin/flow-templates/new" className="mt-4 inline-block rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground">{t('emptyAction')}</Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-background">
          <table className="w-full text-left text-sm" aria-label={t('table')}>
            <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">{t('colTemplate')}</th>
                <th className="px-4 py-3">{t('colType')}</th>
                <th className="px-4 py-3">{t('colCategory')}</th>
                <th className="px-4 py-3">{t('colSteps')}</th>
                <th className="px-4 py-3">{t('colClones')}</th>
                <th className="px-4 py-3 text-right">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0" data-template-row={r.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {r.name}
                      {!r.isActive ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t('hidden')}</span> : null}
                    </div>
                    {r.description ? <div className="text-xs text-muted-foreground">{r.description}</div> : null}
                  </td>
                  <td className="px-4 py-3">{TYPE_LABEL[r.flowType] ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.category ?? '—'}</td>
                  <td className="px-4 py-3 font-mono">{r.steps}</td>
                  <td className="px-4 py-3 font-mono">{r.cloneCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => void toggle(r)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted" aria-label={r.isActive ? t('toggleHide') : t('toggleShow')} title={r.isActive ? t('toggleHide') : t('toggleShow')}>
                        {r.isActive ? t('toggleHide') : t('toggleShow')}
                      </button>
                      <Link href={`/admin/flow-templates/${r.id}/edit`} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">{t('edit')}</Link>
                      <button type="button" onClick={() => setDeleting(r)} className="rounded-full border border-border px-3 py-1 text-xs text-danger hover:bg-danger/10">{t('delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (cursors.length > 0 || q.data?.page.hasMore) ? (
        <nav className="flex items-center justify-end gap-2 text-sm" aria-label="Pagination">
          <button type="button" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))} className="rounded-full border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">Prev</button>
          <span className="text-muted-foreground">{cursors.length + 1}</span>
          <button type="button" disabled={!q.data?.page.hasMore} onClick={() => q.data?.page.nextCursor && setCursors((c) => [...c, q.data!.page.nextCursor!])} className="rounded-full border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">Next</button>
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
