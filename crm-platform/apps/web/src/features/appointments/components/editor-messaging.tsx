'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Field, Input, Select, Textarea, cn } from '@crm/ui';
import { ConsentNoticeEditor } from '@/features/contact-consent';
import {
  QUESTION_TYPES,
  TEMPLATE_EVENTS,
  type QuestionType,
  type TemplateEvent,
} from '../api/schemas';
import {
  LIMITS,
  type QuestionDraft,
  type TemplateChannel,
  type TemplateDraft,
} from '../lib/booking-form';
import { PLACEHOLDERS, insertAtRange, moveItem, newQuestion } from '../lib/editor';
import { REMINDER_MAX_RULES } from '../lib/reminder-rules';
import { useAppointmentChannels, useMessageLibrary, useWaTemplates } from '../api/hooks';
import {
  CHANNEL_ORDER,
  CONNECT_HREF,
  useOfChannel,
  usableChannels,
} from '../lib/channel-availability';
import { ReminderRulesEditor } from './reminder-rules-editor';
import { SectionCard, chipClass, iconButtonClass, useEditor } from './editor-shared';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './icons';

const MAP_FIELDS = ['email', 'name', 'mobile'] as const;

/** The placeholder tokens as literal text for a message's example (a value is never read as message syntax). */
const TOKEN_VALUES = {
  type: '{{type}}',
  slot: '{{slot}}',
  name: '{{name}}',
  manage_link: '{{manage_link}}',
} as const;

/** Step 5: the four lifecycle messages, the reminders, and the questions asked at booking. */
export function MessagingStep() {
  const { typeId } = useEditor();
  return (
    <div className="space-y-4">
      <ChannelStrip />
      <LifecycleMessages />
      <Reminders />
      <Questionnaire />
      <ConsentNoticeEditor scope="booking" refId={typeId ?? ''} disabled={typeId === null} />
    </div>
  );
}

function LifecycleMessages() {
  const t = useTranslations('appointments.editor.messages');
  const { draft, update, err, fid, disabled } = useEditor();
  const refs = useRef<Partial<Record<TemplateEvent, HTMLTextAreaElement | null>>>({});
  const [active, setActive] = useState<TemplateEvent>('confirmation');
  const channelStates = useAppointmentChannels().data;
  const library = useMessageLibrary().data;
  const attachable = usableChannels(channelStates, TEMPLATE_CHANNELS);

  // A text has to be attached to a channel to be sent: typing one into a message with no channel attaches the channels that are usable.
  const setBody = (event: TemplateEvent, plainBody: string) =>
    update((d) => {
      const cur = d.templates[event];
      const channels =
        cur.channels.length === 0 && plainBody.trim() !== '' ? attachable : cur.channels;
      return { ...d, templates: { ...d.templates, [event]: { ...cur, plainBody, channels } } };
    });

  const patchEvent = (event: TemplateEvent, change: Partial<TemplateDraft>) =>
    update((d) => ({
      ...d,
      templates: { ...d.templates, [event]: { ...d.templates[event], ...change } },
    }));

  function insert(token: string) {
    const el = refs.current[active];
    const current = draft.templates[active].plainBody;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const result = insertAtRange(current, token, start, end, LIMITS.templateMax);
    if (!result) return;
    setBody(active, result.text);
    // put the caret after the inserted text once the box has its new value
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.caret, result.caret);
    });
  }

  return (
    <SectionCard title={t('title')} hint={t('hint')}>
      <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="text-xs font-medium">{t('placeholdersTitle')}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('placeholdersHint', { event: t(`events.${active}`) })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PLACEHOLDERS.map((token) => (
            <button
              key={token}
              type="button"
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(token)}
              className={cn(chipClass, 'font-mono')}
              title={t(
                `placeholderMeaning.${token.slice(2, -2) as 'type' | 'slot' | 'name' | 'manage_link'}`,
              )}
            >
              {token}
            </button>
          ))}
        </div>
        <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
          {PLACEHOLDERS.map((token) => (
            <li key={token}>
              <code dir="ltr" className="font-mono text-foreground">
                {token}
              </code>{' '}
              {t(
                `placeholderMeaning.${token.slice(2, -2) as 'type' | 'slot' | 'name' | 'manage_link'}`,
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        {TEMPLATE_EVENTS.map((event) => {
          const body = draft.templates[event].plainBody;
          return (
            <div
              key={event}
              className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3"
            >
              <label htmlFor={fid(`tpl-${event}`)} className="pt-2 text-sm font-semibold">
                {t(`events.${event}`)}
              </label>
              <div className="min-w-0">
                <Textarea
                  id={fid(`tpl-${event}`)}
                  ref={(el) => {
                    refs.current[event] = el;
                  }}
                  rows={3}
                  value={body}
                  maxLength={LIMITS.templateMax}
                  disabled={disabled}
                  placeholder={t(`placeholders.${event}`, TOKEN_VALUES)}
                  onFocus={() => setActive(event)}
                  onChange={(e) => setBody(event, e.target.value)}
                />
                <div
                  className="mt-1 flex justify-end text-xs text-muted-foreground tabular-nums"
                  dir="ltr"
                >
                  {body.length} / {LIMITS.templateMax}
                </div>
                {err(`template:${event}`) && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {err(`template:${event}`)}
                  </p>
                )}
                <EventChannels
                  event={event}
                  draft={draft.templates[event]}
                  states={channelStates}
                  library={library}
                  disabled={disabled}
                  onChange={(change) => patchEvent(event, change)}
                />
              </div>
            </div>
          );
        })}
      </div>
      <Alert tone="info" className="mt-3 text-xs">
        {t('templatesNote')}
      </Alert>
    </SectionCard>
  );
}

const TEMPLATE_CHANNELS = ['whatsapp', 'email'] as const satisfies readonly TemplateChannel[];

type ChannelStates = ReturnType<typeof useAppointmentChannels>['data'];

/** The channels this booking type can use right now: on in the owner's settings AND connected (BL-350). */
function ChannelStrip() {
  const t = useTranslations('appointments.channels');
  const query = useAppointmentChannels();
  const states = query.data;
  const anyUsable = states === undefined || states.some((s) => s.usable);
  return (
    <SectionCard title={t('editorTitle')} hint={t('editorHint')}>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2">
            {CHANNEL_ORDER.map((channel) => (
              <ChannelChip key={channel} channel={channel} states={states} />
            ))}
          </ul>
          {!anyUsable && (
            <Alert tone="warning" className="mt-3 text-xs">
              {t('noneUsable')}{' '}
              <Link href="/appointments/settings#channels" className="font-medium underline">
                {t('openSettings')}
              </Link>
            </Alert>
          )}
        </>
      )}
    </SectionCard>
  );
}

function ChannelChip({
  channel,
  states,
}: {
  channel: (typeof CHANNEL_ORDER)[number];
  states: ChannelStates;
}) {
  const t = useTranslations('appointments.channels');
  const use = useOfChannel(states, channel);
  const href = CONNECT_HREF[channel];
  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2',
        use === 'usable' ? 'border-success/40 bg-success/5' : 'border-border bg-muted/30',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t(`names.${channel}`)}</span>
        <span className="text-xs text-muted-foreground">{t(`status.${use}`)}</span>
      </div>
      {use === 'not_connected' && href && (
        <p className="mt-1 text-xs">
          <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
            {t('connect')}
          </Link>
        </p>
      )}
      {use === 'off' && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('offByOwner')}{' '}
          <Link
            href="/appointments/settings#channels"
            className="font-medium text-primary hover:underline"
          >
            {t('openSettings')}
          </Link>
        </p>
      )}
      {use === 'coming_soon' && (
        <p className="mt-1 text-xs text-muted-foreground">{t('voiceSoon')}</p>
      )}
    </li>
  );
}

/** Which channels one lifecycle message goes out on, and which library message each uses (BL-350, BL-351). */
function EventChannels({
  event,
  draft,
  states,
  library,
  disabled,
  onChange,
}: {
  event: TemplateEvent;
  draft: TemplateDraft;
  states: ChannelStates;
  library: ReturnType<typeof useMessageLibrary>['data'];
  disabled: boolean;
  onChange: (change: Partial<TemplateDraft>) => void;
}) {
  const t = useTranslations('appointments.channels');
  const tl = useTranslations('appointments.templates');
  return (
    <fieldset className="mt-3 space-y-2">
      <legend className="text-xs font-medium">{t('sendOn')}</legend>
      <p className="text-xs text-muted-foreground">
        {draft.channels.length === 0 ? t('sendOnAuto') : t('sendOnEach')}
      </p>
      <ul className="space-y-2">
        {TEMPLATE_CHANNELS.map((channel) => (
          <EventChannelRow
            key={channel}
            event={event}
            channel={channel}
            draft={draft}
            states={states}
            library={library}
            disabled={disabled}
            onChange={onChange}
            t={t}
            tl={tl}
          />
        ))}
      </ul>
    </fieldset>
  );
}

function EventChannelRow({
  event,
  channel,
  draft,
  states,
  library,
  disabled,
  onChange,
  t,
  tl,
}: {
  event: TemplateEvent;
  channel: TemplateChannel;
  draft: TemplateDraft;
  states: ChannelStates;
  library: ReturnType<typeof useMessageLibrary>['data'];
  disabled: boolean;
  onChange: (change: Partial<TemplateDraft>) => void;
  t: ReturnType<typeof useTranslations>;
  tl: ReturnType<typeof useTranslations>;
}) {
  const use = useOfChannel(states, channel);
  const checked = draft.channels.includes(channel);
  const href = CONNECT_HREF[channel];
  const options = (library ?? []).filter((m) => m.channel === channel && m.kind === event);
  const value = channel === 'whatsapp' ? draft.waLibraryId : draft.emailLibraryId;
  return (
    <li className="rounded-md border border-border px-2.5 py-2">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || (use !== 'usable' && !checked)}
          onChange={(e) =>
            onChange({
              channels: e.target.checked
                ? [...draft.channels, channel]
                : draft.channels.filter((c) => c !== channel),
            })
          }
        />
        <span className="font-medium">{t(`names.${channel}`)}</span>
        {use !== 'usable' && (
          <span className="text-xs text-muted-foreground">{t(`status.${use}`)}</span>
        )}
      </label>
      {use === 'not_connected' && href && (
        <p className="mt-1 text-xs">
          <Link href={href} className="font-medium text-primary hover:underline">
            {t('connect')}
          </Link>
        </p>
      )}
      {checked && use !== 'usable' && (
        <p className="mt-1 text-xs text-warning">{t('attachedButUnusable')}</p>
      )}
      {checked && (
        <div className="mt-2 space-y-1">
          <label
            className="block text-xs text-muted-foreground"
            htmlFor={`tpl-${event}-${channel}`}
          >
            {tl('chooseLabel')}
          </label>
          <Select
            id={`tpl-${event}-${channel}`}
            value={value}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                channel === 'whatsapp'
                  ? { waLibraryId: e.target.value }
                  : { emailLibraryId: e.target.value },
              )
            }
          >
            <option value="">{tl('useText')}</option>
            {value !== '' && !options.some((m) => m.id === value) && (
              <option value={value}>{tl('unknownMessage')}</option>
            )}
            {options.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.usable && m.id !== value}>
                {m.usable ? m.name : `${m.name} (${tl(`status.${m.status}`)})`}
              </option>
            ))}
          </Select>
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {tl('noneYet')}{' '}
              <Link
                href="/appointments/settings#templates"
                className="font-medium text-primary hover:underline"
              >
                {tl('openLibrary')}
              </Link>
            </p>
          )}
          {channel === 'whatsapp' && (
            <p className="text-xs text-muted-foreground">{tl('whatsappApprovedOnly')}</p>
          )}
        </div>
      )}
    </li>
  );
}

function Reminders() {
  const t = useTranslations('appointments.reminders');
  const { draft, update, err, fid, disabled } = useEditor();
  const templates = useWaTemplates();
  const channelStates = useAppointmentChannels().data;
  const library = useMessageLibrary().data;
  return (
    <SectionCard title={t('title')} hint={t('hint', { max: REMINDER_MAX_RULES })}>
      <ReminderRulesEditor
        rules={draft.reminders}
        onChange={(next) => update((d) => ({ ...d, reminders: next }))}
        disabled={disabled}
        errorOf={err}
        typeName={draft.name}
        templates={templates.data ?? []}
        channelStates={channelStates}
        library={library}
        idPrefix={fid('reminders')}
      />
    </SectionCard>
  );
}

function Questionnaire() {
  const t = useTranslations('appointments.editor.questions');
  const { draft, set, update, err, fid, disabled } = useEditor();
  const list = draft.questions;
  const full = list.length >= LIMITS.questions;
  const setList = (fn: (l: QuestionDraft[]) => QuestionDraft[]) =>
    update((d) => ({ ...d, questions: fn(d.questions) }));
  const patch = (id: string, change: Partial<QuestionDraft>) =>
    setList((l) => l.map((q) => (q.id === id ? { ...q, ...change } : q)));
  const listError = err('questions');

  return (
    <SectionCard
      title={t('title')}
      hint={t('hint', { max: LIMITS.questions })}
      action={
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || full}
          onClick={() => setList((l) => [...l, newQuestion()])}
        >
          <PlusIcon /> {t('add')}
        </Button>
      }
    >
      <Field
        label={t('intro')}
        htmlFor={fid('introMessage')}
        hint={t('introHint')}
        className="mb-4"
      >
        <Textarea
          id={fid('introMessage')}
          rows={2}
          value={draft.introMessage}
          maxLength={LIMITS.introMax}
          disabled={disabled}
          onChange={(e) => set('introMessage', e.target.value)}
        />
      </Field>

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ol className="space-y-3">
          {list.map((q, i) => {
            const error = err(`question:${q.id}`);
            const n = i + 1;
            const mapChoices: string[] =
              q.map && !(MAP_FIELDS as readonly string[]).includes(q.map) ? [q.map] : [];
            return (
              <li key={q.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                  >
                    {n}
                  </span>
                  <Input
                    id={fid(`question-${q.id}`)}
                    value={q.label}
                    invalid={!!error}
                    disabled={disabled}
                    maxLength={LIMITS.questionLabelMax}
                    placeholder={t('labelPlaceholder')}
                    aria-label={t('labelOf', { n })}
                    onChange={(e) => patch(q.id, { label: e.target.value })}
                    className="min-w-[10rem] flex-1"
                  />
                  <Select
                    value={q.type}
                    disabled={disabled}
                    aria-label={t('typeOf', { n })}
                    onChange={(e) => patch(q.id, { type: e.target.value as QuestionType })}
                    className="w-36"
                  >
                    {QUESTION_TYPES.map((qt) => (
                      <option key={qt} value={qt}>
                        {t(`types.${qt}`)}
                      </option>
                    ))}
                  </Select>
                </div>

                {q.type === 'select' && (
                  <div className="mt-2">
                    <Textarea
                      rows={3}
                      value={q.optionsText}
                      disabled={disabled}
                      invalid={error === undefined ? false : q.optionsText.trim() === ''}
                      aria-label={t('optionsOf', { n })}
                      placeholder={t('optionsPlaceholder')}
                      onChange={(e) => patch(q.id, { optionsText: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('optionsHint', { max: LIMITS.optionMax })}
                    </p>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t('map')}</span>
                    <Select
                      value={q.map}
                      disabled={disabled}
                      aria-label={t('mapOf', { n })}
                      onChange={(e) => patch(q.id, { map: e.target.value })}
                      className="h-9 w-40"
                    >
                      <option value="">{t('mapNone')}</option>
                      {[...MAP_FIELDS, ...mapChoices].map((f) => (
                        <option key={f} value={f}>
                          {(MAP_FIELDS as readonly string[]).includes(f)
                            ? t(`mapFields.${f as (typeof MAP_FIELDS)[number]}`)
                            : f}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <Checkbox
                    id={fid(`required-${q.id}`)}
                    checked={q.required}
                    disabled={disabled}
                    onChange={(e) => patch(q.id, { required: e.target.checked })}
                    label={t('required')}
                    className="items-center text-xs"
                  />
                  <div className="ms-auto flex items-center gap-1">
                    <button
                      type="button"
                      disabled={disabled || i === 0}
                      onClick={() => setList((l) => moveItem(l, i, -1))}
                      aria-label={t('moveUp', { n })}
                      title={t('moveUp', { n })}
                      className={iconButtonClass}
                    >
                      <ChevronDownIcon className="rotate-180" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || i === list.length - 1}
                      onClick={() => setList((l) => moveItem(l, i, 1))}
                      aria-label={t('moveDown', { n })}
                      title={t('moveDown', { n })}
                      className={iconButtonClass}
                    >
                      <ChevronDownIcon />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setList((l) => l.filter((x) => x.id !== q.id))}
                      aria-label={t('remove', { n })}
                      title={t('remove', { n })}
                      className={cn(iconButtonClass, 'hover:text-danger')}
                    >
                      <MinusIcon />
                    </button>
                  </div>
                </div>
                {error && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('count', { count: list.length, max: LIMITS.questions })}</span>
        {listError && (
          <span role="alert" className="text-danger">
            {listError}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
