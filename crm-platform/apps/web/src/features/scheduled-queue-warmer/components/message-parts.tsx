'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  SCHEDULE_MEDIA_LIMITS,
  type ScheduleMedia,
  type ScheduleOptions,
  type ScheduleTemplate,
} from '@crm/contracts';
import { Button, Field, Input, Modal, cn } from '@crm/ui';
import { OverridesPanel } from '@/features/broadcasts/components/overrides-panel';
import { useAttributeCatalog } from '@/features/broadcasts/api/compose';
import { previewOf } from '@/features/broadcasts/lib/compose-model';
import { ApiError } from '@/lib/api/errors';
import { uploadScheduleMedia } from '../api/schedules';
import type { Draft } from '../lib/composer-model';
import { Icon } from './icons';

const MB = 1024 * 1024;
type Engine = 'waba' | 'twilio' | 'baileys';

/** The engines of the numbers ticked in step 1. */
export function engineOf(draft: Draft, options: Pick<ScheduleOptions, 'senders'>): Engine[] {
  return [
    ...new Set(
      draft.senders.flatMap((k) => {
        const e = options.senders.find((s) => s.key === k)?.engine;
        return e ? [e as Engine] : [];
      }),
    ),
  ];
}

/** The templates every ticked number may send: a Cloud API number takes only Meta-approved ones, the others the approved text. */
export function templatesFor(
  draft: Draft,
  options: Pick<ScheduleOptions, 'senders' | 'templates'>,
): ScheduleTemplate[] {
  const engines = engineOf(draft, options);
  return options.templates.filter((tpl) => engines.every((e) => tpl.usableOn.includes(e)));
}

// --- the template as the recipient sees it ---------------------------------------------------------------------------

/** The picked template in a phone bubble, the variables filled with the samples of the variable map (TW-SCHED-006). */
export function TemplateBubble({ template }: { template: ScheduleTemplate | undefined }) {
  const t = useTranslations('scheduled-queue-warmer.composer.message');
  const p = template ? previewOf(template) : null;
  if (!p) {
    return <div className="text-muted-foreground">{t('pickToPreview')}</div>;
  }
  return (
    <div data-testid="template-bubble">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground">
        <span>{template!.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-brand">{p.category}</span>
      </div>
      {p.media && (
        <div className="mb-2 flex h-16 items-center justify-center overflow-hidden rounded-md bg-muted font-mono text-[10.5px] text-brand">
          {p.media === 'image' && template!.attachmentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a sample from the workspace's own storage, shown once
            <img src={template!.attachmentUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            t('headerMedia', { kind: p.media })
          )}
        </div>
      )}
      {p.header && <div className="text-xs font-semibold">{p.header}</div>}
      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{p.body}</p>
      {p.footer && (
        <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
          {p.footer}
        </div>
      )}
      {p.buttons.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {p.buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-md bg-muted px-3 py-1.5 text-center text-xs font-semibold text-brand"
            >
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- the template step -----------------------------------------------------------------------------------------------

export function TemplateField({
  draft,
  set,
  options,
  error,
  initialOverrides,
}: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  options: ScheduleOptions;
  error: string | undefined;
  /** The overrides saved with the schedule being edited, to open the variable panel filled in. */
  initialOverrides: Record<string, unknown> | null;
}) {
  const t = useTranslations('scheduled-queue-warmer.composer.message');
  const catalog = useAttributeCatalog();
  const [picking, setPicking] = useState(false);
  const usable = useMemo(() => templatesFor(draft, options), [draft, options]);
  const chosen = options.templates.find((x) => x.id === draft.templateId);
  const onCloud = engineOf(draft, options).includes('waba');
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{t('template')} *</div>
      {chosen ? (
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{chosen.name}</div>
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {chosen.language} · {chosen.category}
              {chosen.senderLabel ? ` · ${chosen.senderLabel}` : ''}
            </div>
          </div>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
            {t('approved')}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            {t('change')}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="w-full rounded-lg border border-dashed border-border p-5 text-center hover:bg-muted/50"
        >
          <div className="text-[13px] font-semibold">{t('chooseTemplate')}</div>
          <div className="text-xs text-muted-foreground">{t('browse')}</div>
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
      {onCloud && <p className="mt-1.5 text-xs text-muted-foreground">{t('windowNote')}</p>}
      {chosen && (
        <>
          <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('previewSamples')}
            </div>
            <div className="max-w-[300px] rounded-lg bg-background p-3 shadow-sm">
              <TemplateBubble template={chosen} />
            </div>
          </div>
          <OverridesPanel
            key={chosen.id}
            template={chosen}
            catalog={catalog.data}
            initial={chosen.id === draft.templateId ? initialOverrides : null}
            onChange={(templateOverrides) => set({ templateOverrides })}
          />
        </>
      )}
      <TemplatePicker
        open={picking}
        templates={usable}
        hiddenCount={options.templates.length - usable.length}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          // Another template has other variables: what was typed for the old one does not carry over.
          set({ templateId: id, templateOverrides: null });
          setPicking(false);
        }}
      />
    </div>
  );
}

const CATEGORY_CHIPS = ['all', 'marketing', 'utility'] as const;

function TemplatePicker({
  open,
  templates,
  hiddenCount,
  onClose,
  onPick,
}: {
  open: boolean;
  templates: ScheduleTemplate[];
  hiddenCount: number;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const t = useTranslations('scheduled-queue-warmer.composer.message');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORY_CHIPS)[number]>('all');
  const shown = useMemo(
    () =>
      templates.filter(
        (x) =>
          (category === 'all' || x.category === category) &&
          `${x.name} ${x.language}`.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [templates, q, category],
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pickerTitle')}
      eyebrow={t('pickerEyebrow')}
      size="md"
      footer={
        <>
          <Link href="/templates" className="me-auto text-xs font-semibold text-brand">
            {t('manageTemplates')}
          </Link>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">{t('pickerHint')}</p>
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('pickerSearch')}
        aria-label={t('pickerSearch')}
      />
      <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label={t('pickerCategories')}>
        {CATEGORY_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold',
              category === c
                ? 'bg-brand text-brand-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            {t(`categories.${c}`)}
          </button>
        ))}
      </div>
      <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
        {shown.length === 0 && (
          <li className="py-6 text-center text-xs text-muted-foreground">{t('pickerEmpty')}</li>
        )}
        {shown.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              onClick={() => onPick(x.id)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-start hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{x.name}</span>
                {x.senderLabel && (
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {x.senderLabel}
                  </span>
                )}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] capitalize text-brand">
                {x.category}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{x.language}</span>
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('pickerHidden', { n: hiddenCount })}
        </p>
      )}
    </Modal>
  );
}

// --- the file step ---------------------------------------------------------------------------------------------------

const ACCEPT =
  'image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv';

/** The biggest each kind may be on every channel the ticked numbers use (the smallest limit wins). */
export function limitsFor(engines: readonly string[]) {
  const kinds = ['image', 'video', 'audio', 'document'] as const;
  return Object.fromEntries(
    kinds.map((k) => [
      k,
      Math.min(...(engines.length ? engines : ['baileys']).map((e) => SCHEDULE_MEDIA_LIMITS[e]?.[k] ?? 20 * MB)),
    ]),
  ) as Record<(typeof kinds)[number], number>;
}

export function MediaField({
  draft,
  set,
  options,
  error,
}: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  options: ScheduleOptions;
  error: string | undefined;
}) {
  const t = useTranslations('scheduled-queue-warmer.composer.message');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const limits = limitsFor(engineOf(draft, options));
  const file: ScheduleMedia | null = draft.mediaFile;

  async function pick(f: File | undefined) {
    if (!f) return;
    setFailure(null);
    // The biggest limit of any kind is the upload's own; the channel's limit for this kind is checked on the saved file below.
    if (f.size > 20 * MB) {
      setFailure(t('tooBigUpload', { mb: 20 }));
      return;
    }
    setBusy(true);
    try {
      set({ mediaFile: await uploadScheduleMedia(f), media: '' });
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : t('uploadFailed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-sm font-medium">{t('file')} *</div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={t('file')}
          data-testid="schedule-file-input"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Icon name="check" className="text-success" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{file.name}</div>
              <div className="font-mono text-[10.5px] text-muted-foreground">
                {t(`kinds.${file.kind}`)} · {(file.size / MB).toFixed(file.size < MB ? 2 : 1)} MB
              </div>
            </div>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? t('uploading') : t('replace')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => set({ mediaFile: null })}>
              {t('remove')}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="w-full rounded-lg border border-dashed border-border p-5 text-center hover:bg-muted/50 disabled:opacity-60"
          >
            <div className="text-[13px] font-semibold">
              {busy ? t('uploading') : t('chooseFile')}
            </div>
            <div className="text-xs text-muted-foreground">{t('fileHint')}</div>
          </button>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {t('limits', {
            image: Math.round(limits.image / MB),
            video: Math.round(limits.video / MB),
            audio: Math.round(limits.audio / MB),
            document: Math.round(limits.document / MB),
          })}
        </p>
        {failure && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {failure}
          </p>
        )}
      </div>
      {!file && (
        <Field
          label={t('orLink')}
          htmlFor="media-link"
          hint={t('mediaHint')}
          error={error}
        >
          <Input
            id="media-link"
            type="url"
            inputMode="url"
            value={draft.media}
            invalid={!!error}
            placeholder="https://example.com/offer.jpg"
            onChange={(e) => set({ media: e.target.value })}
          />
        </Field>
      )}
      {file && error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
