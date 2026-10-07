'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { timezoneList } from '@/lib/timezones';
import { Input, Select, cn } from '@crm/ui';
import type { ScheduleType } from '../lib/compose-model';

const LABEL = 'mb-1.5 block text-[11.5px] font-semibold';

/** "When do you want to send your broadcast?" (WD-BCAST-008): send now, or a date, time and time zone. */
export function ScheduleSection({
  type,
  date,
  time,
  timezone,
  minDate,
  onType,
  onDate,
  onTime,
  onTimezone,
}: {
  type: ScheduleType;
  date: string;
  time: string;
  timezone: string;
  /** Today in the chosen zone: the earliest date offered. */
  minDate: string;
  onType: (t: ScheduleType) => void;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  onTimezone: (v: string) => void;
}) {
  const t = useTranslations('broadcasts.compose');
  const zones = useMemo(() => timezoneList(timezone), [timezone]);

  const card = (value: ScheduleType, title: string, hint: string) => (
    <label
      className={cn(
        'cursor-pointer rounded-2xl border p-4',
        type === value ? 'border-brand bg-muted' : 'border-border bg-background hover:bg-muted/50',
      )}
    >
      <input
        className="sr-only"
        type="radio"
        name="schedule_type"
        value={value}
        checked={type === value}
        onChange={() => onType(value)}
      />
      <div className="text-xl leading-tight">{title}</div>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </label>
  );

  return (
    <div className="border-t border-border pt-5">
      <h2 className="text-xl leading-tight">{t('when')}</h2>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">{t('whenHint')}</p>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {card('now', t('sendNow'), t('sendNowHint'))}
        {card('later', t('sendLater'), t('sendLaterHint'))}
      </div>
      {type === 'later' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="sendDate">
              {t('sendDate')}
            </label>
            <Input
              id="sendDate"
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => onDate(e.target.value)}
              className="text-[12.5px]"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="sendTime">
              {t('sendTime')}
            </label>
            <Input
              id="sendTime"
              type="time"
              value={time}
              onChange={(e) => onTime(e.target.value)}
              className="text-[12.5px]"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="timezone">
              {t('timezone')}
            </label>
            <Select
              id="timezone"
              value={timezone}
              onChange={(e) => onTimezone(e.target.value)}
              className="text-[12.5px]"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
