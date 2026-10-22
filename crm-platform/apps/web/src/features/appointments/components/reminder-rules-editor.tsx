'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { AppointmentChannelState, AppointmentTemplate } from '@crm/contracts';
import { Alert, Button, Input, Select, Switch, cn } from '@crm/ui';
import type { WaTemplateOption } from '../api/schemas';
import { usableChannels } from '../lib/channel-availability';
import {
  QUICK_FOLLOW_UPS,
  QUICK_REMINDERS,
  REMINDER_CHANNELS,
  REMINDER_MAX_RULES,
  REMINDER_UNITS,
  addReminder,
  minutesOf,
  newReminder,
  timedCount,
  type ReminderDraft,
  type ReminderKind,
  type ReminderUnit,
} from '../lib/reminder-rules';
import { chipClass, iconButtonClass } from './editor-shared';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './icons';
import { StepDetails } from './reminder-step-parts';

const QUICK_KEYS: Record<number, string> = { 1440: 'h24', 180: 'h3', 60: 'h1', 15: 'm15' };
const FOLLOW_KEYS: Record<number, string> = { 120: 'after2h', 1440: 'afterDay' };

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
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const full = timedCount(rules) >= REMINDER_MAX_RULES;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

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

  const used = new Set(
    rules.flatMap((r) => {
      const m = minutesOf(r);
      return m === null ? [] : [`${r.kind}:${m}`];
    }),
  );
  const listError = errorOf?.('reminders');
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
                    disabled={
                      disabled || (!r.enabled && !r.channels.some((c) => usableNow.includes(c)))
                    }
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
                  {r.kind === 'event' ? (
                    <span className="text-sm font-medium">
                      {t(`steps.${r.stepKind}`)}{' '}
                      <span className="font-normal text-muted-foreground">{t('kind.event')}</span>
                    </span>
                  ) : (
                    <>
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
                    </>
                  )}
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
                {r.notice === 'sms_removed' && (
                  <Alert tone="warning" className="mt-2 text-xs">
                    {t('notice.smsRemoved')}
                  </Alert>
                )}
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
                  <StepDetails
                    id={detailsId}
                    rule={r}
                    patch={(change) => patch(r.id, change)}
                    prefix={prefix}
                    disabled={disabled}
                    typeName={typeName}
                    templates={templates}
                    channelStates={channelStates}
                    library={library}
                    withOptions
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('count', { count: timedCount(rules), max: REMINDER_MAX_RULES })}</span>
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
