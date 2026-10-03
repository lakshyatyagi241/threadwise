'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { AudiencePreview, ScheduleOptions } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Switch, Textarea, cn } from '@crm/ui';
import {
  PLAIN_LIMIT,
  WEEKDAYS,
  estimateMinutes,
  senderLabels,
  serverFieldError,
  type Draft,
  type StepErrors,
} from '../lib/composer-model';
import { timezoneList } from '../lib/time';
import { Icon } from './icons';

export interface StepProps {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  /** Local check results for this step, as `composer.errors` keys by field. */
  errors: StepErrors;
  /** What the server rejected last time. */
  server: Array<{ path: string; message: string }>;
  options: ScheduleOptions;
}

/** The message under a field: our own check first, else what the server said about it. */
function useFieldError({ errors, server }: Pick<StepProps, 'errors' | 'server'>) {
  const t = useTranslations('scheduled-queue-warmer.composer.errors');
  return (field: string) => (errors[field] ? t(errors[field]!) : serverFieldError(server, field));
}

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** A tile in a "pick one" row (message type, recipient source, send mode). */
function Tile({
  selected,
  title,
  hint,
  onSelect,
  name,
}: {
  selected: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
  name: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 hover:bg-muted/50',
        selected ? 'border-brand bg-brand/5 ring-2 ring-brand/20' : 'border-border',
      )}
    >
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="sr-only" />
      <span className="text-[12.5px] font-semibold">{title}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
      {selected && <Icon name="check" className="absolute end-2 top-2 text-brand" />}
    </label>
  );
}

function StepHead({ n, title, tag }: { n: number; title: string; tag: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="font-mono text-[11px] text-brand">{String(n).padStart(2, '0')}</span>
      <h2 className="text-base font-semibold">{title}</h2>
      <span className="ms-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {tag}
      </span>
    </div>
  );
}

// --- 1: basics -------------------------------------------------------------------------------------------------------

export function BasicsStep(p: StepProps) {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const err = useFieldError(p);
  const { draft, set, options } = p;
  const engines = [...new Set(options.senders.map((s) => s.engine))];
  const multi = options.senders.length > 1;
  return (
    <div className="space-y-5">
      <StepHead n={1} title={t('basics.title')} tag={t('required')} />
      <Field
        label={`${t('basics.name')} *`}
        htmlFor="sch-name"
        hint={t('basics.nameHint')}
        error={err('name')}
      >
        <Input
          id="sch-name"
          value={draft.name}
          maxLength={255}
          invalid={!!err('name')}
          placeholder={t('basics.namePlaceholder')}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-sm font-medium">
          <span>{multi ? t('basics.senders') : t('basics.sender')} *</span>
          {multi && (
            <span className="font-mono text-[10px] font-normal text-brand">
              {t('basics.tickAll')}
            </span>
          )}
        </div>
        {options.senders.length === 0 ? (
          <Alert tone="danger">{t('basics.noSenders')}</Alert>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
            {engines.map((engine) => (
              <div key={engine}>
                {engines.length > 1 && (
                  <div className="bg-muted/60 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t.has(`engine.${engine}`) ? t(`engine.${engine}`) : engine}
                  </div>
                )}
                {options.senders
                  .filter((s) => s.engine === engine)
                  .map((s) => (
                    <label
                      key={s.key}
                      className="flex cursor-pointer items-center gap-2.5 border-t border-border px-3 py-2 first:border-t-0"
                    >
                      <input
                        type="checkbox"
                        checked={draft.senders.includes(s.key)}
                        onChange={() =>
                          set({ senders: multi ? toggle(draft.senders, s.key) : [s.key] })
                        }
                        className="size-4 accent-[var(--primary)]"
                      />
                      <span className="text-[12.5px] font-medium">{s.label}</span>
                      {s.warming && (
                        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                          {t('basics.warming')}
                        </span>
                      )}
                      <span className="ms-auto font-mono text-[10.5px] text-muted-foreground">
                        {s.phone ?? ''}
                      </span>
                    </label>
                  ))}
              </div>
            ))}
          </div>
        )}
        {err('senders') && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {err('senders')}
          </p>
        )}
        {multi && <p className="mt-1.5 text-xs text-muted-foreground">{t('basics.splitHint')}</p>}
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium">{t('basics.messageType')} *</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="radiogroup">
          {(['plain', 'template', 'media', 'location'] as const).map((m) => (
            <Tile
              key={m}
              name="msg-type"
              selected={draft.messageType === m}
              title={t(`types.${m}.title`)}
              hint={t(`types.${m}.hint`)}
              onSelect={() => set({ messageType: m })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- 2: audience -----------------------------------------------------------------------------------------------------

export function AudienceStep({
  preview,
  previewing,
  ...p
}: StepProps & { preview?: AudiencePreview; previewing: boolean }) {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const err = useFieldError(p);
  const { draft, set, options } = p;
  const empty = (what: string, href: string, link: string) => (
    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
      <div className="font-semibold text-foreground">{t(`audience.no${what}`)}</div>
      <Link href={href} className="text-brand underline">
        {link}
      </Link>
    </div>
  );
  const list = <T extends { id: string }>(
    items: T[],
    ids: string[],
    key: 'groupIds' | 'tagIds' | 'queueIds',
    label: (x: T) => string,
    count: (x: T) => number,
  ) => (
    <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
      {items.map((x) => (
        <label
          key={x.id}
          className={cn(
            'flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5',
            ids.includes(x.id) ? 'border-brand bg-brand/5' : 'border-border',
          )}
        >
          <input
            type="checkbox"
            checked={ids.includes(x.id)}
            onChange={() => set({ [key]: toggle(ids, x.id) } as Partial<Draft>)}
            className="size-4 accent-[var(--primary)]"
          />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{label(x)}</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {count(x).toLocaleString('en-US')}
          </span>
        </label>
      ))}
    </div>
  );

  const fieldMsg = err(
    { group: 'groupIds', tag: 'tagIds', queue: 'queueIds', number: 'numbers' }[draft.recipientType],
  );
  return (
    <div className="space-y-5">
      <StepHead n={2} title={t('audience.title')} tag={t('required')} />
      <div>
        <div className="mb-1.5 text-sm font-medium">{t('audience.source')}</div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="radiogroup">
          {(['group', 'tag', 'queue', 'number'] as const).map((r) => (
            <Tile
              key={r}
              name="rcp-type"
              selected={draft.recipientType === r}
              title={t(`audience.sources.${r}.title`)}
              hint={t(`audience.sources.${r}.hint`)}
              onSelect={() => set({ recipientType: r })}
            />
          ))}
        </div>
      </div>

      {draft.recipientType === 'group' && (
        <div>
          <div className="mb-1.5 text-sm font-medium">
            {t('audience.chooseGroups')}{' '}
            <span className="font-normal text-muted-foreground">{t('audience.tickAny')}</span>
          </div>
          {options.groups.length === 0
            ? empty('Groups', '/contacts', t('audience.contacts'))
            : list(
                options.groups,
                draft.groupIds,
                'groupIds',
                (g) => g.name,
                (g) => g.members,
              )}
        </div>
      )}
      {draft.recipientType === 'tag' && (
        <div>
          <div className="mb-1.5 text-sm font-medium">{t('audience.chooseTags')}</div>
          {options.tags.length === 0
            ? empty('Tags', '/contacts', t('audience.contacts'))
            : list(
                options.tags,
                draft.tagIds,
                'tagIds',
                (g) => g.name,
                (g) => g.contacts,
              )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t('audience.tagsHint')}</p>
        </div>
      )}
      {draft.recipientType === 'queue' && (
        <div>
          <div className="mb-1.5 text-sm font-medium">{t('audience.chooseQueues')}</div>
          {options.queues.length === 0
            ? empty('Queues', '/broadcasts', t('audience.broadcast'))
            : list(
                options.queues,
                draft.queueIds,
                'queueIds',
                (g) => g.name,
                (g) => g.recipients,
              )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t('audience.queuesHint')}</p>
        </div>
      )}
      {draft.recipientType === 'number' && (
        <Field
          label={t('audience.paste')}
          htmlFor="rcp-numbers"
          hint={t('audience.pasteHint')}
          error={err('numbers')}
        >
          <Textarea
            id="rcp-numbers"
            rows={4}
            value={draft.numbersText}
            invalid={!!err('numbers')}
            placeholder={t('audience.pastePlaceholder')}
            onChange={(e) => set({ numbersText: e.target.value })}
          />
        </Field>
      )}
      {draft.recipientType !== 'number' && fieldMsg && (
        <p role="alert" className="text-xs text-danger">
          {fieldMsg}
        </p>
      )}

      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12.5px]">
        <div>
          {t('audience.total')}{' '}
          <b id="rcp-total">{previewing ? '…' : (preview?.total ?? 0).toLocaleString('en-US')}</b>
        </div>
        {preview && preview.optedOut > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('audience.optedOut', { n: preview.optedOut.toLocaleString('en-US') })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- 3: message ------------------------------------------------------------------------------------------------------

const PLACEHOLDER = /\{[a-z_]+\}/gi;

export function MessageStep({ total, ...p }: StepProps & { total: number }) {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const err = useFieldError(p);
  const { draft, set, options } = p;
  const [picking, setPicking] = useState(false);
  const tpl = options.templates.find((x) => x.id === draft.templateId);
  const vars = (draft.message.match(PLACEHOLDER) ?? []).length;
  const insert = (v: string) => set({ message: draft.message + v });
  return (
    <div className="space-y-5">
      <StepHead n={3} title={t('message.title')} tag={t(`types.${draft.messageType}.pill`)} />

      {(draft.messageType === 'plain' || draft.messageType === 'media') && (
        <div>
          <label htmlFor="msg-content" className="mb-1.5 block text-sm font-medium">
            {draft.messageType === 'media' ? t('message.caption') : t('message.content')}
          </label>
          <div className="rounded-lg border border-border">
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              {(['{name}', '{phone}', '{email}'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insert(v)}
                  className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] hover:bg-muted/70"
                >
                  {v}
                </button>
              ))}
              <span className="ms-auto font-mono text-[10.5px] text-muted-foreground">
                <span id="char-count">{draft.message.length}</span> / {PLAIN_LIMIT}
              </span>
            </div>
            <textarea
              id="msg-content"
              rows={6}
              value={draft.message}
              maxLength={PLAIN_LIMIT}
              aria-invalid={!!err('message') || undefined}
              placeholder={t('message.placeholder')}
              onChange={(e) => set({ message: e.target.value })}
              className="w-full resize-y rounded-b-lg bg-background px-3 py-2 text-sm outline-none"
            />
          </div>
          {err('message') && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {err('message')}
            </p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">{t('message.personalise')}</p>
        </div>
      )}

      {draft.messageType === 'template' && (
        <div>
          <div className="mb-1.5 text-sm font-medium">{t('message.template')}</div>
          {tpl ? (
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{tpl.name}</div>
                <div className="font-mono text-[10.5px] text-muted-foreground">{tpl.language}</div>
              </div>
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                {t('message.approved')}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                {t('message.change')}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="w-full rounded-lg border border-dashed border-border p-5 text-center hover:bg-muted/50"
            >
              <div className="text-[13px] font-semibold">{t('message.chooseTemplate')}</div>
              <div className="text-xs text-muted-foreground">{t('message.browse')}</div>
            </button>
          )}
          {err('templateId') && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {err('templateId')}
            </p>
          )}
          <TemplatePicker
            open={picking}
            templates={options.templates}
            onClose={() => setPicking(false)}
            onPick={(id) => {
              set({ templateId: id });
              setPicking(false);
            }}
          />
        </div>
      )}

      {draft.messageType === 'media' && (
        <Field
          label={`${t('message.mediaLink')} *`}
          htmlFor="media-link"
          hint={t('message.mediaHint')}
          error={err('media')}
        >
          <Input
            id="media-link"
            type="url"
            inputMode="url"
            value={draft.media}
            invalid={!!err('media')}
            placeholder="https://example.com/offer.jpg"
            onChange={(e) => set({ media: e.target.value })}
          />
        </Field>
      )}

      {draft.messageType === 'location' && (
        <div>
          <div className="mb-1.5 text-sm font-medium">{t('message.pin')} *</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('message.latitude')} htmlFor="loc-lat" error={err('latitude')}>
              <Input
                id="loc-lat"
                inputMode="decimal"
                value={draft.latitude}
                invalid={!!err('latitude')}
                placeholder="26.9124"
                onChange={(e) => set({ latitude: e.target.value })}
              />
            </Field>
            <Field label={t('message.longitude')} htmlFor="loc-lng" error={err('longitude')}>
              <Input
                id="loc-lng"
                inputMode="decimal"
                value={draft.longitude}
                invalid={!!err('longitude')}
                placeholder="75.7873"
                onChange={(e) => set({ longitude: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('message.estimate')}
          </div>
          <div className="mt-1 text-lg font-semibold">
            {total > 0 ? t('message.minutes', { n: estimateMinutes(total) }) : '—'}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {total > 0 ? t('message.estimateHint') : t('message.estimateEmpty')}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('message.variables')}
          </div>
          <div className="mt-1 text-lg font-semibold">{vars}</div>
          <div className="text-[11px] text-muted-foreground">{t('message.variablesHint')}</div>
        </div>
      </div>
    </div>
  );
}

function TemplatePicker({
  open,
  templates,
  onClose,
  onPick,
}: {
  open: boolean;
  templates: ScheduleOptions['templates'];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const t = useTranslations('scheduled-queue-warmer.composer.message');
  const [q, setQ] = useState('');
  const shown = useMemo(
    () =>
      templates.filter((x) =>
        `${x.name} ${x.language}`.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [templates, q],
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
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{x.name}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{x.language}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// --- 4: schedule -----------------------------------------------------------------------------------------------------

export function WhenStep(p: StepProps) {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const err = useFieldError(p);
  const { draft, set } = p;
  const zones = useState(timezoneList)[0];
  const dayNames = useMemo(() => {
    const f = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
    // 2023-01-01 was a Sunday.
    return WEEKDAYS.map((d) => f.format(new Date(Date.UTC(2023, 0, 1 + d))));
  }, []);
  return (
    <div className="space-y-5">
      <StepHead n={4} title={t('when.title')} tag={t('required')} />
      <div className="grid grid-cols-2 gap-3" role="radiogroup">
        {(['once', 'recurring'] as const).map((m) => (
          <Tile
            key={m}
            name="sch-mode"
            selected={draft.scheduleType === m}
            title={t(`when.modes.${m}.title`)}
            hint={t(`when.modes.${m}.hint`)}
            onSelect={() => set({ scheduleType: m })}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('when.date')} htmlFor="sch-date" error={err('sendDate')}>
          <Input
            id="sch-date"
            type="date"
            value={draft.sendDate}
            invalid={!!err('sendDate')}
            onChange={(e) => set({ sendDate: e.target.value })}
          />
        </Field>
        <Field label={t('when.time')} htmlFor="sch-time" error={err('sendTime')}>
          <Input
            id="sch-time"
            type="time"
            value={draft.sendTime}
            invalid={!!err('sendTime')}
            onChange={(e) => set({ sendTime: e.target.value })}
          />
        </Field>
        <Field label={t('when.timezone')} htmlFor="sch-tz" error={err('timezone')}>
          <Select
            id="sch-tz"
            value={draft.timezone}
            invalid={!!err('timezone')}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            {[...new Set([draft.timezone, ...zones])].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {draft.scheduleType === 'recurring' && (
        <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('when.recurrence')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('when.every')} htmlFor="rep-every" error={err('repeatEvery')}>
              <div className="flex gap-2">
                <Input
                  id="rep-every"
                  type="number"
                  min={1}
                  max={365}
                  value={draft.repeatEvery}
                  invalid={!!err('repeatEvery')}
                  onChange={(e) => set({ repeatEvery: e.target.value })}
                  className="w-20"
                />
                <Select
                  aria-label={t('when.interval')}
                  value={draft.repeatInterval}
                  onChange={(e) =>
                    set({ repeatInterval: e.target.value as Draft['repeatInterval'] })
                  }
                >
                  {(['daily', 'weekly', 'monthly'] as const).map((i) => (
                    <option key={i} value={i}>
                      {t(`when.intervals.${i}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label={t('when.end')} htmlFor="rep-end">
              <Select
                id="rep-end"
                value={draft.endMode}
                onChange={(e) => set({ endMode: e.target.value as Draft['endMode'] })}
              >
                <option value="never">{t('when.endNever')}</option>
                <option value="date">{t('when.endDate')}</option>
              </Select>
            </Field>
          </div>
          {draft.endMode === 'date' && (
            <Field label={t('when.endOn')} htmlFor="rep-end-date" error={err('endDate')}>
              <Input
                id="rep-end-date"
                type="date"
                value={draft.endDate}
                min={draft.sendDate}
                invalid={!!err('endDate')}
                onChange={(e) => set({ endDate: e.target.value })}
              />
            </Field>
          )}
          {draft.repeatInterval === 'weekly' && (
            <div>
              <div className="mb-1.5 text-sm font-medium">{t('when.days')}</div>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={draft.daysOfWeek.includes(d)}
                    onClick={() => set({ daysOfWeek: toggle(draft.daysOfWeek, d) })}
                    className={cn(
                      'h-8 min-w-12 rounded-full border px-3 text-xs font-semibold',
                      draft.daysOfWeek.includes(d)
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-border hover:bg-muted',
                    )}
                  >
                    {dayNames[d]}
                  </button>
                ))}
              </div>
              {err('daysOfWeek') ? (
                <p role="alert" className="mt-1.5 text-xs text-danger">
                  {err('daysOfWeek')}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">{t('when.daysHint')}</p>
              )}
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t('when.lead', { n: p.options.minLeadMinutes })}
      </p>
    </div>
  );
}

// --- 5: review -------------------------------------------------------------------------------------------------------

export function ReviewStep({ preview, ...p }: StepProps & { preview?: AudiencePreview }) {
  const t = useTranslations('scheduled-queue-warmer.composer');
  const err = useFieldError(p);
  const { draft, set, options } = p;
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3 py-1.5 text-[12.5px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{value}</dd>
    </div>
  );
  const when =
    draft.scheduleType === 'recurring'
      ? t('review.recurring', {
          n: draft.repeatEvery,
          interval: t(`when.intervals.${draft.repeatInterval}`),
        })
      : t('review.once');
  return (
    <div className="space-y-5">
      <StepHead n={5} title={t('review.title')} tag={t('review.final')} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('review.schedule')}
          </div>
          <dl className="divide-y divide-border">
            {row(t('review.name'), draft.name.trim() || '—')}
            {row(t('review.sender'), senderLabels(draft.senders, options.senders) || '—')}
            {row(t('review.type'), t(`types.${draft.messageType}.title`))}
            {row(t('review.mode'), when)}
            {row(t('review.at'), `${draft.sendDate} ${draft.sendTime} · ${draft.timezone}`)}
          </dl>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('review.delivery')}
          </div>
          <dl className="divide-y divide-border">
            {row(t('review.source'), t(`audience.sources.${draft.recipientType}.title`))}
            {row(t('review.recipients'), preview ? preview.total.toLocaleString('en-US') : '—')}
            {row(
              t('review.estimated'),
              preview && preview.total > 0
                ? t('message.minutes', { n: estimateMinutes(preview.total) })
                : '—',
            )}
          </dl>
          {preview && preview.optedOut > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('audience.optedOut', { n: preview.optedOut.toLocaleString('en-US') })}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[13px] font-semibold">{t('review.testTitle')}</div>
            <div className="text-xs text-muted-foreground">{t('review.testHint')}</div>
          </div>
          <Switch
            checked={draft.sendTest}
            onCheckedChange={(v) => set({ sendTest: v })}
            label={t('review.testTitle')}
            id="sched-send-test"
          />
        </div>
        {draft.sendTest && (
          <Field
            label={t('review.testNumber')}
            htmlFor="sched-test-number"
            error={err('testNumber')}
            className="mt-3"
            hint={t('review.testNumberHint')}
          >
            <Input
              id="sched-test-number"
              inputMode="tel"
              value={draft.testNumber}
              invalid={!!err('testNumber')}
              placeholder="919876543210"
              onChange={(e) => set({ testNumber: e.target.value })}
            />
          </Field>
        )}
      </div>
    </div>
  );
}
