'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  NOTIFICATION_CHANNELS,
  type NotificationCategoryKey,
  type NotificationEventKey,
  type NotificationPrefsResponse,
} from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Spinner, Switch } from '@crm/ui';
import { useNotificationPrefs, useSaveNotificationPrefs } from './api';
import { toMatrix, toRequest, toggleFlag, type Matrix } from './logic';

const NS = 'admin-console-shell.workspaceSettings.notifications';

/** TW-ASHELL-038: 18 named events and 9 record categories, each on or off for the bell, email and Slack. */
export function NotificationsTab() {
  const t = useTranslations(NS);
  const q = useNotificationPrefs();
  if (q.isPending) return <Spinner />;
  if (q.isError || !q.data) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  return <MatrixForm data={q.data} />;
}

function MatrixForm({ data }: { data: NotificationPrefsResponse }) {
  const t = useTranslations(NS);
  const save = useSaveNotificationPrefs();
  const [matrix, setMatrix] = useState<Matrix>(() => toMatrix(data));
  const [slack, setSlack] = useState(data.slackWebhook ?? '');
  const [saved, setSaved] = useState(false);
  const locked = !data.isOwner;
  const flip =
    (zone: 'events' | 'categories', key: string, ch: (typeof NOTIFICATION_CHANNELS)[number]) =>
    (on: boolean) => {
      setSaved(false);
      setMatrix((m) => toggleFlag(m, zone, key, ch, on));
    };

  const table = (
    zone: 'events' | 'categories',
    keys: readonly (NotificationEventKey | NotificationCategoryKey)[],
  ) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs uppercase text-muted-foreground">
          <th className="px-5 py-2 text-start font-medium">
            {t(zone === 'events' ? 'event' : 'category')}
          </th>
          {NOTIFICATION_CHANNELS.map((c) => (
            <th key={c} className="px-3 py-2 text-center font-medium">
              {t(`channels.${c}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-b border-border last:border-0">
            <td className="px-5 py-2">{t(`${zone}.${k}`)}</td>
            {NOTIFICATION_CHANNELS.map((c) => (
              <td key={c} className="px-3 py-2 text-center">
                <Switch
                  checked={matrix[zone][k]?.[c] === true}
                  onCheckedChange={flip(zone, k, c)}
                  disabled={locked}
                  label={`${t(`${zone}.${k}`)}: ${t(`channels.${c}`)}`}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate(toRequest(matrix, slack), { onSuccess: () => setSaved(true) });
      }}
    >
      <Card className="flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="max-w-xl space-y-1">
          <h2 className="text-xl font-semibold">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('note')}</p>
          {locked && <p className="text-xs italic text-muted-foreground">{t('readOnly')}</p>}
        </div>
        <Button type="submit" disabled={locked || save.isPending}>
          {t('save')}
        </Button>
      </Card>
      {saved && <Alert tone="success">{t('saved')}</Alert>}
      {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}
      <Card className="overflow-x-auto p-0">
        <h3 className="border-b border-border px-5 py-3 font-semibold">{t('specificEvents')}</h3>
        {table(
          'events',
          data.events.map((e) => e.key),
        )}
      </Card>
      <Card className="overflow-x-auto p-0">
        <h3 className="border-b border-border px-5 py-3 font-semibold">{t('byCategory')}</h3>
        {table(
          'categories',
          data.categories.map((c) => c.key),
        )}
      </Card>
      <Card className="space-y-4 p-5">
        <Field label={t('slackLabel')} htmlFor="slack-url" hint={t('slackHint')}>
          <Input
            id="slack-url"
            type="url"
            value={slack}
            disabled={locked}
            placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
            className="font-mono"
            onChange={(e) => {
              setSaved(false);
              setSlack(e.target.value);
            }}
          />
        </Field>
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t('channelStatus')}
          </h3>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-success" />
              {t('statusInapp')}
            </li>
            <li className="flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${data.emailLive ? 'bg-success' : 'bg-warning'}`}
              />
              {data.emailLive ? t('statusEmailLive') : t('statusEmailOff')}
            </li>
            <li className="flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${data.slackWebhookSet ? 'bg-success' : 'bg-border'}`}
              />
              {data.slackWebhookSet ? t('statusSlackOn') : t('statusSlackOff')}
            </li>
          </ul>
        </div>
      </Card>
    </form>
  );
}
