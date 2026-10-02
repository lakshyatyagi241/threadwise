'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { Button, Field, Input, Select, Textarea } from '@crm/ui';
import { TEMPLATE_EVENTS, type TemplateEvent } from '../api/schemas';
import {
  LIMITS,
  PLACEHOLDERS,
  TEMPLATE_MAX,
  DEFAULT_TEMPLATES,
  isDefaultTemplate,
  unknownPlaceholders,
  type FieldKey,
  type NumberField,
  type SettingsDraft,
} from '../lib/settings-form';
import { offsetLabel, zonesWith } from '../lib/zone';
import { SettingsCard } from './settings-parts';

/** What every card of the form gets: the draft, how to change it, the message for a field, and the lock. */
export interface FormCtx {
  draft: SettingsDraft;
  patch: (next: Partial<SettingsDraft>, touched?: FieldKey) => void;
  err: (key: FieldKey) => string | undefined;
  readOnly: boolean;
}

export function TimeZoneCard({ draft, patch, err, readOnly }: FormCtx) {
  const t = useTranslations('appointments.settings.timezone');
  const id = useId();
  const zones = useMemo(() => zonesWith(draft.timezone), [draft.timezone]);
  const at = useMemo(() => new Date(), []);
  return (
    <SettingsCard id="timezone" title={t('title')} description={t('description')}>
      <Field label={t('label')} htmlFor={id} hint={t('hint')} error={err('timezone')}>
        <Select
          id={id}
          value={draft.timezone}
          disabled={readOnly}
          invalid={Boolean(err('timezone'))}
          onChange={(e) => patch({ timezone: e.target.value }, 'timezone')}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')} ({offsetLabel(at, z)})
            </option>
          ))}
        </Select>
      </Field>
    </SettingsCard>
  );
}

const NUMBER_LAYOUT: NumberField[] = [
  'slotDurationMinutes',
  'maxPerDay',
  'bufferBeforeMinutes',
  'bufferAfterMinutes',
  'advanceDays',
  'reminderMinutesBefore',
];

/** Reference's "Booking rules": the numbers every booking type starts from, and the default place. */
export function DefaultsCard({ draft, patch, err, readOnly }: FormCtx) {
  const t = useTranslations('appointments.settings.defaults');
  const base = useId();
  const locationId = `${base}-location`;
  return (
    <SettingsCard id="defaults" title={t('title')} description={t('description')}>
      <div className="grid gap-4 sm:grid-cols-2">
        {NUMBER_LAYOUT.map((f) => {
          const message = err(f);
          return (
            <Field
              key={f}
              label={t(`fields.${f}`)}
              htmlFor={`${base}-${f}`}
              hint={t(`hints.${f}`, LIMITS[f])}
              error={message}
            >
              <Input
                id={`${base}-${f}`}
                type="number"
                inputMode="numeric"
                step={1}
                min={LIMITS[f].min}
                max={LIMITS[f].max}
                value={draft.numbers[f]}
                disabled={readOnly}
                invalid={Boolean(message)}
                onChange={(e) => patch({ numbers: { ...draft.numbers, [f]: e.target.value } }, f)}
              />
            </Field>
          );
        })}
        <Field
          label={t('fields.defaultLocation')}
          htmlFor={locationId}
          hint={t('locationHint')}
          error={err('defaultLocation')}
          className="sm:col-span-2"
        >
          <Input
            id={locationId}
            type="text"
            dir="auto"
            value={draft.defaultLocation}
            placeholder={t('locationPlaceholder')}
            disabled={readOnly}
            invalid={Boolean(err('defaultLocation'))}
            onChange={(e) => patch({ defaultLocation: e.target.value }, 'defaultLocation')}
          />
        </Field>
      </div>
    </SettingsCard>
  );
}

/** The four messages a customer gets. Plain text with `{{placeholders}}`; each box can go back to its default. */
export function TemplatesCard({ draft, patch, err, readOnly }: FormCtx) {
  const t = useTranslations('appointments.settings.templates');
  const base = useId();
  const setBody = (e: TemplateEvent, body: string) =>
    patch({ templates: { ...draft.templates, [e]: body } }, `templates.${e}`);
  return (
    <SettingsCard id="templates" title={t('title')} description={t('description')}>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('placeholders')}
        </h3>
        <ul className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p} className="flex items-baseline gap-2">
              <code dir="ltr" className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">
                {p}
              </code>
              <span className="text-muted-foreground">
                {t(`placeholder.${p.slice(2, -2) as 'type' | 'slot' | 'name' | 'manage_link'}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-5">
        {TEMPLATE_EVENTS.map((e) => {
          const body = draft.templates[e];
          const message = err(`templates.${e}`);
          const unknown = unknownPlaceholders(body);
          return (
            <div key={e} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${base}-${e}`} className="text-sm font-medium">
                  {t(`events.${e}`)}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={readOnly || isDefaultTemplate(e, body)}
                  onClick={() => setBody(e, DEFAULT_TEMPLATES[e])}
                >
                  {t('reset')}
                </Button>
              </div>
              <Textarea
                id={`${base}-${e}`}
                dir="auto"
                rows={3}
                value={body}
                disabled={readOnly}
                invalid={Boolean(message)}
                onChange={(ev) => setBody(e, ev.target.value)}
              />
              {message ? (
                <p role="alert" className="text-xs text-danger">
                  {message}
                </p>
              ) : unknown.length > 0 ? (
                <p className="text-xs text-warning">
                  {t('unknown', { names: unknown.join(', ') })}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground tabular-nums">
                  <span dir="ltr" className="inline-block">
                    {t('counter', { count: [...body].length, max: TEMPLATE_MAX })}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}
