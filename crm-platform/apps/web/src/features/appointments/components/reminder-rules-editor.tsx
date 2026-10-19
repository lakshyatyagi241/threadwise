'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import type { AppointmentChannelState, AppointmentTemplate } from '@crm/contracts';
import { Alert, Button, Input, Select, Switch, Textarea, cn } from '@crm/ui';
import type { WaTemplateOption } from '../api/schemas';
import { CONNECT_HREF, useOfChannel, usableChannels } from '../lib/channel-availability';
import { insertAtRange } from '../lib/editor';
import {
  QUICK_FOLLOW_UPS,
  QUICK_REMINDERS,
  REMINDER_BODY_MAX,
  REMINDER_CHANNELS,
  REMINDER_LABEL_MAX,
  REMINDER_MAX_RULES,
  REMINDER_PLACEHOLDERS,
  REMINDER_SUBJECT_MAX,
  REMINDER_UNITS,
  STANDARD_TEXT,
  addReminder,
  minutesOf,
  moveChannel,
  newReminder,
  previewOf,
  toggleChannel,
  type PreviewSample,
  type ReminderChannel,
  type ReminderDraft,
  type ReminderKind,
  type ReminderUnit,
} from '../lib/reminder-rules';
import { chipClass, iconButtonClass } from './editor-shared';
import { BellIcon, ChevronDownIcon, MinusIcon, PlusIcon } from './icons';

const QUICK_KEYS: Record<number, string> = { 1440: 'h24', 180: 'h3', 60: 'h1', 15: 'm15' };
const FOLLOW_KEYS: Record<number, string> = { 120: 'after2h', 1440: 'afterDay' };

/** The placeholder tokens as literal text (a value is never read as message syntax). */
const token = (name: string): string => `{{${name}}}`;

export interface ReminderRulesEditorProps {
  rules: readonly ReminderDraft[];
  onChange: (next: ReminderDraft[]) => void;
  disabled?: boolean;
  /** The translated problem line of a key (`reminder:<id>` for a row, `reminders` for the list), or undefined. */
  errorOf?: (key: string) => string | undefined;
  /** The service's name, for the preview. */
  typeName: string;
  /** Approved WhatsApp templates to pick from. */
  templates?: readonly WaTemplateOption[];
  /**
   * What the workspace owner allows (BL-350). A channel that is off or not connected cannot be added to a rule, a new rule starts with the
   * usable ones, and a rule with no usable channel cannot be switched on. Left out = every channel is offered (the API still refuses one
   * that is off).
   */
  channelStates?: readonly AppointmentChannelState[];
  /** The appointment message library (BL-351): an email message can be copied into a rule. */
  library?: readonly AppointmentTemplate[];
  /** Makes element ids unique when several editors are on one page. */
  idPrefix?: string;
}

/**
 * The reminders and follow-ups of one booking type (BL-283): one row per rule with a switch, the moment (an amount of minutes, hours or
 * days before the appointment starts or after it ends), the channels in the order they are tried, the text with insertable
 * placeholders and a live preview. Used by the booking type editor and by the Appointment settings page. Controlled: it holds no data.
 * A rule is added OFF.
 */
export function ReminderRulesEditor({
  rules,
  onChange,
  disabled = false,
  errorOf,
  typeName,
  templates = [],
  channelStates,
  library = [],
  idPrefix,
}: ReminderRulesEditorProps) {
  const t = useTranslations('appointments.reminders');
  const locale = useLocale();
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const full = rules.length >= REMINDER_MAX_RULES;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const patch = (id: string, change: Partial<ReminderDraft>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const remove = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const toggleOpen = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const usableNow = usableChannels(channelStates, REMINDER_CHANNELS);
  const add = (
    fn: () => ReminderDraft[],
    opened?: (next: ReminderDraft[]) => string | undefined,
  ) => {
    const before = new Set(rules.map((r) => r.id));
    // A rule that is new starts with the channels the owner allows, so switching it on is never refused for a channel nobody chose.
    const next = fn().map((r) =>
      before.has(r.id) || usableNow.length === 0 || channelStates === undefined
        ? r
        : { ...r, channels: r.channels.filter((c) => usableNow.includes(c)) },
    );
    onChange(next);
    const id = opened?.(next);
    if (id) setOpen((cur) => new Set(cur).add(id));
  };

  const sample = (): PreviewSample => {
    const when = new Date(Date.UTC(2030, 0, 15, 10, 0, 0));
    const date = new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(when);
    const time = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(when);
    return {
      name: t('sample.name'),
      type: typeName.trim() || t('sample.type'),
      slot: `${date} · ${time}`,
      date,
      time,
      location: t('sample.location'),
      join_link: 'https://meet.example.com/abc-defg',
      manage_link: 'https://example.com/manage/xyz',
    };
  };

  function insert(rule: ReminderDraft, name: string) {
    const el = refs.current[rule.id];
    const start = el?.selectionStart ?? rule.body.length;
    const end = el?.selectionEnd ?? rule.body.length;
    const result = insertAtRange(rule.body, token(name), start, end, REMINDER_BODY_MAX);
    if (!result) return;
    patch(rule.id, { body: result.text });
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.caret, result.caret);
    });
  }

  const used = new Set(
    rules.flatMap((r) => {
      const m = minutesOf(r);
      return m === null ? [] : [`${r.kind}:${m}`];
    }),
  );
  const listError = errorOf?.('reminders');
  /** The usable email messages of the library that fit a rule: a reminder for "before", the follow-up for "after". */
  const emailChoices = (r: ReminderDraft) =>
    library.filter(
      (m) =>
        m.channel === 'email' &&
        m.usable &&
        m.kind === (r.kind === 'before' ? 'reminder' : 'follow_up'),
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('quickAdd')}>
        <span className="text-xs text-muted-foreground">{t('quickAdd')}</span>
        {QUICK_REMINDERS.map((m) => (
          <button
            key={`b${m}`}
            type="button"
            disabled={disabled || used.has(`before:${m}`) || full}
            onClick={() =>
              add(
                () => addReminder(rules, m, '', 'before'),
                (next) => next.find((r) => r.kind === 'before' && minutesOf(r) === m)?.id,
              )
            }
            className={chipClass}
          >
            <PlusIcon className="size-3" /> {t(`quick.${QUICK_KEYS[m]}`)}
          </button>
        ))}
        {QUICK_FOLLOW_UPS.map((m) => (
          <button
            key={`a${m}`}
            type="button"
            disabled={disabled || used.has(`after:${m}`) || full}
            onClick={() =>
              add(
                () => addReminder(rules, m, '', 'after'),
                (next) => next.find((r) => r.kind === 'after' && minutesOf(r) === m)?.id,
              )
            }
            className={chipClass}
          >
            <PlusIcon className="size-3" /> {t(`quick.${FOLLOW_KEYS[m]}`)}
          </button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || full}
          onClick={() => {
            const row = newReminder();
            add(
              () => [...rules, row],
              () => row.id,
            );
          }}
        >
          <PlusIcon /> {t('add')}
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rules.map((r, i) => {
            const n = i + 1;
            const error = errorOf?.(`reminder:${r.id}`);
            const expanded = open.has(r.id);
            const detailsId = `${prefix}-details-${r.id}`;
            const text = previewOf(r, sample());
            const usesEmail = r.channels.includes('email');
            const usesWhatsapp = r.channels.includes('whatsapp');
            return (
              <li
                key={r.id}
                className={cn(
                  'rounded-lg border p-3',
                  r.enabled ? 'border-primary/40 bg-primary/5' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    id={`${prefix}-on-${r.id}`}
                    checked={r.enabled}
                    disabled={disabled || (!r.enabled && !r.channels.some((c) => usableNow.includes(c)))}
                    label={t('enabledOf', { n })}
                    onCheckedChange={(on) =>
                      patch(
                        r.id,
                        on && channelStates !== undefined
                          ? {
                              enabled: true,
                              channels: r.channels.filter((c) => usableNow.includes(c)),
                            }
                          : { enabled: on },
                      )
                    }
                  />
                  <span
                    className={cn(
                      'min-w-8 text-xs font-medium',
                      r.enabled ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {r.enabled ? t('on') : t('off')}
                  </span>
                  <Input
                    id={`${prefix}-offset-${r.id}`}
                    value={r.offset}
                    invalid={!!error}
                    disabled={disabled}
                    inputMode="numeric"
                    dir="ltr"
                    placeholder="1"
                    aria-label={t('offsetOf', { n })}
                    onChange={(e) => patch(r.id, { offset: e.target.value })}
                    className="w-20 tabular-nums"
                  />
                  <Select
                    value={r.unit}
                    disabled={disabled}
                    aria-label={t('unitOf', { n })}
                    onChange={(e) => patch(r.id, { unit: e.target.value as ReminderUnit })}
                    className="w-28"
                  >
                    {REMINDER_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {t(`units.${u}`)}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={r.kind}
                    disabled={disabled}
                    aria-label={t('kindOf', { n })}
                    onChange={(e) => patch(r.id, { kind: e.target.value as ReminderKind })}
                    className="w-56 max-w-full"
                  >
                    <option value="before">{t('kind.before')}</option>
                    <option value="after">{t('kind.after')}</option>
                  </Select>
                  <div className="ms-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={() => toggleOpen(r.id)}
                      className={cn(chipClass, 'h-8')}
                    >
                      <ChevronDownIcon className={cn('size-3', expanded && 'rotate-180')} />
                      {expanded ? t('hideMessage') : t('editMessage')}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => remove(r.id)}
                      aria-label={t('remove', { n })}
                      title={t('remove', { n })}
                      className={cn(iconButtonClass, 'hover:text-danger')}
                    >
                      <MinusIcon />
                    </button>
                  </div>
                </div>
                {error && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {error}
                  </p>
                )}
                {!r.enabled &&
                  channelStates !== undefined &&
                  !r.channels.some((c) => usableNow.includes(c)) && (
                    <p className="mt-1 text-xs text-warning">
                      {t('noUsableChannel')}{' '}
                      <Link
                        href="/appointments/settings#channels"
                        className="font-medium underline"
                      >
                        {t('openChannels')}
                      </Link>
                    </p>
                  )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {r.channels.map((c) => t(`channels.${c}`)).join(' › ')}
                  {r.waTemplateId && usesWhatsapp ? ` · ${t('withTemplate')}` : ''}
                </p>

                {expanded && (
                  <div id={detailsId} className="mt-3 space-y-4 border-t border-border pt-3">
                    <fieldset className="space-y-1.5">
                      <legend className="text-xs font-medium">{t('channelsTitle')}</legend>
                      <p className="text-xs text-muted-foreground">{t('channelsHint')}</p>
                      <ul className="space-y-1">
                        {r.channels.map((c, ci) => (
                          <li
                            key={c}
                            className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
                          >
                            <span
                              aria-hidden="true"
                              className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums"
                            >
                              {ci + 1}
                            </span>
                            <span className="flex-1 text-sm">
                              {t(`channels.${c}`)}
                              {channelStates !== undefined && !usableNow.includes(c) && (
                                <span className="ms-2 text-xs text-warning">{t('channelUnusable')}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              disabled={disabled || ci === 0}
                              onClick={() =>
                                patch(r.id, { channels: moveChannel(r.channels, ci, -1) })
                              }
                              aria-label={t('moveUp', { channel: t(`channels.${c}`) })}
                              title={t('moveUp', { channel: t(`channels.${c}`) })}
                              className={iconButtonClass}
                            >
                              <ChevronDownIcon className="rotate-180" />
                            </button>
                            <button
                              type="button"
                              disabled={disabled || ci === r.channels.length - 1}
                              onClick={() =>
                                patch(r.id, { channels: moveChannel(r.channels, ci, 1) })
                              }
                              aria-label={t('moveDown', { channel: t(`channels.${c}`) })}
                              title={t('moveDown', { channel: t(`channels.${c}`) })}
                              className={iconButtonClass}
                            >
                              <ChevronDownIcon />
                            </button>
                            <button
                              type="button"
                              disabled={disabled || r.channels.length <= 1}
                              onClick={() =>
                                patch(r.id, { channels: toggleChannel(r.channels, c) })
                              }
                              aria-label={t('removeChannel', { channel: t(`channels.${c}`) })}
                              title={t('removeChannel', { channel: t(`channels.${c}`) })}
                              className={cn(iconButtonClass, 'hover:text-danger')}
                            >
                              <MinusIcon />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap gap-2">
                        {REMINDER_CHANNELS.filter((c) => !r.channels.includes(c)).map(
                          (c: ReminderChannel) => (
                            <AddChannelChip
                              key={c}
                              channel={c}
                              states={channelStates}
                              disabled={disabled}
                              onAdd={() => patch(r.id, { channels: toggleChannel(r.channels, c) })}
                            />
                          ),
                        )}
                        <span
                          className={cn(chipClass, 'cursor-not-allowed opacity-60')}
                          aria-disabled="true"
                          title={t('voiceSoon')}
                        >
                          {t('channels.voice')} · {t('voiceSoonShort')}
                        </span>
                      </div>
                    </fieldset>

                    <div className="space-y-1.5">
                      <label htmlFor={`${prefix}-body-${r.id}`} className="text-xs font-medium">
                        {t('messageTitle')}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {REMINDER_PLACEHOLDERS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            disabled={disabled}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insert(r, p)}
                            title={t(`placeholderMeaning.${p}`)}
                            className={cn(chipClass, 'h-7 font-mono')}
                          >
                            {token(p)}
                          </button>
                        ))}
                      </div>
                      <Textarea
                        id={`${prefix}-body-${r.id}`}
                        ref={(el) => {
                          refs.current[r.id] = el;
                        }}
                        rows={4}
                        value={r.body}
                        maxLength={REMINDER_BODY_MAX}
                        disabled={disabled}
                        placeholder={STANDARD_TEXT[r.kind]}
                        onChange={(e) => patch(r.id, { body: e.target.value })}
                      />
                      <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {r.kind === 'before' ? t('bodyHintBefore') : t('bodyHintAfter')}
                        </span>
                        <span className="tabular-nums" dir="ltr">
                          {r.body.length} / {REMINDER_BODY_MAX}
                        </span>
                      </div>
                    </div>

                    {usesEmail && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`${prefix}-subject-${r.id}`}
                          className="text-xs font-medium"
                        >
                          {t('subjectTitle')}
                        </label>
                        <Input
                          id={`${prefix}-subject-${r.id}`}
                          value={r.subject}
                          maxLength={REMINDER_SUBJECT_MAX}
                          disabled={disabled}
                          placeholder={t('subjectPlaceholder')}
                          onChange={(e) => patch(r.id, { subject: e.target.value })}
                        />
                        {emailChoices(r).length > 0 && (
                          <Select
                            value=""
                            disabled={disabled}
                            aria-label={t('fromLibrary')}
                            onChange={(e) => {
                              const m = library.find((x) => x.id === e.target.value);
                              if (m) patch(r.id, { subject: m.subject ?? '', body: m.body });
                            }}
                          >
                            <option value="">{t('fromLibrary')}</option>
                            {emailChoices(r).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    )}

                    {usesWhatsapp && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor={`${prefix}-template-${r.id}`}
                          className="text-xs font-medium"
                        >
                          {t('templateTitle')}
                        </label>
                        <Select
                          id={`${prefix}-template-${r.id}`}
                          value={r.waTemplateId}
                          disabled={disabled}
                          onChange={(e) => patch(r.id, { waTemplateId: e.target.value })}
                        >
                          <option value="">{t('templateNone')}</option>
                          {r.waTemplateId !== '' &&
                            !templates.some((x) => x.id === r.waTemplateId) && (
                              <option value={r.waTemplateId}>{t('templateUnknown')}</option>
                            )}
                          {templates.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} ({x.language})
                            </option>
                          ))}
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {t('templateHint')}{' '}
                          <Link
                            href="/appointments/settings#templates"
                            className="font-medium text-primary hover:underline"
                          >
                            {t('openLibrary')}
                          </Link>
                        </p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label htmlFor={`${prefix}-label-${r.id}`} className="text-xs font-medium">
                        {t('labelTitle')}
                      </label>
                      <Input
                        id={`${prefix}-label-${r.id}`}
                        value={r.label}
                        maxLength={REMINDER_LABEL_MAX}
                        disabled={disabled}
                        placeholder={t('labelPlaceholder')}
                        onChange={(e) => patch(r.id, { label: e.target.value })}
                        className="max-w-xs"
                      />
                    </div>

                    <div className="rounded-md bg-muted/50 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <BellIcon className="size-3.5" /> {t('previewTitle')}
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{text}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">{t('previewNote')}</p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('count', { count: rules.length, max: REMINDER_MAX_RULES })}</span>
        {listError && (
          <span role="alert" className="text-danger">
            {listError}
          </span>
        )}
      </div>
      <Alert tone="info" className="text-xs">
        {t('note')}
      </Alert>
    </div>
  );
}

function AddChannelChip({
  channel,
  states,
  disabled,
  onAdd,
}: {
  channel: ReminderChannel;
  states: readonly AppointmentChannelState[] | undefined;
  disabled: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations('appointments.reminders');
  const tc = useTranslations('appointments.channels');
  const use = useOfChannel(states, channel);
  const href = CONNECT_HREF[channel];
  if (use === 'usable') {
    return (
      <button type="button" disabled={disabled} onClick={onAdd} className={chipClass}>
        <PlusIcon className="size-3" /> {t(`channels.${channel}`)}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(chipClass, 'cursor-not-allowed opacity-60')}
        aria-disabled="true"
        title={tc(`status.${use}`)}
      >
        {t(`channels.${channel}`)} · {tc(`status.${use}`)}
      </span>
      {use === 'not_connected' && href && (
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          {tc('connect')}
        </Link>
      )}
    </span>
  );
}
