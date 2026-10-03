'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CMS_PAGES,
  CMS_REGISTRY,
  THEME_GROUPS,
  THEME_GROUP_LABELS,
  THEME_PRESETS,
  THEME_TOKENS,
  countResponseSchema,
  homepageSwitchResponseSchema,
  layoutKeys,
  operatorContentResponseSchema,
  removableSlugs,
  saveDraftResponseSchema,
  saveLayoutResponseSchema,
  type CmsEntry,
  type CmsPage,
} from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Input, Switch, cn } from '@crm/ui';
import { ActionError, ErrorBlock, LoadingBlock, NS, operatorFetch, useCmsCanWrite } from './shared';

const KEY = ['operator', 'cms', 'content'];

type Device = 'desktop' | 'tablet' | 'mobile';
const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '820px', mobile: '390px' };
const DEVICE_ICON: Record<Device, string> = {
  desktop: 'M2 3h12v8H2zM6 13h4M8 11v2',
  tablet: 'M4 2h8v12H4zM7.5 12h1',
  mobile: 'M5 2h6v12H5zM7.5 12.5h1',
};

interface Selected {
  key: string;
  fieldType: string;
  urlKey?: string;
  url?: string;
}

type ConfirmKind = 'discard' | 'page' | 'site' | 'colours';

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** The draft if there is one, else what is live (an empty draft means "use the default"). */
const current = (e: CmsEntry | undefined): string | null => (e ? (e.draft ?? e.published) : null);

/** `wa.deep` as the preview's custom property. */
const cssVar = (tokenKey: string) => `--site-${tokenKey.replace('.', '-')}`;

/** `#abc` as `#aabbcc`: a colour input only accepts the long form. */
const longHex = (v: string) =>
  v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v;

/**
 * The site editor (WD-CMS-018..026, 028): the page itself in a frame, edited in place, with a side panel for the selected
 * field, the order and visibility of sections, brand presets and colours. Nothing is public until Publish.
 */
export function FrontendEditor({ initialPage }: { initialPage?: string }) {
  const t = useTranslations(`${NS}.frontend`);
  const tc = useTranslations(`${NS}.common`);
  const qc = useQueryClient();
  const canWrite = useCmsCanWrite();
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/cms/content', { schema: operatorContentResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  const [page, setPage] = useState<CmsPage>(
    CMS_PAGES.find((p) => p === initialPage) ?? CMS_PAGES[0],
  );
  const [device, setDevice] = useState<Device>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const entries = useMemo(
    () => new Map<string, CmsEntry>((q.data?.entries ?? []).map((e) => [e.key, e])),
    [q.data],
  );
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: KEY }), [qc]);
  const reloadFrame = useCallback(() => setFrameKey((n) => n + 1), []);

  // --- writes -------------------------------------------------------------------------------------------------------
  const saveDraft = useMutation({
    mutationFn: (entry: { key: string; value: string }) =>
      operatorFetch('/cms/content/draft', {
        method: 'PUT',
        body: { entries: [entry] },
        schema: saveDraftResponseSchema,
      }),
    onSuccess: refresh,
  });
  const layout = useMutation({
    mutationFn: (next: { hidden?: string[]; order?: string[] }) =>
      operatorFetch('/cms/content/layout', {
        method: 'PUT',
        body: { page, ...next },
        schema: saveLayoutResponseSchema,
      }),
    onSuccess: () => {
      void refresh();
      reloadFrame();
    },
  });
  const scoped = (path: 'publish' | 'discard') =>
    operatorFetch(`/cms/content/${path}`, {
      method: 'POST',
      body: { scope: 'all' },
      schema: countResponseSchema,
    });
  const publish = useMutation({
    mutationFn: () => scoped('publish'),
    onSuccess: (r) => {
      setNote(t('published', { count: r.count }));
      void refresh();
    },
  });
  const discard = useMutation({
    mutationFn: () => scoped('discard'),
    onSuccess: (r) => {
      setConfirm(null);
      setSelected(null);
      setNote(t('discarded', { count: r.count }));
      void refresh();
      reloadFrame();
    },
  });
  const reset = useMutation({
    mutationFn: (body: { key?: string; scope?: string }) =>
      operatorFetch('/cms/content/reset', { method: 'POST', body, schema: countResponseSchema }),
    onSuccess: () => {
      setConfirm(null);
      setSelected(null);
      void refresh();
      reloadFrame();
    },
  });
  const preset = useMutation({
    mutationFn: (id: string) =>
      operatorFetch('/cms/content/preset', { method: 'POST', body: { preset: id } }),
    onSuccess: () => {
      void refresh();
      reloadFrame();
    },
  });
  const homepage = useMutation({
    mutationFn: (enabled: boolean) =>
      operatorFetch('/cms/content/homepage', {
        method: 'PUT',
        body: { enabled },
        schema: homepageSwitchResponseSchema,
      }),
    onSuccess: refresh,
  });

  // --- the preview frame --------------------------------------------------------------------------------------------
  const themeValues = useCallback(
    () =>
      Object.fromEntries(
        THEME_TOKENS.map((tok) => [
          cssVar(tok.key),
          current(entries.get(`theme.${tok.key}`)) || tok.default,
        ]),
      ),
    [entries],
  );
  const post = useCallback((msg: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ source: 'fc', ...msg }, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.source !== 'fc') return;
      const d = e.data as {
        type: string;
        key?: string;
        fieldType?: string;
        value?: string;
        urlKey?: string;
        url?: string;
      };
      if (d.type === 'select' && d.key) {
        setSelected({ key: d.key, fieldType: d.fieldType ?? 'text', urlKey: d.urlKey, url: d.url });
        setLinkDraft(d.url ?? (d.fieldType === 'link' ? (d.value ?? '') : ''));
      } else if (d.type === 'edit' && d.key && typeof d.value === 'string' && canWrite) {
        saveDraft.mutate({ key: d.key, value: d.value });
      } else if (d.type === 'ready') {
        post({ type: 'theme', vars: themeValues() });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post, themeValues, saveDraft, canWrite]);

  // Colours edited in the panel show in the preview at once; the draft is saved after a short pause.
  const colourTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setColour = (tokenKey: string, value: string) => {
    post({ type: 'theme', vars: { [cssVar(tokenKey)]: value } });
    clearTimeout(colourTimer.current);
    colourTimer.current = setTimeout(
      () => saveDraft.mutate({ key: `theme.${tokenKey}`, value }),
      500,
    );
  };
  useEffect(() => () => clearTimeout(colourTimer.current), []);

  // --- sections of the current page ---------------------------------------------------------------------------------
  const def = CMS_REGISTRY[page];
  const keys = layoutKeys(page);
  const removable = removableSlugs(page);
  const hidden = parseList(current(entries.get(keys.hidden)));
  const saved = parseList(current(entries.get(keys.order)));
  const order = [
    ...saved.filter((s, i) => removable.includes(s) && saved.indexOf(s) === i),
    ...removable.filter((s) => !saved.includes(s)),
  ];
  const labelOf = (slug: string) => def.sections.find((s) => s.slug === slug)?.label ?? slug;
  const move = (slug: string, to: number) => {
    const next = order.filter((s) => s !== slug);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, slug);
    if (next.join() !== order.join()) layout.mutate({ order: next });
  };

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;

  const pending = q.data.pending;
  const saving = saveDraft.isPending || layout.isPending || preset.isPending;
  const failed = saveDraft.isError || layout.isError;
  const status = saving ? 'saving' : failed ? 'failed' : 'saved';
  const mutationError =
    saveDraft.error ??
    layout.error ??
    publish.error ??
    discard.error ??
    reset.error ??
    preset.error ??
    homepage.error;
  const confirmKind: ConfirmKind = confirm ?? 'discard';

  return (
    <div
      className={cn(
        'flex min-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-lg border border-border bg-background',
        fullscreen && 'fixed inset-0 z-50 min-h-0 rounded-none',
      )}
      data-testid="frontend-editor"
    >
      <h1 className="sr-only">{t('title')}</h1>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-muted p-1" role="tablist">
          {CMS_PAGES.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === page}
              data-fc-page={p}
              onClick={() => {
                setPage(p);
                setSelected(null);
              }}
              className={cn(
                'rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition',
                p === page
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {CMS_REGISTRY[p].label}
            </button>
          ))}
        </div>

        <div className="mx-auto flex items-center gap-0.5 rounded-full bg-muted p-1">
          {(Object.keys(DEVICE_WIDTH) as Device[]).map((d) => (
            <button
              key={d}
              type="button"
              title={t(`device.${d}`)}
              aria-label={t(`device.${d}`)}
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={cn(
                'inline-flex h-7 w-8 items-center justify-center rounded-full transition',
                device === d ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground',
              )}
            >
              <svg
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d={DEVICE_ICON[d]} />
              </svg>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"
            role="status"
            data-state={status}
          >
            <svg
              viewBox="0 0 16 16"
              className={cn('size-3.5', status === 'failed' ? 'text-danger' : 'text-success')}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d={status === 'failed' ? 'M4 4l8 8M12 4l-8 8' : 'M3.5 8.5 7 12l5.5-7'} />
            </svg>
            {t(`status.${status}`)}
          </span>
          {pending > 0 && (
            <span
              className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning"
              data-testid="pending-drafts"
            >
              {t('drafts', { count: pending })}
            </span>
          )}
          <button
            type="button"
            title={t('fullscreen')}
            aria-label={t('fullscreen')}
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path
                d={
                  fullscreen
                    ? 'M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4'
                    : 'M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4'
                }
              />
            </svg>
          </button>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title={t('openSite')}
            aria-label={t('openSite')}
            className="inline-flex size-9 items-center justify-center rounded-full border border-border hover:bg-muted"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M6 3H3v10h10V10M9 3h4v4M13 3 7 9" />
            </svg>
          </a>
          <label
            title={t('homepageHint')}
            className="inline-flex h-9 items-center gap-2.5 rounded-full border border-border px-3.5 text-[12px] font-semibold"
          >
            <span>{t('homepage')}</span>
            <Switch
              checked={q.data.homepageEnabled}
              label={t('homepage')}
              disabled={homepage.isPending || !canWrite}
              onCheckedChange={(v) => homepage.mutate(v)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!canWrite || pending === 0 || discard.isPending}
            onClick={() => setConfirm('discard')}
          >
            {t('discard')}
          </Button>
          <Button
            disabled={!canWrite || pending === 0 || publish.isPending}
            onClick={() => publish.mutate()}
          >
            {t('publish')}
          </Button>
        </div>
      </div>

      {(note || mutationError || !canWrite) && (
        <div className="space-y-2 border-b border-border px-4 py-2">
          {!canWrite && <Alert tone="info">{t('readOnly')}</Alert>}
          {note && (
            <Alert tone="success" role="status">
              {note}
            </Alert>
          )}
          <ActionError error={mutationError} />
        </div>
      )}

      {/* body */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-[60vh] min-w-0 flex-1 items-stretch justify-center overflow-auto bg-muted p-4 lg:min-h-0">
          <div
            className="mx-auto h-full min-h-[60vh] w-full overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition-[max-width] duration-300"
            style={{ maxWidth: DEVICE_WIDTH[device] }}
          >
            <iframe
              key={`${page}-${frameKey}`}
              ref={frame}
              src={`/frontend-preview/${page}`}
              title={t('previewTitle')}
              className="h-full min-h-[60vh] w-full border-0"
            />
          </div>
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-border lg:w-[360px] lg:border-s lg:border-t-0">
          <div className="border-b border-border bg-primary/5 px-5 py-4">
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
              {t('howTitle')}
            </p>
            <p className="text-[12px] leading-relaxed">{t('howBody')}</p>
          </div>

          <section className="border-b border-border px-5 py-4" aria-label={t('selected')}>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('selected')}
            </p>
            {!selected ? (
              <p className="text-[12px] text-muted-foreground">{t('selectedEmpty')}</p>
            ) : (
              <div data-testid="inspector">
                <div className="rounded-xl border border-border bg-muted px-3 py-2.5">
                  <div className="break-all font-mono text-[11.5px]" dir="ltr">
                    {selected.key}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">
                    {t('type')}: <span className="font-mono">{selected.fieldType}</span>
                  </div>
                </div>
                {selected.urlKey && (
                  <div className="mt-2.5">
                    <label
                      htmlFor="fc-link"
                      className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {t('linkTarget')}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id="fc-link"
                        dir="ltr"
                        value={linkDraft}
                        placeholder="https://..."
                        onChange={(e) => setLinkDraft(e.target.value)}
                      />
                      <Button
                        size="sm"
                        disabled={!canWrite || saveDraft.isPending}
                        onClick={() =>
                          saveDraft.mutate(
                            { key: selected.urlKey!, value: linkDraft.trim() },
                            { onSuccess: reloadFrame },
                          )
                        }
                      >
                        {t('set')}
                      </Button>
                    </div>
                  </div>
                )}
                <Button
                  variant="secondary"
                  className="mt-2.5 w-full"
                  disabled={!canWrite || reset.isPending}
                  onClick={() => reset.mutate({ key: selected.key })}
                >
                  {t('resetField')}
                </Button>
              </div>
            )}
          </section>

          <section className="border-b border-border px-5 py-4" aria-label={t('sections')}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t('sections')}
              </p>
              <span className="text-[10.5px] text-muted-foreground">{t('sectionsHint')}</span>
            </div>
            <ul className="space-y-1.5" data-testid="section-list">
              <li className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px]">
                <span className="flex-1">{def.sections[0]?.label}</span>
                <span className="text-[10.5px] text-muted-foreground">{t('pinned')}</span>
              </li>
              {order.map((slug, i) => (
                <li
                  key={slug}
                  draggable={canWrite}
                  onDragStart={() => setDragging(slug)}
                  onDragOver={(e) => dragging && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging && dragging !== slug) move(dragging, i);
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  data-section-slug={slug}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-[12.5px]',
                    hidden.includes(slug) && 'opacity-55',
                    dragging === slug && 'ring-2 ring-primary',
                  )}
                >
                  <span aria-hidden className="cursor-grab select-none px-1 text-muted-foreground">
                    ⋮⋮
                  </span>
                  <span className="min-w-0 flex-1 truncate">{labelOf(slug)}</span>
                  <button
                    type="button"
                    className="rounded px-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    disabled={!canWrite || i === 0 || layout.isPending}
                    aria-label={t('moveUp', { name: labelOf(slug) })}
                    onClick={() => move(slug, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    disabled={!canWrite || i === order.length - 1 || layout.isPending}
                    aria-label={t('moveDown', { name: labelOf(slug) })}
                    onClick={() => move(slug, i + 1)}
                  >
                    ↓
                  </button>
                  <Switch
                    checked={!hidden.includes(slug)}
                    label={t('showSection', { name: labelOf(slug) })}
                    disabled={!canWrite || layout.isPending}
                    onCheckedChange={(show) =>
                      layout.mutate({
                        hidden: show ? hidden.filter((h) => h !== slug) : [...hidden, slug],
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </section>

          <section className="border-b border-border px-5 py-4" aria-label={t('theme')}>
            <p className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('presets')}
            </p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-fc-preset={p.id}
                  disabled={!canWrite || preset.isPending}
                  onClick={() => preset.mutate(p.id)}
                  className="group flex flex-col items-center gap-1.5 rounded-xl border border-border px-2 py-2.5 transition hover:border-primary hover:bg-muted disabled:opacity-50"
                >
                  <span className="flex -space-x-1">
                    {Object.values(p.tokens)
                      .slice(0, 4)
                      .map((hex) => (
                        <span
                          key={hex}
                          className="size-4 rounded-full ring-1 ring-background"
                          style={{ background: hex }}
                        />
                      ))}
                  </span>
                  <span className="text-[11px] font-semibold">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('theme')}
            </p>
            {THEME_GROUPS.map((g) => (
              <div key={g} className="mb-3.5">
                <p className="mb-1.5 text-[11px] font-semibold">{THEME_GROUP_LABELS[g]}</p>
                <div className="space-y-1.5">
                  {THEME_TOKENS.filter((x) => x.group === g).map((tok) => {
                    const value = current(entries.get(`theme.${tok.key}`)) || tok.default;
                    return (
                      <label key={tok.key} className="flex items-center gap-2.5">
                        <input
                          type="color"
                          data-fc-color={tok.key}
                          value={longHex(value)}
                          disabled={!canWrite}
                          onChange={(e) => setColour(tok.key, e.target.value)}
                          className="size-7 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-0.5"
                        />
                        <span className="flex-1 text-[12px]">{tok.label}</span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {value}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={!canWrite}
              onClick={() => setConfirm('colours')}
            >
              {t('resetColours')}
            </Button>
          </section>

          <section className="px-5 py-4" aria-label={t('reset')}>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('reset')}
            </p>
            <div className="space-y-2">
              <Button
                variant="secondary"
                className="w-full"
                disabled={!canWrite}
                onClick={() => setConfirm('page')}
              >
                {t('resetPage')}
              </Button>
              <Button
                variant="danger"
                className="w-full"
                disabled={!canWrite}
                onClick={() => setConfirm('site')}
              >
                {t('resetSite')}
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t('siteWide')}{' '}
              <Link href="/admin/settings/site-info" className="underline">
                {t('siteInfoLink')}
              </Link>
            </p>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={t(`confirm.${confirmKind}.title`)}
        message={t(`confirm.${confirmKind}.message`)}
        confirmLabel={t(`confirm.${confirmKind}.action`)}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={discard.isPending || reset.isPending}
        onConfirm={() => {
          if (confirm === 'discard') discard.mutate();
          else if (confirm === 'page') reset.mutate({ scope: page });
          else if (confirm === 'site') reset.mutate({ scope: 'all' });
          else if (confirm === 'colours') reset.mutate({ scope: 'theme' });
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
