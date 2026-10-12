'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Card, Spinner, Switch } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useHelpAgentSettings, useSaveHelpAgentSettings } from '../api/help-agent';

/** What the owner agrees to by switching the assistant on: the opt-in text, then the switch. */
export function SettingsScreen() {
  const t = useTranslations('help-agent.settingsPage');
  const settings = useHelpAgentSettings();
  const save = useSaveHelpAgentSettings();

  if (settings.isLoading) {
    return <Spinner label={t('loading')} />;
  }
  if (settings.isError || !settings.data) {
    const error = settings.error;
    return (
      <Alert tone="danger">
        <p>{t('loadFailed')}</p>
        {error instanceof ApiError && error.requestId ? (
          <p className="mt-1 break-all font-mono text-xs">
            {t('requestId', { id: error.requestId })}
          </p>
        ) : null}
      </Alert>
    );
  }

  const enabled = settings.data.enabled;
  return (
    <div className="max-w-2xl space-y-5">
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">{t('shareTitle')}</h2>
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
          <li>{t('share1')}</li>
          <li>{t('share2')}</li>
          <li>{t('share3')}</li>
          <li>{t('share4')}</li>
        </ul>
        <p className="text-sm font-medium">{t('optIn')}</p>
      </Card>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-semibold" id="help-agent-switch-label">
            {t('switchLabel')}
          </p>
          <p className="text-xs text-muted-foreground">{enabled ? t('stateOn') : t('stateOff')}</p>
        </div>
        <Switch
          id="help-agent-switch"
          checked={enabled}
          label={t('switchLabel')}
          disabled={save.isPending}
          onCheckedChange={(next) => save.mutate(next)}
        />
      </Card>

      {save.isError ? (
        <Alert tone="danger">
          <p>{t('saveFailed')}</p>
          {save.error instanceof ApiError && save.error.requestId ? (
            <p className="mt-1 break-all font-mono text-xs">
              {t('requestId', { id: save.error.requestId })}
            </p>
          ) : null}
        </Alert>
      ) : null}
      {save.isSuccess ? (
        <Alert tone="success">{save.data.enabled ? t('savedOn') : t('savedOff')}</Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {t('whoCanUse')}{' '}
        <Link href="/settings/roles" className="font-medium text-primary hover:underline">
          {t('rolesLink')}
        </Link>
      </p>
    </div>
  );
}
