'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef } from 'react';
import { PLAN_UPGRADE_PATH, type AppointmentChannelState, type AppointmentTemplate } from '@crm/contracts';
import { Input, Select, Switch, Textarea, cn } from '@crm/ui';
import { usePlanFeature } from '@/lib/plan-features';
import type { WaTemplateOption } from '../api/schemas';
import { CONNECT_HREF, channelUse, usableChannels } from '../lib/channel-availability';
import { insertAtRange } from '../lib/editor';
import {
  REMINDER_BODY_MAX,
  REMINDER_CHANNELS,
  REMINDER_LABEL_MAX,
  REMINDER_PLACEHOLDERS,
  REMINDER_SUBJECT_MAX,
  STANDARD_TEXT,
  UNDELIVERED_MAX,
  UNDELIVERED_MIN,
  moveChannel,
  previewOf,
  toggleChannel,
  type PreviewSample,
  type ReminderChannel,
  type ReminderDraft,
} from '../lib/reminder-rules';
import { hasFallbackWait, hasReplyOptions } from '../lib/reminder-timeline';
import { chipClass, iconButtonClass } from './editor-shared';
import { BellIcon, ChevronDownIcon, MinusIcon, PlusIcon } from './icons';

/** The placeholder tokens as literal text (a value is never read as message syntax). */
const token = (name: string): string => `{{${name}}}`;

/** The plan features that gate parts of a sequence; unknown (no provider) is "on", like the rest of the app. */
export function useSequencePlan(): { buttons: boolean; rebook: boolean } {
  return {
    buttons: usePlanFeature('appointment_confirm_buttons'),
    rebook: usePlanFeature('appointment_rebook_steps'),
  };
}

/** A line that tells the owner a plan feature is missing, with the way to the plans. Never a hidden control. */
export function UpgradeHint({ children }: { children: React.ReactNode }) {
  const t = useTranslations('appointments.reminders');
  return (
    <p className="text-xs text-warning">
      {children}{' '}
      <Link href={PLAN_UPGRADE_PATH} className="font-medium underline">
        {t('upgrade')}
      </Link>
    </p>
  );
}

/**
 * The switches of a step that change how the contact is reached: the Confirm / Reschedule / Cancel buttons (a reminder before the visit,
 * plan feature `appointment_confirm_buttons`), "skip if already confirmed" and the wait before the next channel is tried. A control the
 * plan lacks is shown disabled with an upgrade line, and one that is already on can always be switched off.
 */
export function StepOptions({
  rule: r,
  prefix,
  disabled,
  patch,
}: {
  rule: ReminderDraft;
  prefix: string;
  disabled: boolean;
  patch: (change: Partial<ReminderDraft>) => void;
}) {
  const t = useTranslations('appointments.reminders');
  const plan = useSequencePlan();
  const reply = hasReplyOptions(r);
  const wait = hasFallbackWait(r);
  if (!reply && !wait) return null;
  const buttonsLocked = reply && !plan.buttons && !r.buttonsEnabled;
  return (
    <div className="space-y-2">
      {reply && (
        <>
          <Switch
            id={`${prefix}-buttons-${r.id}`}
            checked={r.buttonsEnabled}
            disabled={disabled || buttonsLocked || !r.channels.includes('whatsapp')}
            label={t('buttonsTitle')}
            onCheckedChange={(on) => patch({ buttonsEnabled: on })}
          />
          {buttonsLocked && <UpgradeHint>{t('buttonsLocked')}</UpgradeHint>}
          <Switch
            id={`${prefix}-skip-${r.id}`}
            checked={r.skipIfConfirmed}
            disabled={disabled}
            label={t('skipIfConfirmed')}
            onCheckedChange={(on) => patch({ skipIfConfirmed: on })}
          />
        </>
      )}
      {wait && (
        <div className="space-y-1">
          <label htmlFor={`${prefix}-fallback-${r.id}`} className="text-xs font-medium">
            {t('fallbackTitle')}
          </label>
          <Input
            id={`${prefix}-fallback-${r.id}`}
            value={r.undeliveredFallbackMinutes}
            disabled={disabled}
            inputMode="numeric"
            dir="ltr"
            placeholder="30"
            onChange={(e) => patch({ undeliveredFallbackMinutes: e.target.value })}
            className="w-24 tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            {t('fallbackHint', { min: UNDELIVERED_MIN, maxMinutes: UNDELIVERED_MAX })}
          </p>
        </div>
      )}
    </div>
  );
}

/** Sample values for the preview of a message: the same ones the server fills in, with made-up details. */
export function usePreviewSample(typeName: string): () => PreviewSample {
  const t = useTranslations('appointments.reminders');
  const locale = useLocale();
  return () => {
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
}

/**
 * The part of a step that is opened with "Message and channels": the order the channels are tried in, the text, the email subject, the
 * WhatsApp template, the label and a live preview. Shared by the list editor and the timeline cards. `withOptions` also draws the
 * switches of `StepOptions` (the list editor keeps them here; a timeline card shows them on the card itself).
 */
export function StepDetails({
  rule: r,
  patch,
  prefix,
  disabled,
  typeName,
  templates,
  channelStates,
  library,
  withOptions,
  id,
}: {
  rule: ReminderDraft;
  patch: (change: Partial<ReminderDraft>) => void;
  prefix: string;
  disabled: boolean;
  typeName: string;
  templates: readonly WaTemplateOption[];
  channelStates: readonly AppointmentChannelState[] | undefined;
  library: readonly AppointmentTemplate[];
  withOptions: boolean;
  id: string;
}) {
  const t = useTranslations('appointments.reminders');
  const sample = usePreviewSample(typeName);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const usableNow = usableChannels(channelStates, REMINDER_CHANNELS);
  const usesEmail = r.channels.includes('email');
  const usesWhatsapp = r.channels.includes('whatsapp');
  const text = previewOf(r, sample());

  function insert(name: string) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? r.body.length;
    const end = el?.selectionEnd ?? r.body.length;
    const result = insertAtRange(r.body, token(name), start, end, REMINDER_BODY_MAX);
    if (!result) return;
    patch({ body: result.text });
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.caret, result.caret);
    });
  }

  /** The usable email messages of the library that fit a step: a reminder for "before", the follow-up for "after". */
  const emailChoices = library.filter(
    (m) =>
      m.channel === 'email' &&
      m.usable &&
      m.kind ===
        (r.kind === 'before'
          ? 'reminder'
          : r.kind === 'event'
            ? r.stepKind === 'no_show'
              ? 'no_show'
              : 'confirmation'
            : r.stepKind === 'rebook'
              ? 'rebook'
              : 'follow_up'),
  );

  return (
    <div id={id} className="mt-3 space-y-4 border-t border-border pt-3">
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
                onClick={() => patch({ channels: moveChannel(r.channels, ci, -1) })}
                aria-label={t('moveUp', { channel: t(`channels.${c}`) })}
                title={t('moveUp', { channel: t(`channels.${c}`) })}
                className={iconButtonClass}
              >
                <ChevronDownIcon className="rotate-180" />
              </button>
              <button
                type="button"
                disabled={disabled || ci === r.channels.length - 1}
                onClick={() => patch({ channels: moveChannel(r.channels, ci, 1) })}
                aria-label={t('moveDown', { channel: t(`channels.${c}`) })}
                title={t('moveDown', { channel: t(`channels.${c}`) })}
                className={iconButtonClass}
              >
                <ChevronDownIcon />
              </button>
              <button
                type="button"
                disabled={disabled || r.channels.length <= 1}
                onClick={() => patch({ channels: toggleChannel(r.channels, c) })}
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
          {REMINDER_CHANNELS.filter((c) => !r.channels.includes(c)).map((c: ReminderChannel) => (
            <AddChannelChip
              key={c}
              channel={c}
              states={channelStates}
              disabled={disabled}
              onAdd={() => patch({ channels: toggleChannel(r.channels, c) })}
            />
          ))}
          <span
            className={cn(chipClass, 'cursor-not-allowed opacity-60')}
            aria-disabled="true"
            title={t('voiceSoon')}
          >
            {t('channels.voice')} · {t('voiceSoonShort')}
          </span>
        </div>
      </fieldset>

      {withOptions && <StepOptions rule={r} prefix={prefix} disabled={disabled} patch={patch} />}

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
              onClick={() => insert(p)}
              title={t(`placeholderMeaning.${p}`)}
              className={cn(chipClass, 'h-7 font-mono')}
            >
              {token(p)}
            </button>
          ))}
        </div>
        <Textarea
          id={`${prefix}-body-${r.id}`}
          ref={bodyRef}
          rows={4}
          value={r.body}
          maxLength={REMINDER_BODY_MAX}
          disabled={disabled}
          placeholder={STANDARD_TEXT[r.kind]}
          onChange={(e) => patch({ body: e.target.value })}
        />
        <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
          <span>{r.kind === 'before' ? t('bodyHintBefore') : t('bodyHintAfter')}</span>
          <span className="tabular-nums" dir="ltr">
            {r.body.length} / {REMINDER_BODY_MAX}
          </span>
        </div>
      </div>

      {usesEmail && (
        <div className="space-y-1.5">
          <label htmlFor={`${prefix}-subject-${r.id}`} className="text-xs font-medium">
            {t('subjectTitle')}
          </label>
          <Input
            id={`${prefix}-subject-${r.id}`}
            value={r.subject}
            maxLength={REMINDER_SUBJECT_MAX}
            disabled={disabled}
            placeholder={t('subjectPlaceholder')}
            onChange={(e) => patch({ subject: e.target.value })}
          />
          {emailChoices.length > 0 && (
            <Select
              value=""
              disabled={disabled}
              aria-label={t('fromLibrary')}
              onChange={(e) => {
                const m = library.find((x) => x.id === e.target.value);
                if (m) patch({ subject: m.subject ?? '', body: m.body });
              }}
            >
              <option value="">{t('fromLibrary')}</option>
              {emailChoices.map((m) => (
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
          <label htmlFor={`${prefix}-template-${r.id}`} className="text-xs font-medium">
            {t('templateTitle')}
          </label>
          <Select
            id={`${prefix}-template-${r.id}`}
            value={r.waTemplateId}
            disabled={disabled}
            onChange={(e) => {
              const picked = templates.find((x) => x.id === e.target.value);
              // The picker lists approved templates only, so a template picked here is approved.
              patch({
                waTemplateId: e.target.value,
                waTemplateStatus: picked ? 'approved' : null,
                waTemplateName: picked?.name ?? null,
              });
            }}
          >
            <option value="">{t('templateNone')}</option>
            {r.waTemplateId !== '' && !templates.some((x) => x.id === r.waTemplateId) && (
              <option value={r.waTemplateId}>{r.waTemplateName ?? t('templateUnknown')}</option>
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
          onChange={(e) => patch({ label: e.target.value })}
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
  );
}

export function AddChannelChip({
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
  const use = channelUse(states, channel);
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

/** A unique element id helper for the pieces that need one outside a list (used by the timeline's lanes). */
export function useScopedId(prefix: string | undefined): string {
  const auto = useId();
  return prefix ?? auto;
}
