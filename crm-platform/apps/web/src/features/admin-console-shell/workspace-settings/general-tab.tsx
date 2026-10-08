'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { WorkspaceSettingsResponse } from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Spinner, Switch } from '@crm/ui';
import {
  usePreferences,
  useSavePreferences,
  useSaveWorkspaceSettings,
  useWorkspaceSettings,
} from './api';
import { timeZoneList } from './logic';

const NS = 'admin-console-shell.workspaceSettings.general';

/** WD-ASHELL-033: workspace name, URL, timezone and currency. Only the owner may save; a blank field is ignored. */
export function GeneralTab() {
  const t = useTranslations(NS);
  const q = useWorkspaceSettings();
  if (q.isPending) return <Spinner />;
  if (q.isError || !q.data) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  return <GeneralForm data={q.data} />;
}

function GeneralForm({ data }: { data: WorkspaceSettingsResponse }) {
  const t = useTranslations(NS);
  const save = useSaveWorkspaceSettings();
  const [name, setName] = useState(data.name);
  const [timezone, setTimezone] = useState(data.timezone);
  const [currency, setCurrency] = useState(data.currency);
  const [saved, setSaved] = useState(false);
  const zones = useMemo(() => timeZoneList(data.timezone), [data.timezone]);
  const locked = !data.isOwner;

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-6">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            save.mutate({ name, timezone, currency }, { onSuccess: () => setSaved(true) });
          }}
        >
          <h2 className="font-serif text-xl">{t('workspace')}</h2>
          {locked && <p className="text-xs italic text-muted-foreground">{t('ownerOnly')}</p>}
          {saved && <Alert tone="success">{t('saved')}</Alert>}
          {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('name')} htmlFor="ws-name">
              <Input
                id="ws-name"
                value={name}
                maxLength={191}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t('url')} htmlFor="ws-slug" hint={t('urlHint')}>
              <Input id="ws-slug" value={data.slug} disabled className="font-mono" readOnly />
            </Field>
            <Field label={t('timezone')} htmlFor="ws-tz" hint={t('timezoneHint')}>
              <Select
                id="ws-tz"
                value={timezone}
                disabled={locked}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('currency')} htmlFor="ws-cur" hint={t('currencyHint')}>
              <Select
                id="ws-cur"
                value={currency}
                disabled={locked}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {data.currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                    {c.symbol ? ` (${c.symbol})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="submit" disabled={locked || save.isPending}>
              {t('save')}
            </Button>
          </div>
        </form>
      </Card>
      <WorkingHours />
      <PreferencesCard />
    </div>
  );
}

/**
 * WD-ASHELL-034: WaDesk's working-hours card is static markup that saves nothing. It is shown as WaDesk shows it (same rows and
 * defaults) but its controls are disabled and say so, rather than pretending to save.
 */
function WorkingHours() {
  const t = useTranslations(`${NS}.hours`);
  const rows = [
    { key: 'weekdays', on: true, from: '09:00', to: '18:00' },
    { key: 'saturday', on: true, from: '10:00', to: '14:00' },
    { key: 'sunday', on: false, from: '00:00', to: '00:00' },
  ] as const;
  return (
    <Card className="space-y-3 p-6">
      <h2 className="font-serif text-xl">{t('title')}</h2>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-2 items-center gap-3 text-sm sm:grid-cols-[100px_1fr_120px_120px]"
          >
            <span className="font-medium">{t(r.key)}</span>
            <Switch checked={r.on} onCheckedChange={() => undefined} disabled label={t(r.key)} />
            <Input type="time" value={r.from} disabled readOnly aria-label={t('from')} />
            <Input type="time" value={r.to} disabled readOnly aria-label={t('to')} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** WD-ASHELL-035: the caller's own "auto AI summarize" switch. Needs no owner rights. */
function PreferencesCard() {
  const q = usePreferences();
  if (q.isPending) return <Spinner />;
  return <PreferencesForm initial={q.data?.autoAiSummarize ?? false} />;
}

function PreferencesForm({ initial }: { initial: boolean }) {
  const t = useTranslations(`${NS}.preferences`);
  const save = useSavePreferences();
  const [on, setOn] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <Card className="space-y-3 p-6">
      <form
        className="flex flex-wrap items-start justify-between gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate(on, { onSuccess: () => setSaved(true) });
        }}
      >
        <div className="max-w-xl space-y-1">
          <h2 className="font-serif text-xl">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
          {saved && <p className="text-xs text-success">{t('saved')}</p>}
          {save.isError && <p className="text-xs text-danger">{t('saveFailed')}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={on} onCheckedChange={setOn} label={t('title')} />
          <Button type="submit" disabled={save.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
