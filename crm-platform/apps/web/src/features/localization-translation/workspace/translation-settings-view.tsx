'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { translationSettingsSchema, type TranslationSettings } from '@crm/contracts';
import { Alert, Card, Field, Select, Spinner, StatTile, Switch } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { errorKey } from '../lib';

const KEY = ['i18n', 'workspace-translation'] as const;
const NS = 'localization-translation.settings';

/** WD-I18N-035: the workspace's team language and auto-translate switch. Plan-gated; the API is the authority. */
export function TranslationSettingsView() {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      apiFetch('/workspace/translation-settings', { schema: translationSettingsSchema, signal }),
  });
  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert tone="danger">{t('failed')}</Alert>;
  return <Form s={q.data} />;
}

// The schema defaults the option list, so the parsed input type has it optional.
type Settings = Omit<TranslationSettings, 'teamLanguageOptions'> &
  Partial<Pick<TranslationSettings, 'teamLanguageOptions'>>;

function Form({ s }: { s: Settings }) {
  const t = useTranslations(NS);
  const te = useTranslations('localization-translation.errors');
  const f = useFormatter();
  const locale = useLocale();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const save = useMutation({
    mutationFn: (patch: { teamLanguage?: string; enabled?: boolean }) =>
      apiFetch('/workspace/translation-settings', {
        method: 'PATCH',
        body: { ...patch, rowVersion: s.rowVersion },
        schema: translationSettingsSchema,
      }),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(KEY, data);
    },
    onError: (e) => {
      setError(te(errorKey(e)));
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const locked = !s.planAllows || save.isPending;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>
      {!s.planAllows && <Alert tone="warning">{t('upgrade')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Card className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">{t('enabled.title')}</p>
            <p className="text-sm text-muted-foreground">{t('enabled.hint')}</p>
          </div>
          <Switch
            checked={s.enabled}
            label={t('enabled.title')}
            disabled={locked}
            onCheckedChange={(enabled) => save.mutate({ enabled })}
          />
        </div>
        <Field
          label={t('teamLanguage.label')}
          htmlFor="team-language"
          hint={t('teamLanguage.hint')}
        >
          <Select
            id="team-language"
            value={s.teamLanguage}
            disabled={locked}
            onChange={(e) => save.mutate({ teamLanguage: e.target.value })}
          >
            {(s.teamLanguageOptions ?? [s.teamLanguage]).map((code) => (
              <option key={code} value={code}>
                {names.of(code) ?? code}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted-foreground">
          {s.engineName ? t('engine', { name: s.engineName }) : t('engineNone')}
        </p>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t('usage.characters')} value={f.number(s.usageThisMonth.characters)} />
        <StatTile label={t('usage.calls')} value={f.number(s.usageThisMonth.calls)} />
      </div>
    </div>
  );
}
