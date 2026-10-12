'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import type { FbBroadcast } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  createBroadcast,
  deleteBroadcast,
  pauseBroadcast,
  retryBroadcast,
  startBroadcast,
  useBroadcasts,
  useCompose,
} from '../api/facebook';
import { FB_BLUE, FacebookGlyph, TrashIcon } from './fb-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const STATUS: Record<FbBroadcast['status'], string> = {
  sending: 'border-warning/40 bg-warning/10 text-warning',
  done: 'border-success/40 bg-success/10 text-success',
  failed: 'border-danger/40 bg-danger/10 text-danger',
  draft: 'border-border bg-muted text-muted-foreground',
};

/** A template's buttons as the small chips under the message: a link is marked with a link sign, a tap with a return sign. */
function buttonChips(buttons: unknown): Array<{ label: string; link: boolean }> {
  if (!Array.isArray(buttons)) return [];
  return buttons.flatMap((b) => {
    const o = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>;
    const label = String(o.text ?? o.title ?? '');
    return label === '' ? [] : [{ label, link: String(o.type ?? '').toLowerCase() === 'url' }];
  });
}

/**
 * `/facebook/broadcasts` (TW-FB-012 to 014): the broadcasts and, beside them, the form that makes the next one. Meta lets a Page
 * message only people who wrote to it in the last 24 hours, so the recipients offered are exactly those. Sending runs on a worker,
 * so the list follows it and closing the page does not stop it.
 */
export function BroadcastsScreen() {
  const t = useTranslations('facebook.broadcasts');
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useBroadcasts();
  const compose = useCompose();
  const canManage = useCan('fb.broadcasts.manage');
  const pages = useMemo(() => compose.data?.pages ?? [], [compose.data]);
  const templates = compose.data?.templates ?? [];

  const [name, setName] = useState('');
  const [chosenPage, setChosenPage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<FbBroadcast | null>(null);

  // The first Page is the one in use until another is picked; changing Page clears the recipients (they belong to a Page).
  const pageId = chosenPage || pages[0]?.id || '';
  const page = pages.find((p) => p.id === pageId);
  const audience = page?.audience ?? [];
  const template = templates.find((x) => x.id === templateId);
  const chips = useMemo(() => buttonChips(template?.buttons), [template]);
  const allOn = audience.length > 0 && audience.every((a) => picked.has(a.psid));

  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.broadcasts });
  const run = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      toast(ok, 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    }
  };

  const retry = async (b: FbBroadcast) => {
    try {
      const r = await retryBroadcast(b.id);
      toast(t('retried', { count: r.retried }), 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const made = await createBroadcast({
        name: name.trim(),
        pageId,
        templateId: templateId || undefined,
        body: body.trim() || undefined,
        psids: [...picked],
      });
      toast(t('created', { count: made.total }), 'success');
      setName('');
      setBody('');
      setTemplateId('');
      setPicked(new Set());
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: KEYS.compose })]);
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const rows = list.data?.data ?? [];

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{t('intro')}</p>
        </div>
        <Link
          href="/inbox"
          className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted"
        >
          {t('inbox')}
        </Link>
      </div>

      {(list.isError || compose.isError) && <Alert tone="danger">{t('loadError')}</Alert>}

      {compose.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : pages.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background p-10 text-center shadow-sm">
          <span
            className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl text-white"
            style={{ background: FB_BLUE }}
          >
            <FacebookGlyph className="size-6" />
          </span>
          <p className="text-[13.5px]">{t('connectFirst')}</p>
          <Link
            href="/facebook"
            className="mt-3 inline-flex rounded-full px-4 py-2 text-[12.5px] font-semibold text-white"
            style={{ background: FB_BLUE }}
          >
            {t('connectPage')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {rows.length === 0 && !list.isLoading && (
              <div className="rounded-2xl border border-border bg-background p-10 text-center text-[12.5px] text-muted-foreground shadow-sm">
                {t('none')}
              </div>
            )}
            {rows.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-border bg-background p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold">{b.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {b.pageName ? `${b.pageName} · ` : ''}
                      {t('recipients', { count: b.total })}
                    </div>
                    {b.lastError && (
                      <div className="mt-1 text-[11px] text-danger">{b.lastError}</div>
                    )}
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10.5px]',
                      STATUS[b.status],
                    )}
                  >
                    {t(`status.${b.status}`)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${b.progress}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                  <span>{t('counts', { sent: b.sent, failed: b.failed, blocked: b.blocked })}</span>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      {b.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void run(() => startBroadcast(b.id), t('started'))}
                          className="rounded-full px-3 py-1 text-[11px] font-semibold text-white"
                          style={{ background: FB_BLUE }}
                        >
                          {t('start')}
                        </button>
                      )}
                      {b.status === 'sending' && (
                        <button
                          type="button"
                          onClick={() => void run(() => pauseBroadcast(b.id), t('paused'))}
                          className="rounded-full border border-border px-3 py-1 text-[11px] font-medium hover:bg-muted"
                        >
                          {t('pause')}
                        </button>
                      )}
                      {b.status !== 'draft' &&
                        b.status !== 'sending' &&
                        (b.status === 'failed' || b.failed + b.blocked > 0) && (
                          <button
                            type="button"
                            onClick={() => void retry(b)}
                            className="rounded-full border border-border px-3 py-1 text-[11px] font-medium hover:bg-muted"
                          >
                            {t('retry')}
                          </button>
                        )}
                      <button
                        type="button"
                        title={t('delete')}
                        aria-label={t('delete')}
                        onClick={() => setDeleting(b)}
                        className="grid size-7 place-items-center rounded-lg text-danger hover:bg-danger/10"
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {canManage && (
            <aside className="lg:sticky lg:top-6">
              <form
                className="space-y-3 rounded-2xl border border-border bg-background p-5 shadow-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <div className="text-lg">{t('newBroadcast')}</div>
                <Field label={t('name')} htmlFor="fb-bcast-name">
                  <Input
                    id="fb-bcast-name"
                    value={name}
                    maxLength={191}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                  />
                </Field>
                <Field label={t('page')} htmlFor="fb-bcast-page">
                  <Select
                    id="fb-bcast-page"
                    value={pageId}
                    onChange={(e) => {
                      setChosenPage(e.target.value);
                      setPicked(new Set());
                    }}
                    className="font-semibold"
                  >
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.pageId}
                      </option>
                    ))}
                  </Select>
                </Field>
                {templates.length > 0 && (
                  <Field label={t('template')} htmlFor="fb-bcast-template" hint={t('templateHint')}>
                    <Select
                      id="fb-bcast-template"
                      value={templateId}
                      onChange={(e) => {
                        const next = e.target.value;
                        setTemplateId(next);
                        const tpl = templates.find((x) => x.id === next);
                        if (tpl && body.trim() === '') setBody(tpl.body);
                      }}
                    >
                      <option value="">{t('templateNone')}</option>
                      {templates.map((x) => {
                        const n = buttonChips(x.buttons).length;
                        return (
                          <option key={x.id} value={x.id}>
                            {n > 0 ? `${x.name} · ${t('buttons', { count: n })}` : x.name}
                          </option>
                        );
                      })}
                    </Select>
                  </Field>
                )}
                <Field label={t('message')} htmlFor="fb-bcast-body" hint={t('messageHint')}>
                  <Textarea
                    id="fb-bcast-body"
                    rows={4}
                    maxLength={2000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t('messagePlaceholder')}
                    className="resize-y"
                  />
                </Field>
                {chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <span
                        key={c.label}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px]',
                          c.link
                            ? 'border-[#1877F2]/40 bg-[#EAF2FE] text-[#1568D6]'
                            : 'border-border bg-muted text-muted-foreground',
                        )}
                      >
                        {c.link ? '🔗' : '↩'} {c.label}
                      </span>
                    ))}
                  </div>
                )}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[13px] font-medium">
                      {t('recipientsLabel')}{' '}
                      <span className="font-normal text-muted-foreground">{t('within24')}</span>
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-brand hover:underline"
                      onClick={() =>
                        setPicked(allOn ? new Set() : new Set(audience.map((a) => a.psid)))
                      }
                    >
                      {t('selectAll')}
                    </button>
                  </div>
                  <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                    {audience.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                        {t('noAudience')}
                      </div>
                    ) : (
                      audience.map((a) => (
                        <label
                          key={a.psid}
                          className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={picked.has(a.psid)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(a.psid);
                              else next.delete(a.psid);
                              setPicked(next);
                            }}
                            className="shrink-0"
                          />
                          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">
                            {a.title || t('messengerUser')}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">
                    {t('selected', { count: picked.size })}
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full rounded-full text-white"
                  style={{ background: FB_BLUE }}
                  disabled={busy || name.trim() === '' || picked.size === 0}
                >
                  {t('create')}
                </Button>
              </form>
            </aside>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('delete')}
        message={t('deleteConfirm')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const b = deleting;
          setDeleting(null);
          if (b) void run(() => deleteBroadcast(b.id), t('deleted'));
        }}
      />
    </main>
  );
}
