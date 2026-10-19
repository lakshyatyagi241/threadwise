'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { ConferencingCapabilities, MeetingConferencingInput } from '@crm/contracts';
import { useConferencingCapabilities } from '../api/conferencing';
import { connectLinkOf, optionsFor, toggleProvider } from '../lib/form-model';

const CHIP =
  'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The video and calendar part of the Add / Edit meeting form (BL-360..BL-362). It asks the API what THIS person has: an option appears only
 * when its integration is installed and connected, and a person who has none sees nothing, or one quiet link to connect (to the Settings page
 * when something is installed and only their account is missing, to the Marketplace when they may install). It never blocks the form: while
 * loading, and when the answer fails, it draws nothing.
 *
 * It owns no state: `value` is what the form will send (`undefined` = nothing asked for), `onChange` reports the new one.
 */
export function MeetingConferencingFields({
  value,
  onChange,
  hasStart,
  disabled = false,
}: {
  value: MeetingConferencingInput | undefined;
  onChange: (next: MeetingConferencingInput | undefined) => void;
  /** The meeting has a start time: a link and a calendar entry need one. */
  hasStart: boolean;
  disabled?: boolean;
}) {
  const caps = useConferencingCapabilities();
  if (!caps.data) return null;
  return (
    <Fields
      caps={caps.data}
      value={value}
      onChange={onChange}
      hasStart={hasStart}
      disabled={disabled}
    />
  );
}

function Fields({
  caps,
  value,
  onChange,
  hasStart,
  disabled,
}: {
  caps: ConferencingCapabilities;
  value: MeetingConferencingInput | undefined;
  onChange: (next: MeetingConferencingInput | undefined) => void;
  hasStart: boolean;
  disabled: boolean;
}) {
  const t = useTranslations('meeting-conferencing.form');
  const id = useId();
  const options = optionsFor(caps, value?.videoProvider ?? null);
  const chosen = value?.videoProvider ?? null;
  const chosenVia = options.find((o) => o.provider === chosen)?.via ?? null;
  const calendar = caps.calendar;
  const link = connectLinkOf(caps);
  const locked = disabled || !hasStart;

  if (options.length === 0 && !calendar) {
    return link ? (
      <p className="text-xs">
        <Link
          href={link}
          className="text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('connectLink')}
        </Link>
      </p>
    ) : null;
  }

  // A Meet room (and a Teams room made by the Microsoft calendar) is part of a calendar event: the entry is on and cannot be unticked.
  const calendarForced = chosenVia === 'calendar';
  const calendarOn = calendarForced || value?.addToCalendar === true;
  const set = (patch: Partial<MeetingConferencingInput>) => {
    const next = { ...value, ...patch };
    const nothing =
      (next.videoProvider ?? null) === null && !next.addToCalendar && !next.sendInvitation;
    // Nothing asked of a meeting that asked for nothing before: send nothing. A meeting that had a link sends the removal explicitly.
    onChange(nothing && !value ? undefined : next);
  };

  return (
    <div className="space-y-2" aria-label={t('label')} role="group">
      {options.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('label')}</p>
          <div className="flex flex-wrap items-center gap-2">
            {options.map((o) => {
              const on = chosen === o.provider;
              return (
                <button
                  key={o.provider}
                  type="button"
                  aria-pressed={on}
                  disabled={locked}
                  onClick={() => set(toggleProvider(chosen, o.provider))}
                  className={`${CHIP} ${
                    on
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {on ? t(`chosen.${o.provider}`) : t(`add.${o.provider}`)}
                </button>
              );
            })}
            {chosen && (
              <button
                type="button"
                disabled={locked}
                onClick={() => set({ videoProvider: null })}
                className="text-xs text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                {t('remove')}
              </button>
            )}
          </div>
          {chosen === 'meet' && <p className="text-xs text-muted-foreground">{t('meetNote')}</p>}
          {chosen === 'teams' && chosenVia === 'calendar' && (
            <p className="text-xs text-muted-foreground">{t('teamsViaCalendar')}</p>
          )}
        </div>
      )}
      {calendar && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-cal`}>
            <input
              id={`${id}-cal`}
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={calendarOn}
              disabled={locked || calendarForced}
              onChange={(e) =>
                set({
                  addToCalendar: e.target.checked,
                  ...(e.target.checked ? {} : { sendInvitation: false }),
                })
              }
            />
            <span>
              {calendar.calendarName
                ? t('calendarNamed', {
                    account: calendar.account ?? calendar.provider,
                    calendar: calendar.calendarName,
                  })
                : t('calendar', { account: calendar.account ?? calendar.provider })}
            </span>
          </label>
          {calendarOn && (
            <div className="ps-6">
              <label className="flex items-center gap-2 text-sm" htmlFor={`${id}-inv`}>
                <input
                  id={`${id}-inv`}
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--primary))]"
                  checked={value?.sendInvitation === true}
                  disabled={locked}
                  aria-describedby={`${id}-inv-hint`}
                  onChange={(e) => set({ sendInvitation: e.target.checked })}
                />
                <span>{t('invite')}</span>
              </label>
              <p id={`${id}-inv-hint`} className="ps-6 text-xs text-muted-foreground">
                {t('inviteHint')}
              </p>
            </div>
          )}
        </div>
      )}
      {!hasStart && <p className="text-xs text-muted-foreground">{t('needsStart')}</p>}
    </div>
  );
}
