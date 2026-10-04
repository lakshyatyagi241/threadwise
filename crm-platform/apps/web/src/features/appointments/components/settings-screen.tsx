'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Button, ConfirmDialog, useToast } from '@crm/ui';
import { KEYS, useAppointmentsSetup, useBookingSettings } from '../api/hooks';
import type { BookingSettings } from '../api/schemas';
import { appointmentsApi } from '../api/service';
import { errorKind, fieldErrors } from '../lib/errors';
import {
  draftFromSettings,
  fieldKeyOf,
  hasNoHours,
  isDirty,
  toInput,
  validateDraft,
  type FieldKey,
  type SettingsDraft,
} from '../lib/settings-form';
import { browserZone } from '../lib/zone';
import { isUnavailable } from '../lib/errors';
import { ErrorLine, LinkButton, useAppointmentsCan } from './parts';
import { CalendarCard } from './settings-calendar';
import { DefaultsCard, TemplatesCard, TimeZoneCard, type FormCtx } from './settings-fields';
import { SettingsCard, SettingsHeader } from './settings-parts';
import { useLeaveGuard } from './use-leave-guard';
import { WeeklyHoursEditor } from './weekly-hours-editor';

/** `/appointments/settings`: the workspace's booking defaults, business hours, time zone and message templates. */
export function SettingsScreen() {
  useAppointmentsSetup();
  const t = useTranslations('appointments.settings');
  const can = useAppointmentsCan();
  const query = useBookingSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {can.read && query.isSuccess ? (
        <SettingsEditor
          settings={query.data}
          canEdit={can.update}
          reload={() => query.refetch().then((r) => r.data ?? null)}
        />
      ) : (
        <>
          <SettingsHeader />
          {!can.read ? (
            <Alert tone="warning">{t('forbidden')}</Alert>
          ) : query.isPending ? (
            <SettingsSkeleton label={t('loading')} />
          ) : isUnavailable(query.error) ? (
            <>
              <Alert tone="info" className="space-y-3">
                <p>{t('notAvailable')}</p>
                <LinkButton href="/appointments/types" variant="brand">
                  {t('openTypes')}
                </LinkButton>
              </Alert>
              {/* The workspace has no booking defaults to edit, but its Google Calendar link is real and lives here. */}
              <CalendarCard />
            </>
          ) : (
            <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
          )}
        </>
      )}
    </div>
  );
}

function SettingsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="rounded-xl border border-border bg-background p-5"
        >
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

type ServerErrors = Partial<Record<FieldKey, string>>;

function SettingsEditor({
  settings,
  canEdit,
  reload,
}: {
  settings: BookingSettings;
  canEdit: boolean;
  reload: () => Promise<BookingSettings | null>;
}) {
  const t = useTranslations('appointments.settings');
  const qc = useQueryClient();
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  const [base, setBase] = useState(settings);
  const initial = useMemo(() => draftFromSettings(base, browserZone()), [base]);
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const [serverErrors, setServerErrors] = useState<ServerErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const readOnly = !canEdit;
  const dirty = useMemo(() => isDirty(initial, draft), [initial, draft]);
  const guard = useLeaveGuard(dirty && !readOnly);

  // A newer record arrives (another tab saved, a refetch): take it when nothing here is being edited.
  if (!dirty && settings.rowVersion !== base.rowVersion) {
    setBase(settings);
    setDraft(draftFromSettings(settings, browserZone()));
  }

  const problems = useMemo(() => validateDraft(draft), [draft]);
  const problemCount = Object.keys(problems).length;

  const patch = useCallback((next: Partial<SettingsDraft>, touched?: FieldKey) => {
    setDraft((d) => ({ ...d, ...next }));
    setConflict(false);
    if (touched) {
      setServerErrors((s) => {
        if (!(touched in s)) return s;
        const rest = { ...s };
        delete rest[touched];
        return rest;
      });
    }
  }, []);

  const err = useCallback(
    (key: FieldKey): string | undefined => {
      const server = serverErrors[key];
      if (server) return server;
      const p = problems[key];
      return p ? t(`v.${p.code}`, p.params) : undefined;
    },
    [problems, serverErrors, t],
  );

  function focusFirstError() {
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  }

  function adopt(next: BookingSettings) {
    setBase(next);
    setDraft(draftFromSettings(next, browserZone()));
    setServerErrors({});
    setError(null);
    setTried(false);
    setConflict(false);
  }

  async function save() {
    if (savingRef.current || readOnly) return;
    setTried(true);
    setError(null);
    if (problemCount > 0) {
      toast(t('fixFirst'), 'danger');
      focusFirstError();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setServerErrors({});
    try {
      const next = await appointmentsApi.saveSettings(base.rowVersion, toInput(draft));
      qc.setQueryData(KEYS.settings, next);
      adopt(next);
      toast(t('saved'));
    } catch (e) {
      if (errorKind(e) === 'conflict') {
        setConflict(true);
      } else {
        const mapped: ServerErrors = {};
        let unmapped = false;
        for (const [path, message] of Object.entries(fieldErrors(e))) {
          const key = fieldKeyOf(path);
          if (key) mapped[key] ??= message;
          else unmapped = true;
        }
        setServerErrors(mapped);
        // Messages that belong to a field sit under it; anything else, or a failure without fields, goes in the banner.
        setError(Object.keys(mapped).length > 0 && !unmapped ? null : e);
        if (Object.keys(mapped).length > 0) focusFirstError();
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reloadLatest() {
    const fresh = await reload();
    if (fresh) adopt(fresh);
    else setConflict(false);
  }

  const ctx: FormCtx = { draft, patch, err, readOnly };
  const hoursError = err('businessHours');

  return (
    <div ref={rootRef} className="space-y-4">
      <SettingsHeader
        save={readOnly ? undefined : { onSave: () => void save(), saving, disabled: !dirty }}
      />

      {readOnly && <Alert tone="info">{t('readOnly')}</Alert>}
      {conflict && (
        <Alert
          tone="danger"
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{t('conflict.message')}</span>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void reloadLatest()}
          >
            {t('conflict.reload')}
          </Button>
        </Alert>
      )}
      {error !== null && !conflict && <ErrorLine error={error} />}
      {tried && problemCount > 0 && !saving && (
        <Alert tone="danger">{t('issues', { count: problemCount })}</Alert>
      )}

      <CalendarCard />
      <TimeZoneCard {...ctx} />
      <SettingsCard id="hours" title={t('hours.title')} description={t('hours.description')}>
        <WeeklyHoursEditor
          value={draft.week}
          disabled={readOnly}
          onChange={(week) => patch({ week }, 'businessHours')}
        />
        {hoursError ? (
          <p role="alert" className="text-xs text-danger">
            {hoursError}
          </p>
        ) : (
          hasNoHours(draft) && <p className="text-xs text-warning">{t('hours.noHours')}</p>
        )}
      </SettingsCard>
      <DefaultsCard {...ctx} />
      <TemplatesCard {...ctx} />

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <p role="status" className="text-sm text-muted-foreground">
            {saving ? (
              t('saving')
            ) : dirty ? (
              <span className="font-medium text-warning">{t('unsaved')}</span>
            ) : (
              t('allSaved')
            )}
          </p>
          <Button variant="secondary" disabled={!dirty || saving} onClick={() => adopt(base)}>
            {t('discard')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={guard.target !== null}
        title={t('leave.title')}
        message={t('leave.message')}
        confirmLabel={t('leave.leave')}
        cancelLabel={t('leave.stay')}
        tone="danger"
        onConfirm={guard.leave}
        onClose={guard.stay}
      />
    </div>
  );
}
