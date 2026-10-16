'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { BUSINESS_HOURS_DAY_KEYS, type BusinessHours, type BusinessHoursDay } from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { TimezoneCombobox } from '@/features/auth-registration-security/shared/timezone-combobox';
import { ApiError } from '@/lib/api/errors';
import { KEYS, routingApi, useBusinessHours } from '../api/routing';
import {
  checkDraft,
  draftFrom,
  toUpdateInput,
  type BusinessHoursDraft,
  type DayProblems,
} from '../lib/business-hours';

/**
 * The "Business hours" dialog of the Auto-assignment screen (Reference: the same modal in Routing Rules). The weekly schedule and the
 * time zone that the routing condition "outside business hours" and the SLA clock read. Opening it loads the saved schedule; saving
 * replaces the seven day windows. Reading needs `inbox.settings.read`, saving `inbox.routing.manage`.
 */
export function BusinessHoursDialog({
  open,
  canManage,
  onClose,
}: {
  open: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('team-inbox-routing-sla.businessHours');
  const hours = useBusinessHours(open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      eyebrow={t('eyebrow')}
      size="md"
      closeLabel={t('close')}
    >
      {open && hours.isPending && (
        <div className="flex justify-center p-10" role="status" aria-label={t('loading')}>
          <Spinner />
        </div>
      )}
      {open && hours.isError && <Alert tone="danger">{t('loadFailed')}</Alert>}
      {open && hours.data && (
        <BusinessHoursForm
          // A fresh form each time the dialog opens, from the schedule as saved.
          key={JSON.stringify(hours.data)}
          hours={hours.data}
          canManage={canManage}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function BusinessHoursForm({
  hours,
  canManage,
  onClose,
}: {
  hours: BusinessHours;
  canManage: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('team-inbox-routing-sla.businessHours');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<BusinessHoursDraft>(() => draftFrom(hours));
  const [problems, setProblems] = useState<DayProblems>({});
  const [saving, setSaving] = useState(false);
  const zoneEditable = canManage && hours.canEditTimezone;

  const setDay = (
    k: BusinessHoursDay,
    patch: Partial<BusinessHoursDraft['days'][BusinessHoursDay]>,
  ) => setDraft((d) => ({ ...d, days: { ...d.days, [k]: { ...d.days[k], ...patch } } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canManage || saving) return;
    const found = checkDraft(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await routingApi.updateBusinessHours(toUpdateInput(draft, hours.canEditTimezone));
      await qc.invalidateQueries({ queryKey: KEYS.businessHours });
      toast(t('saved'), 'success');
      onClose();
    } catch (err) {
      toast(err instanceof ApiError && err.message ? err.message : t('saveFailed'), 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form
        id="business-hours-form"
        className="space-y-5"
        onSubmit={(e) => void save(e)}
        noValidate
      >
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>

        <Field
          label={t('timezone')}
          htmlFor="business-hours-timezone"
          hint={zoneEditable ? t('timezoneHint') : t('timezoneOwnerOnly')}
        >
          <TimezoneCombobox
            id="business-hours-timezone"
            value={draft.timezone}
            extra={[hours.timezone]}
            onChange={(zone) => setDraft((d) => ({ ...d, timezone: zone }))}
            disabled={!zoneEditable || saving}
          />
        </Field>

        <fieldset className="space-y-3" disabled={!canManage || saving}>
          <legend className="text-sm font-semibold">{t('days')}</legend>
          {BUSINESS_HOURS_DAY_KEYS.map((k) => {
            const day = draft.days[k];
            const problem = problems[k];
            const dayName = t(`day.${k}`);
            return (
              <div key={k} className="grid grid-cols-[minmax(0,8rem)_1fr] items-start gap-3">
                <Checkbox
                  id={`bh-${k}-enabled`}
                  label={dayName}
                  checked={day.enabled}
                  onChange={(e) => setDay(k, { enabled: e.target.checked })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('from')} htmlFor={`bh-${k}-from`}>
                    <Input
                      id={`bh-${k}-from`}
                      type="time"
                      value={day.from}
                      aria-label={`${dayName} ${t('from')}`}
                      aria-invalid={problem ? true : undefined}
                      onChange={(e) => setDay(k, { from: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('to')}
                    htmlFor={`bh-${k}-to`}
                    error={problem ? t(`problem.${problem}`) : undefined}
                  >
                    <Input
                      id={`bh-${k}-to`}
                      type="time"
                      value={day.to}
                      aria-label={`${dayName} ${t('to')}`}
                      aria-invalid={problem ? true : undefined}
                      onChange={(e) => setDay(k, { to: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </fieldset>

        <p className="text-xs text-muted-foreground">{t('note')}</p>
      </form>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {canManage ? t('cancel') : t('close')}
        </Button>
        {canManage && (
          <Button type="submit" form="business-hours-form" disabled={saving}>
            {saving && <Spinner />}
            {t('save')}
          </Button>
        )}
      </div>
    </>
  );
}
