'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { translationSettingsSchema, type TranslationSettings } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Select, Spinner } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { errorKey } from '../lib';

const KEY = ['i18n', 'workspace-translation'] as const;
const NS = 'localization-translation.settings';
const KICKER = 'font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground';

/**
 * TW-I18N-035: Reference's Account > Translation tab. An explainer with three steps, then (on a plan with translation)
 * the engine card, this month's usage, and the settings form with one Save button; on any other plan an upgrade
 * banner and no form. The API is the plan authority.
 */
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
  const [saved, setSaved] = useState(false);
  const [enabled, setEnabled] = useState(s.enabled);
  const [language, setLanguage] = useState(s.teamLanguage);
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/workspace/translation-settings', {
        method: 'PATCH',
        body: { teamLanguage: language, enabled, rowVersion: s.rowVersion },
        schema: translationSettingsSchema,
      }),
    onSuccess: (data) => {
      setError(null);
      setSaved(true);
      qc.setQueryData(KEY, data);
    },
    onError: (e) => {
      setSaved(false);
      setError(te(errorKey(e)));
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const options = s.teamLanguageOptions ?? [s.teamLanguage];
  // A stored code outside the fixed list still has to show as selected.
  const shown = options.includes(language as never) ? options : [language, ...options];

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <Card className="p-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">{t('description')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="rounded-lg border border-border bg-muted p-3">
              <span className="mb-2 grid size-6 place-items-center rounded-full bg-brand font-mono text-[11px] text-brand-foreground">
                {n}
              </span>
              <div className="text-[0.8rem] font-semibold leading-tight">
                {t(`steps.${n}.title`)}
              </div>
              <div className="mt-1 text-[0.7rem] leading-snug text-muted-foreground">
                {t(`steps.${n}.body`)}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {s.planAllows ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <div className={KICKER}>{t('engine.kicker')}</div>
              <div className="mt-1 text-base font-semibold">{s.engineName ?? t('engine.free')}</div>
              <p className="mt-2 text-[0.72rem] leading-snug text-muted-foreground">
                {t('engine.body')}
              </p>
            </Card>
            <Card className="p-5">
              <div className={KICKER}>{t('usage.kicker')}</div>
              <div className="mt-1 text-2xl font-semibold leading-tight text-brand">
                {f.number(s.usageThisMonth.characters)}
              </div>
              <div className="text-[0.7rem] text-muted-foreground">
                {t('usage.line', { count: f.number(s.usageThisMonth.calls) })}
              </div>
            </Card>
          </div>
          <Card className="p-6">
            <form onSubmit={submit} className="space-y-5">
              <Checkbox
                id="translate-on"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                label={
                  <>
                    <span className="block text-[0.8rem] font-semibold">{t('enabled.title')}</span>
                    <span className="block text-[0.72rem] text-muted-foreground">
                      {t('enabled.hint')}
                    </span>
                  </>
                }
              />
              <div className="block">
                <label htmlFor="team-language" className={KICKER + ' mb-1 block'}>
                  {t('teamLanguage.label')}
                </label>
                <Select
                  id="team-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {shown.map((code) => (
                    <option key={code} value={code}>
                      {names.of(code) ?? code} ({code})
                    </option>
                  ))}
                </Select>
                <span className="mt-1 block text-[0.65rem] text-muted-foreground">
                  {t('teamLanguage.hint')}
                </span>
              </div>
              <Button type="submit" variant="brand" disabled={save.isPending}>
                {t('save')}
              </Button>
            </form>
          </Card>
        </>
      ) : (
        <Alert tone="warning" className="px-4 py-3 text-[0.8rem]">
          <strong className="font-semibold">{t('upgrade.title')}</strong> {t('upgrade.body')}{' '}
          <Link href="/account/plans" className="ms-1 font-semibold underline">
            {t('upgrade.link')}
          </Link>
        </Alert>
      )}
    </div>
  );
}
