'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { BOOKING_TIMED_STEPS_MAX } from '@crm/contracts';
import { Alert, Input, Menu, MenuItem, MenuLabel, Select, Switch, cn } from '@crm/ui';
import { usableChannels } from '../lib/channel-availability';
import {
  REMINDER_CHANNELS,
  REMINDER_UNITS,
  type ReminderDraft,
  type ReminderUnit,
  stepKindOf,
} from '../lib/reminder-rules';
import {
  STEP_CHOICES,
  TIMELINE_LANES,
  addStep,
  buildStep,
  choiceState,
  fallbackNote,
  groupTimeline,
  offsetParts,
  timedSteps,
  whatsappState,
  WA_TONE,
  type StepChoice,
  type TimelineLane,
} from '../lib/reminder-timeline';
import { chipClass, iconButtonClass } from './editor-shared';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './icons';
import { ToneChip } from './parts';
import type { ReminderRulesEditorProps } from './reminder-rules-editor';
import { StepDetails, StepOptions, UpgradeHint, useSequencePlan } from './reminder-step-parts';

export interface ReminderTimelineProps extends ReminderRulesEditorProps {
  /**
   * What a card shows beside its own controls (the email test of a saved step). Receives the draft; nothing is drawn when it returns
   * null. Kept out of this file so the timeline stays a controlled editor of drafts.
   */
  renderExtra?: (rule: ReminderDraft) => ReactNode;
  /** Shown above the lanes next to the "Add step" menu (the ready-made sequences button). */
  toolbar?: ReactNode;
}

/**
 * The steps of a booking type's reminder sequence as a timeline (BL-422): when it is booked, before the appointment and after it. Each
 * step is a card with its switch, its time, the channels in the order they are tried with the state of the WhatsApp template, the
 * buttons and skip rules, the wait before the next channel, and the message behind "Edit message". Controlled, like the list editor:
 * it holds no data, and it adds, edits and removes the very same drafts, so saving is unchanged.
 */
export function ReminderTimeline({
  rules,
  onChange,
  disabled = false,
  errorOf,
  typeName,
  templates = [],
  channelStates,
  library = [],
  idPrefix,
  renderExtra,
  toolbar,
}: ReminderTimelineProps) {
  const t = useTranslations('appointments.reminders');
  const auto = useId();
  const prefix = idPrefix ?? auto;
  const plan = useSequencePlan();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const usableNow = usableChannels(channelStates, REMINDER_CHANNELS);
  const groups = groupTimeline(rules);
  const timed = timedSteps(rules);
  const capReached = timed >= BOOKING_TIMED_STEPS_MAX;
  const listError = errorOf?.('reminders');

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

  function add(choice: StepChoice) {
    // A step that is new starts with the channels the owner allows, so switching it on is never refused for a channel nobody chose.
    const step = buildStep(choice);
    const channels =
      channelStates !== undefined && usableNow.length > 0
        ? step.channels.filter((c) => usableNow.includes(c))
        : step.channels;
    const next = addStep(rules, choice, { ...step, channels });
    if (next.length === rules.length) return;
    onChange(next);
    setOpen((cur) => new Set(cur).add(step.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <Menu
          label={t('timeline.addMenu')}
          disabled={disabled}
          trigger={
            <>
              <PlusIcon className="size-3.5" /> {t('timeline.addStep')}
            </>
          }
        >
          <MenuLabel>{t('timeline.addMenu')}</MenuLabel>
          {STEP_CHOICES.map((choice) => {
            const state = choiceState(rules, choice);
            const locked = choice === 'rebook' && !plan.rebook;
            return (
              <MenuItem
                key={choice}
                disabled={state !== 'available'}
                hint={
                  state === 'present'
                    ? t('timeline.choiceHint.present')
                    : state === 'cap'
                      ? t('timeline.choiceHint.cap')
                      : locked
                        ? t('timeline.choiceHint.locked')
                        : choice === 'reminder_15m'
                          ? t('timeline.choiceHint.online')
                          : undefined
                }
                onSelect={() => add(choice)}
              >
                {t(`timeline.choice.${choice}`)}
              </MenuItem>
            );
          })}
        </Menu>
        <span className="text-xs text-muted-foreground">
          {t('timeline.count', { count: timed, max: BOOKING_TIMED_STEPS_MAX })}
        </span>
      </div>
      {capReached && (
        <p className="text-xs text-warning">
          {t('timeline.capReached', { max: BOOKING_TIMED_STEPS_MAX })}
        </p>
      )}
      {!plan.rebook && <UpgradeHint>{t('timeline.rebookLocked')}</UpgradeHint>}

      {rules.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('timeline.empty')}
        </p>
      )}

      <ol className="space-y-5" aria-label={t('timeline.label')}>
        {TIMELINE_LANES.map((lane) => (
          <Lane key={lane} lane={lane}>
            {groups[lane].map((r) => (
              <StepCard
                key={r.id}
                rule={r}
                prefix={prefix}
                disabled={disabled}
                error={errorOf?.(`reminder:${r.id}`)}
                expanded={open.has(r.id)}
                onToggle={() => toggleOpen(r.id)}
                onRemove={() => remove(r.id)}
                patch={(change) => patch(r.id, change)}
                usableNow={usableNow}
                channelStates={channelStates}
                typeName={typeName}
                templates={templates}
                library={library}
                rebookAllowed={plan.rebook}
                extra={renderExtra?.(r)}
              />
            ))}
          </Lane>
        ))}
      </ol>

      {listError && (
        <p role="alert" className="text-xs text-danger">
          {listError}
        </p>
      )}
      <Alert tone="info" className="text-xs">
        {t('note')}
      </Alert>
    </div>
  );
}

function Lane({ lane, children }: { lane: TimelineLane; children: ReactNode }) {
  const t = useTranslations('appointments.reminders');
  const items = Array.isArray(children) ? children : [children];
  const empty = items.length === 0;
  return (
    <li aria-label={t(`timeline.lane.${lane}`)}>
      <div className="mb-2">
        <h4 className="text-sm font-semibold">{t(`timeline.lane.${lane}`)}</h4>
        <p className="text-xs text-muted-foreground">{t(`timeline.laneHint.${lane}`)}</p>
      </div>
      <ul className="ms-2 space-y-3 border-s-2 border-border ps-4">
        {empty ? (
          <li className="text-xs text-muted-foreground">{t('timeline.laneEmpty')}</li>
        ) : (
          children
        )}
      </ul>
    </li>
  );
}

function StepCard({
  rule: r,
  prefix,
  disabled,
  error,
  expanded,
  onToggle,
  onRemove,
  patch,
  usableNow,
  channelStates,
  typeName,
  templates,
  library,
  rebookAllowed,
  extra,
}: {
  rule: ReminderDraft;
  prefix: string;
  disabled: boolean;
  error: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  patch: (change: Partial<ReminderDraft>) => void;
  usableNow: readonly string[];
  channelStates: ReminderTimelineProps['channelStates'];
  typeName: string;
  templates: NonNullable<ReminderTimelineProps['templates']>;
  library: NonNullable<ReminderTimelineProps['library']>;
  rebookAllowed: boolean;
  extra: ReactNode;
}) {
  const t = useTranslations('appointments.reminders');
  const step = stepKindOf(r);
  const name = t(`timeline.step.${step}`);
  const detailsId = `${prefix}-details-${r.id}`;
  const wa = whatsappState(r);
  const note = fallbackNote(r);
  const noUsable = channelStates !== undefined && !r.channels.some((c) => usableNow.includes(c));
  const rebookLocked = step === 'rebook' && !rebookAllowed && !r.enabled;
  const parts = offsetParts(r);

  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className={cn(
          'absolute -start-[1.4rem] top-4 size-3 rounded-full border-2 border-background',
          r.enabled ? 'bg-primary' : 'bg-muted-foreground/40',
        )}
      />
      <div
        data-step={step}
        className={cn(
          'rounded-lg border p-3',
          r.enabled ? 'border-primary/40 bg-primary/5' : 'border-border',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            id={`${prefix}-on-${r.id}`}
            checked={r.enabled}
            disabled={disabled || (!r.enabled && (noUsable || rebookLocked))}
            label={t('timeline.enabledOf', { step: name })}
            onCheckedChange={(on) =>
              patch(
                on && channelStates !== undefined
                  ? { enabled: true, channels: r.channels.filter((c) => usableNow.includes(c)) }
                  : { enabled: on },
              )
            }
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{t(`timeline.stepHint.${step}`)}</p>
          </div>
          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={onToggle}
              className={cn(chipClass, 'h-8')}
            >
              <ChevronDownIcon className={cn('size-3', expanded && 'rotate-180')} />
              {expanded ? t('hideMessage') : t('editMessage')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              aria-label={t('timeline.remove', { step: name })}
              title={t('timeline.remove', { step: name })}
              className={cn(iconButtonClass, 'hover:text-danger')}
            >
              <MinusIcon />
            </button>
          </div>
        </div>

        {r.kind !== 'event' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              id={`${prefix}-offset-${r.id}`}
              value={r.offset}
              invalid={!!error}
              disabled={disabled}
              inputMode="numeric"
              dir="ltr"
              placeholder="1"
              aria-label={t('timeline.offsetOf', { step: name })}
              onChange={(e) => patch({ offset: e.target.value })}
              className="w-20 tabular-nums"
            />
            <Select
              value={r.unit}
              disabled={disabled}
              aria-label={t('timeline.unitOf', { step: name })}
              onChange={(e) => patch({ unit: e.target.value as ReminderUnit })}
              className="w-28"
            >
              {REMINDER_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`)}
                </option>
              ))}
            </Select>
            <span className="text-sm text-muted-foreground">
              {r.kind === 'before' ? t('timeline.beforeStart') : t('timeline.afterEnd')}
            </span>
            {parts === null && (
              <span className="text-xs text-muted-foreground">{t('timeline.setTime')}</span>
            )}
          </div>
        )}

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
        {noUsable && !r.enabled && (
          <p className="mt-1 text-xs text-warning">
            {t('noUsableChannel')}{' '}
            <Link href="/appointments/settings#channels" className="font-medium underline">
              {t('openChannels')}
            </Link>
          </p>
        )}
        {rebookLocked && <UpgradeHint>{t('timeline.rebookLockedStep')}</UpgradeHint>}

        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={t('channelsTitle')}>
          {r.channels.map((c, i) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              )}
              <span className={cn(chipClass, 'h-7 cursor-default')}>
                <span
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums"
                >
                  {i + 1}
                </span>
                {t(`channels.${c}`)}
              </span>
              {c === 'whatsapp' && (
                <ToneChip
                  tone={WA_TONE[wa]}
                  label={t(`timeline.wa.${wa === 'na' ? 'none' : wa}`)}
                />
              )}
            </span>
          ))}
        </div>
        {r.waTemplateName && r.channels.includes('whatsapp') && (
          <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
            {t('timeline.templateName', { name: r.waTemplateName })}
          </p>
        )}
        {note !== 'ok' && (
          <p className="mt-1 text-xs text-muted-foreground">{t(`timeline.fallback.${note}`)}</p>
        )}

        <div className="mt-3">
          <StepOptions rule={r} prefix={prefix} disabled={disabled} patch={patch} />
        </div>
        {extra}

        {expanded && (
          <StepDetails
            id={detailsId}
            rule={r}
            patch={patch}
            prefix={prefix}
            disabled={disabled}
            typeName={typeName}
            templates={templates}
            channelStates={channelStates}
            library={library}
            withOptions={false}
          />
        )}
      </div>
    </li>
  );
}
