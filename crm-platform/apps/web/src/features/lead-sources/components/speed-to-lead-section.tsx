'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  SPEED_TO_LEAD_CHANNELS,
  SPEED_TO_LEAD_MAX_DELAY_MINUTES,
  type SpeedToLeadChannel,
} from '@crm/contracts';
import { Alert, Field, Input, Select, Switch } from '@crm/ui';
import { useSpeedOptions } from '../api-ops';
import { SPEED_MAX_AGE_CHOICES, type SourceDraft, type SpeedDraft } from '../lib/draft';

/**
 * "First message to a new lead" (BL-014, spec L-16): off by default. The person chooses the channel, the template (and for SMS and
 * email the sender), how long to wait (0 to 60 minutes) and whether to wait for business hours. What it does NOT offer is a way past
 * the consent rules: the note under the switch says so, because it is what people ask first.
 */
export function SpeedToLeadSection({
  draft,
  set,
  error,
  disabled,
}: {
  draft: SourceDraft;
  set: (fn: (d: SourceDraft) => SourceDraft) => void;
  /** `path -> sentence` for the client's own checks and the server's field errors (`useFieldError`). */
  error: (path: string) => string | undefined;
  disabled?: boolean;
}) {
  const t = useTranslations('lead-sources.form');
  const format = useFormatter();
  const speed = draft.speed;
  const options = useSpeedOptions(speed.channel, speed.enabled && !disabled);
  const patch = (next: Partial<SpeedDraft>) =>
    set((d) => ({ ...d, speed: { ...d.speed, ...next } }));

  const templates = options.data?.templates ?? [];
  const senders = options.data?.senders ?? [];
  const known = templates.some((x) => x.id === speed.templateId);
  // A limit set some other way than by this list stays visible and selected instead of silently becoming one of the choices.
  const ages = SPEED_MAX_AGE_CHOICES.includes(Number(speed.maxLeadAge))
    ? SPEED_MAX_AGE_CHOICES
    : [...SPEED_MAX_AGE_CHOICES, Number(speed.maxLeadAge)].filter((n) => Number.isFinite(n));
  const ageLabel = (minutes: number) =>
    minutes % 1440 === 0
      ? format.number(minutes / 1440, { style: 'unit', unit: 'day', unitDisplay: 'long' })
      : minutes % 60 === 0
        ? format.number(minutes / 60, { style: 'unit', unit: 'hour', unitDisplay: 'long' })
        : format.number(minutes, { style: 'unit', unit: 'minute', unitDisplay: 'long' });

  return (
    <section aria-labelledby="ls-speed-h" className="space-y-4" data-testid="speed-to-lead">
      <h3 id="ls-speed-h" className="text-sm font-semibold">
        {t('sections.speed')}
      </h3>
      <div className="flex items-start gap-3">
        <Switch
          id="ls-speed-on"
          checked={speed.enabled}
          disabled={disabled}
          label={t('speed.enabled')}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
        <label htmlFor="ls-speed-on" className="text-sm">
          <span className="block font-medium">{t('speed.enabled')}</span>
          <span className="block text-xs text-muted-foreground">{t('speed.enabledHint')}</span>
        </label>
      </div>

      {speed.enabled && (
        <div className="space-y-4">
          <Alert tone="info" className="text-xs">
            {t('speed.consentNote')}
          </Alert>
          {options.isError && <Alert tone="warning">{t('speed.optionsFailed')}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('speed.channel')} htmlFor="ls-speed-channel">
              <Select
                id="ls-speed-channel"
                value={speed.channel}
                disabled={disabled}
                onChange={(e) =>
                  // A template and a sender belong to one channel: changing it starts the choice again.
                  patch({
                    channel: e.target.value as SpeedToLeadChannel,
                    templateId: '',
                    senderId: '',
                  })
                }
              >
                {SPEED_TO_LEAD_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t(`speed.channels.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={t('speed.template')}
              htmlFor="ls-speed-template"
              hint={t(`speed.templateHint.${speed.channel}`)}
              error={error('defaults.speedToLead.templateId')}
            >
              <Select
                id="ls-speed-template"
                value={speed.templateId}
                disabled={disabled || options.isPending}
                invalid={Boolean(error('defaults.speedToLead.templateId'))}
                onChange={(e) => patch({ templateId: e.target.value })}
              >
                <option value="">
                  {templates.length === 0 && !options.isPending
                    ? t('speed.templateNone')
                    : t('speed.templateChoose')}
                </option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.preview ? `${x.name}: ${x.preview}` : x.name}
                  </option>
                ))}
                {speed.templateId !== '' && !known && !options.isPending && (
                  <option value={speed.templateId}>{t('speed.templateUnavailable')}</option>
                )}
              </Select>
            </Field>

            {speed.channel !== 'whatsapp' && (
              <Field
                label={t('speed.sender')}
                htmlFor="ls-speed-sender"
                hint={t(`speed.senderHint.${speed.channel}`)}
                error={error('defaults.speedToLead.senderId')}
              >
                <Select
                  id="ls-speed-sender"
                  value={speed.senderId}
                  disabled={disabled || options.isPending}
                  invalid={Boolean(error('defaults.speedToLead.senderId'))}
                  onChange={(e) => patch({ senderId: e.target.value })}
                >
                  <option value="">{t('speed.senderDefault')}</option>
                  {senders.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                  {speed.senderId !== '' && !senders.some((x) => x.id === speed.senderId) && (
                    <option value={speed.senderId}>{t('speed.senderUnavailable')}</option>
                  )}
                </Select>
              </Field>
            )}

            <Field
              label={t('speed.delay')}
              htmlFor="ls-speed-delay"
              hint={t('speed.delayHint', { max: SPEED_TO_LEAD_MAX_DELAY_MINUTES })}
              error={error('defaults.speedToLead.delayMinutes')}
            >
              <Input
                id="ls-speed-delay"
                dir="ltr"
                inputMode="numeric"
                value={speed.delay}
                disabled={disabled}
                invalid={Boolean(error('defaults.speedToLead.delayMinutes'))}
                onChange={(e) => patch({ delay: e.target.value })}
              />
            </Field>

            <Field
              label={t('speed.maxAge')}
              htmlFor="ls-speed-max-age"
              hint={t('speed.maxAgeHint')}
              error={error('defaults.speedToLead.maxLeadAgeMinutes')}
            >
              <Select
                id="ls-speed-max-age"
                value={speed.maxLeadAge}
                disabled={disabled}
                invalid={Boolean(error('defaults.speedToLead.maxLeadAgeMinutes'))}
                onChange={(e) => patch({ maxLeadAge: e.target.value })}
              >
                {ages.map((m) => (
                  <option key={m} value={String(m)}>
                    {ageLabel(m)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="ls-speed-hours"
              checked={speed.businessHoursOnly}
              disabled={disabled}
              label={t('speed.businessHours')}
              onCheckedChange={(businessHoursOnly) => patch({ businessHoursOnly })}
            />
            <label htmlFor="ls-speed-hours" className="text-sm">
              <span className="block font-medium">{t('speed.businessHours')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('speed.businessHoursHint')}
              </span>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
