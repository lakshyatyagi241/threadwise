'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WABA_HIGH_MPS, type WabaThroughputSettingsResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Switch } from '@crm/ui';
import { saveSettings, watKeys } from '../api';
import { isConflict } from '../lib/errors';
import { Failure } from './ui';

const NS = 'whatsapp-throughput.settings';

const intOr = (v: string, fallback: number) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** The platform-wide switches. Saved with the row version that was read; a conflict reloads and asks the operator to apply the change again. */
export function SettingsForm({ settings }: { settings: WabaThroughputSettingsResponse }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof WabaThroughputSettingsResponse>(
    k: K,
    v: WabaThroughputSettingsResponse[K],
  ) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const save = useMutation({
    mutationFn: () => saveSettings({ ...draft }),
    onSuccess: (next) => {
      setDraft(next);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: watKeys.overviewAll });
    },
    onError: (err) => {
      if (isConflict(err)) void qc.invalidateQueries({ queryKey: watKeys.overviewAll });
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-center gap-3">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => set('enabled', v)}
          label={t('enabled')}
        />
        <div>
          <p className="text-sm font-medium">{t('enabled')}</p>
          <p className="text-xs text-muted-foreground">{t('enabledHelp')}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('defaultMps')} hint={t('defaultMpsHelp')}>
          <Input
            type="number"
            min={1}
            max={WABA_HIGH_MPS}
            value={draft.defaultMps}
            onChange={(e) => set('defaultMps', intOr(e.target.value, draft.defaultMps))}
          />
        </Field>
        <Field label={t('safetyMargin')} hint={t('safetyMarginHelp')}>
          <Input
            type="number"
            min={0}
            max={50}
            value={draft.safetyMarginPct}
            onChange={(e) => set('safetyMarginPct', intOr(e.target.value, draft.safetyMarginPct))}
          />
        </Field>
        <Field label={t('maxWait')} hint={t('maxWaitHelp')}>
          <Input
            type="number"
            min={0}
            max={60000}
            step={500}
            value={draft.maxLocalWaitMs}
            onChange={(e) => set('maxLocalWaitMs', intOr(e.target.value, draft.maxLocalWaitMs))}
          />
        </Field>
        <Field label={t('syncInterval')} hint={t('syncIntervalHelp')}>
          <Input
            type="number"
            min={5}
            max={1440}
            value={draft.syncIntervalMinutes}
            onChange={(e) =>
              set('syncIntervalMinutes', intOr(e.target.value, draft.syncIntervalMinutes))
            }
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <Switch
            checked={draft.adaptiveBackoff}
            onCheckedChange={(v) => set('adaptiveBackoff', v)}
            label={t('adaptive')}
          />
          <div>
            <p className="text-sm font-medium">{t('adaptive')}</p>
            <p className="text-xs text-muted-foreground">{t('adaptiveHelp')}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            checked={draft.enforceTierCap}
            onCheckedChange={(v) => set('enforceTierCap', v)}
            label={t('enforceTier')}
          />
          <div>
            <p className="text-sm font-medium">{t('enforceTier')}</p>
            <p className="text-xs text-muted-foreground">{t('enforceTierHelp')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-xs">
        <Field label={t('tierWarn')} hint={t('tierWarnHelp')}>
          <Input
            type="number"
            min={50}
            max={99}
            value={draft.tierWarnPct}
            onChange={(e) => set('tierWarnPct', intOr(e.target.value, draft.tierWarnPct))}
          />
        </Field>
      </div>

      {save.isError && <Failure error={save.error} />}
      {saved && <Alert tone="success">{t('saved')}</Alert>}

      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
