'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { WaChatLink, WaChatLinkListQuery } from '@crm/contracts';
import { Alert, ConfirmDialog, EmptyState, Input, Spinner, StatTile } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  useDeleteWaChatLink,
  useDuplicateWaChatLink,
  useWaChatLinks,
} from '../api/wa-chat-links-hooks';
import { useErrorText } from '../components/use-error-text';

const STATUS_TABS: Array<{ value: WaChatLinkListQuery['status']; labelKey: string }> = [
  { value: 'all', labelKey: 'tabs.all' },
  { value: 'live', labelKey: 'tabs.live' },
  { value: 'paused', labelKey: 'tabs.paused' },
];

/** `/wa-links` (Reference "WhatsApp Link Generator"): KPI tiles, server-filtered status tabs, client-side search, the table. */
export function WaLinksListScreen() {
  const t = useTranslations('forms-links-groups.links');
  const errorText = useErrorText();
  const canCreate = useCan('wfl.links.create');
  const canManage = useCan('wfl.links.manage');
  const canDelete = useCan('wfl.links.delete');

  const [status, setStatus] = useState<WaChatLinkListQuery['status']>('all');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<WaChatLink | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const links = useWaChatLinks(status);
  const duplicate = useDuplicateWaChatLink();
  const remove = useDeleteWaChatLink();

  const stats = links.data?.stats;
  const filtered = useMemo(() => {
    const items = links.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (l) => l.name.toLowerCase().includes(q) || l.slug.toLowerCase().includes(q),
    );
  }, [links.data, search]);

  const copy = async (link: WaChatLink) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link.shortPath}`);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setNotice({ tone: 'danger', text: t('notice.copyFailed') });
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold leading-none">{t('heading')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {canCreate && (
          <a
            href="/wa-links/new"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t('create.cta')}
          </a>
        )}
      </header>

      {notice && (
        <Alert tone={notice.tone} className="mt-4">
          {notice.text}
        </Alert>
      )}

      {stats && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t('stats.all')} value={stats.all} />
          <StatTile label={t('stats.live')} value={stats.live} />
          <StatTile label={t('stats.totalClicks')} value={stats.totalClicks} />
          <StatTile
            label={t('stats.avgClicks')}
            value={Math.round(stats.avgClicksPerLink * 10) / 10}
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatus(tab.value)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                status === tab.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="max-w-xs"
        />
      </div>

      <div className="mt-4">
        {links.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : links.isError ? (
          <Alert tone="danger">
            {errorText(links.error).text}{' '}
            <button type="button" className="underline" onClick={() => links.refetch()}>
              {t('retry')}
            </button>
          </Alert>
        ) : filtered.length === 0 ? (
          <EmptyState title={t('empty.title')} message={t('empty.description')} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-start text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">{t('table.link')}</th>
                  <th className="px-4 py-2">{t('table.destination')}</th>
                  <th className="px-4 py-2">{t('table.clicks')}</th>
                  <th className="px-4 py-2">{t('table.lastClicked')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((link) => (
                  <tr key={link.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{link.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{link.shortPath}</div>
                      <span
                        className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${
                          link.isLive
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {link.isLive ? t('status.live') : t('status.paused')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {link.countryCode} {link.phoneNumber}
                    </td>
                    <td className="px-4 py-3">{link.clickCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {link.lastClickedAt ? new Date(link.lastClickedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="inline-flex gap-2">
                        <a
                          href={link.shortPath}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                        >
                          {t('row.open')}
                        </a>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                          onClick={() => copy(link)}
                        >
                          {copiedId === link.id ? t('row.copied') : t('row.copy')}
                        </button>
                        {canManage && (
                          <a
                            href={`/wa-links/${link.id}`}
                            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                          >
                            {t('row.edit')}
                          </a>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                            disabled={duplicate.isPending}
                            onClick={() =>
                              duplicate.mutate(link.id, {
                                onError: (err) =>
                                  setNotice({ tone: 'danger', text: errorText(err).text }),
                              })
                            }
                          >
                            {t('row.duplicate')}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm text-danger hover:bg-muted"
                            onClick={() => setDeleting(link)}
                          >
                            {t('row.delete')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={t('confirm.deleteTitle')}
        message={t('confirm.deleteMessage')}
        confirmLabel={t('confirm.deleteConfirm')}
        cancelLabel={t('confirm.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: (err) => {
              setDeleting(null);
              setNotice({ tone: 'danger', text: errorText(err).text });
            },
          });
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
