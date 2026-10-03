'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Field, Select, Spinner, Textarea, cn } from '@crm/ui';
import { fetchEvents, leadKeys, previewMapping } from '../api';
import { buildPreviewBody, previewIsPossible, type SourceDraft } from '../lib/draft';
import { parsePayload } from '../lib/payload';
import {
  previewIsReady,
  previewKey,
  previewView,
  type PreviewSource,
  type PreviewView,
} from '../lib/preview-view';
import { PREVIEW_DELAY_MS, useSettled } from '../lib/use-settled';
import { PathsDatalist } from './mapping-fields';
import { ErrorText } from './ui';

const MAX_CHIPS = 80;

/**
 * The live preview of a mapping (L-05): what the draft mapping makes of a payload, field by field, and whether the lead would be
 * processed. It reads a payload the person pasted, the last lead the source still holds, or a stored lead they pick; the last two
 * need an explicit choice because reading a stored payload is recorded in the audit log. The call waits for the draft to settle
 * (500 ms) and an answer to an older draft is dropped. Nothing is written.
 */
export function MappingPreview({
  sourceId,
  draft,
  onPick,
  focusedLabel,
}: {
  sourceId: string;
  draft: SourceDraft;
  /** An available-path chip was clicked: fill the focused mapping input. */
  onPick: (path: string) => void;
  /** The name of the focused mapping input, or null when none was focused yet. */
  focusedLabel: string | null;
}) {
  const t = useTranslations('lead-sources.preview');
  const [text, setText] = useState('');
  const [source, setSource] = useState<PreviewSource | null>(null);

  const parsed = useMemo(() => (text.trim() === '' ? null : parsePayload(text)), [text]);
  const possible = previewIsPossible(draft);

  const body = useMemo(() => {
    if (!source || !previewIsReady(source) || !possible) return '';
    const pick =
      source.kind === 'paste'
        ? { payload: source.payload ?? undefined }
        : source.kind === 'event'
          ? { eventId: source.eventId }
          : {};
    return previewKey(buildPreviewBody(draft, pick));
  }, [draft, source, possible]);

  const settled = useSettled(body, PREVIEW_DELAY_MS);
  const query = useQuery({
    queryKey: ['lead-sources', 'preview', sourceId, settled],
    queryFn: async ({ signal }): Promise<PreviewView> =>
      previewView(
        await previewMapping(
          sourceId,
          JSON.parse(settled) as ReturnType<typeof buildPreviewBody>,
          signal,
        ),
      ),
    enabled: settled !== '',
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });

  // Stored leads the person may map against: the list carries no payload, so reading it is not audited.
  const stored = useQuery({
    queryKey: leadKeys.events(sourceId, 'preview-picker', 'all'),
    queryFn: ({ signal }) => fetchEvents(sourceId, { limit: 10 }, signal),
    staleTime: 60_000,
    retry: false,
  });
  const storedEvents = (stored.data?.data ?? []).filter((e) => e.hasPayload);

  const updating = body !== settled || (query.isFetching && !query.isPending);
  const view = body === '' ? undefined : query.data;

  return (
    <section
      aria-labelledby="ls-preview-title"
      aria-busy={updating}
      className="space-y-4 rounded-md border border-border bg-background p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 id="ls-preview-title" className="text-base font-semibold">
          {t('title')}
        </h3>
        <span
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {updating && (
            <>
              <Spinner label={t('updating')} />
              {t('updating')}
            </>
          )}
        </span>
      </header>
      <p className="text-xs text-muted-foreground">{t('help')}</p>

      <Field
        label={t('paste')}
        htmlFor="ls-preview-paste"
        hint={t('pasteHint')}
        error={parsed && !parsed.ok ? t(`pasteProblems.${parsed.reason}`) : undefined}
      >
        <Textarea
          id="ls-preview-paste"
          dir="ltr"
          rows={6}
          spellCheck={false}
          value={text}
          placeholder='{ "name": "Asha Rao", "phone": "+12025550123" }'
          invalid={Boolean(parsed && !parsed.ok)}
          className="font-mono text-xs"
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            const p = v.trim() === '' ? null : parsePayload(v);
            if (p?.ok) setSource({ kind: 'paste', payload: p.payload });
            else if (source?.kind === 'paste') setSource(null);
          }}
        />
      </Field>

      <div className="space-y-2 rounded-md bg-muted p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-pressed={source?.kind === 'last'}
            onClick={() => setSource({ kind: 'last' })}
          >
            {t('useLast')}
          </Button>
          {storedEvents.length > 0 && (
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="ls-preview-stored" className="sr-only">
                {t('pickStored')}
              </label>
              <Select
                id="ls-preview-stored"
                value={source?.kind === 'event' ? source.eventId : ''}
                onChange={(e) =>
                  setSource(e.target.value ? { kind: 'event', eventId: e.target.value } : null)
                }
              >
                <option value="">{t('pickStored')}</option>
                {storedEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {t('storedOption', { id: e.externalId.slice(0, 24), status: e.status })}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('auditNote')}</p>
      </div>

      {!possible ? (
        <Alert tone="warning">{t('fixDraft')}</Alert>
      ) : !source || !previewIsReady(source) ? (
        <p className="text-sm text-muted-foreground">{t('choose')}</p>
      ) : query.isError && body !== '' ? (
        <ErrorText error={query.error} onRetry={() => void query.refetch()} />
      ) : view ? (
        <PreviewResult view={view} onPick={onPick} focusedLabel={focusedLabel} />
      ) : (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      )}
      <PathsDatalist paths={view?.availablePaths ?? []} />
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words" dir="auto">
        {children}
      </dd>
    </div>
  );
}

/** The answer of the preview, read only. Pure: it is given the view-model. */
export function PreviewResult({
  view,
  onPick,
  focusedLabel,
}: {
  view: PreviewView;
  onPick?: (path: string) => void;
  focusedLabel?: string | null;
}) {
  const t = useTranslations('lead-sources.preview');
  const none = <span className="text-muted-foreground">{t('empty')}</span>;
  const c = view.contact;

  if (view.state === 'none') {
    return (
      <Alert tone="info" data-testid="preview-none">
        {t('none')}
      </Alert>
    );
  }
  return (
    <div className="space-y-4" data-testid="preview-result">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={view.usable ? 'success' : 'warning'}>
          {view.usable ? t('usable') : t('notUsable')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {view.basedOn === 'event' ? t('basedOnEvent') : t('basedOnPayload')}
          {view.externalId ? ` · ${t('externalId', { id: view.externalId })}` : ''}
        </span>
      </div>

      {view.reasons.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={t('reasonsLabel')}>
          {view.reasons.map((r) => (
            <li key={r.code} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{r.known ? t(`reasons.${r.code}`) : r.code}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="divide-y divide-border rounded-md border border-border px-3">
        <Row label={t('contact.name')}>{c.name ?? none}</Row>
        <Row label={t('contact.firstName')}>{c.firstName ?? none}</Row>
        <Row label={t('contact.lastName')}>{c.lastName ?? none}</Row>
        <Row label={t('contact.email')}>{c.email ?? none}</Row>
        <Row label={t('contact.phone')}>
          {c.phoneState === 'none' ? (
            none
          ) : c.phoneState === 'ok' ? (
            <span dir="ltr">
              {c.phoneRaw && c.phoneRaw !== c.phone ? `${c.phoneRaw} → ` : ''}
              {c.phone}
            </span>
          ) : (
            <span>
              <span dir="ltr">{c.phoneRaw}</span>{' '}
              <Badge tone="warning">{t('phoneUnreadable')}</Badge>
            </span>
          )}
        </Row>
        {view.customFields.map((f) => (
          <Row key={f.key} label={f.key}>
            {f.value}
          </Row>
        ))}
        {view.attribution
          .filter((a) => a.value)
          .map((a) => (
            <Row key={a.field} label={t(`attribution.${a.field}`)}>
              {a.value}
            </Row>
          ))}
      </dl>

      {view.availablePaths.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t('paths')}</h4>
          <p className="text-xs text-muted-foreground">
            {focusedLabel ? t('pathsPick', { field: focusedLabel }) : t('pathsFocusFirst')}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {view.availablePaths.slice(0, MAX_CHIPS).map((p) => (
              <li key={p}>
                <button
                  type="button"
                  dir="ltr"
                  // mouse-down, not click: the focused input would blur first and lose its place
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick?.(p)}
                  disabled={!onPick}
                  className={cn(
                    'rounded-full border border-border bg-muted px-2.5 py-1 text-xs',
                    'hover:border-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60',
                  )}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
          {view.availablePaths.length > MAX_CHIPS && (
            <p className="text-xs text-muted-foreground">
              {t('pathsMore', { count: view.availablePaths.length - MAX_CHIPS })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
