'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, Spinner, Switch, cn } from '@crm/ui';
import { usePreferenceActions, usePreferences } from '../api/prefs-hooks';
import { typeMeta } from '../lib/catalogue';
import { useAlertSettings, type AlertSettings } from '../live/use-alert-settings';
import { useLiveUpdatesPaused } from '../live/use-live-paused';
import { LivePausedNote } from './live-paused-note';
import { usePushDeployment } from '../push/use-browser-push';
import {
  PREF_CHANNELS,
  customCount,
  groupRows,
  type PrefChannel,
  type PrefEntry,
  type PrefsState,
  type RowView,
} from '../prefs/model';
import { BrowserNotificationsCard } from './browser-notifications-card';
import { AlertSwitches } from './notification-bell';
import { TypeIcon } from './type-icon';

/**
 * Account, Notifications: the signed-in person's own choices for each kind of notification: whether it reaches the bell, whether it
 * pops up while they work, whether it plays a sound, whether it reaches their devices as a browser notification (when the deployment has
 * push). The "Browser notifications" card above the table is where a device is enabled. The data comes from the server's effective preferences (their choice, else
 * the workspace's toggle, else the default); a change shows at once and is undone with a message if saving fails.
 */
export function PreferencesScreen() {
  const query = usePreferences();
  const actions = usePreferenceActions();
  const alerts = useAlertSettings();
  const livePaused = useLiveUpdatesPaused();
  // The Push column exists only where the deployment has browser notifications (the card is the same: invisible without keys).
  const push = usePushDeployment();
  return (
    <PreferencesView
      pushEnabled={push.configured}
      browserCard={<BrowserNotificationsCard />}
      state={query.data}
      loading={query.isPending}
      failed={query.isError && !query.data}
      onRetry={() => void query.refetch()}
      saveFailed={actions.failed}
      onDismissSaveFailed={actions.clearFailed}
      onChange={actions.change}
      onReset={actions.reset}
      onResetAll={actions.resetEverything}
      alerts={alerts}
      livePaused={livePaused}
    />
  );
}

/** Everything the screen draws, as a plain component of props so each state can be rendered in a test. */
export function PreferencesView({
  state,
  loading,
  failed,
  onRetry,
  saveFailed,
  onDismissSaveFailed,
  onChange,
  onReset,
  onResetAll,
  alerts,
  pushEnabled = false,
  browserCard = null,
  livePaused = false,
}: {
  pushEnabled?: boolean;
  /** The live connection has been down for a few seconds: a quiet note says alerts are late, so a title that moves with no toast is explained. */
  livePaused?: boolean;
  /** The "Browser notifications" card, a slot so this view stays free of data hooks and can be rendered in a test. */
  browserCard?: ReactNode;
  state: PrefsState | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  saveFailed: boolean;
  onDismissSaveFailed: () => void;
  onChange: (type: string, channel: PrefChannel, value: boolean) => void;
  onReset: (type: string) => void;
  onResetAll: () => void;
  alerts: AlertSettings;
}) {
  const t = useTranslations('notifications.prefs');
  return (
    <div className="space-y-6" data-testid="notification-preferences">
      <header className="space-y-1">
        <h1 id="account-pane-title" className="text-2xl font-semibold">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </header>

      <LivePausedNote paused={livePaused} />

      {browserCard}

      {/* Announced when a save fails and the change is undone (role="alert" from the Alert). */}
      {saveFailed && (
        <Alert tone="danger" className="flex items-start justify-between gap-3">
          <span>{t('saveFailed')}</span>
          <button
            type="button"
            onClick={onDismissSaveFailed}
            className="shrink-0 rounded text-xs font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('dismiss')}
          </button>
        </Alert>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner label={t('loading')} /> {t('loading')}
        </p>
      ) : failed || !state ? (
        <div className="space-y-3">
          <Alert tone="danger">{t('failed')}</Alert>
          <Button variant="secondary" onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <Groups
          state={state}
          pushEnabled={pushEnabled}
          onChange={onChange}
          onReset={onReset}
          onResetAll={onResetAll}
        />
      )}

      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">{t('browser.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('browser.description')}</p>
        <AlertSwitches settings={alerts} />
      </Card>
    </div>
  );
}

function Groups({
  state,
  pushEnabled,
  onChange,
  onReset,
  onResetAll,
}: {
  state: PrefsState;
  pushEnabled: boolean;
  onChange: (type: string, channel: PrefChannel, value: boolean) => void;
  onReset: (type: string) => void;
  onResetAll: () => void;
}) {
  const t = useTranslations('notifications.prefs');
  const groups = groupRows(state.entries);
  const changed = customCount(state);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" disabled={changed === 0} onClick={onResetAll}>
          {t('resetAll')}
        </Button>
      </div>
      {groups.map((group) => (
        <GroupCard
          key={group.group}
          group={group.group}
          rows={group.rows}
          entries={state.entries}
          pushEnabled={pushEnabled}
          onChange={onChange}
          onReset={onReset}
        />
      ))}
    </div>
  );
}

const GRID =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_8rem] sm:items-center sm:gap-3';
const GRID_WITH_PUSH =
  'sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem_8rem] sm:items-center sm:gap-3';
/** The channels drawn as columns: Push only where the deployment has browser notifications. */
const channelsShown = (pushEnabled: boolean): readonly PrefChannel[] =>
  pushEnabled ? PREF_CHANNELS : PREF_CHANNELS.filter((c) => c !== 'push');

function GroupCard({
  group,
  rows,
  entries,
  pushEnabled,
  onChange,
  onReset,
}: {
  pushEnabled: boolean;
  group: string;
  rows: RowView[];
  entries: readonly PrefEntry[];
  onChange: (type: string, channel: PrefChannel, value: boolean) => void;
  onReset: (type: string) => void;
}) {
  const t = useTranslations('notifications.prefs');
  const headingId = useId();
  return (
    <Card className="p-0" role="group" aria-labelledby={headingId}>
      <div className={cn('border-b border-border px-4 py-3', pushEnabled ? GRID_WITH_PUSH : GRID)}>
        <h2 id={headingId} className="text-sm font-semibold">
          {t(`groups.${group}`)}
        </h2>
        {channelsShown(pushEnabled).map((channel) => (
          <span
            key={channel}
            aria-hidden="true"
            className="hidden text-center text-xs font-medium text-muted-foreground sm:block"
          >
            {t(`columns.${channel}`)}
          </span>
        ))}
        <span className="hidden sm:block" />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.type}>
            <PrefRow
              row={row}
              entry={entries.find((e) => e.type === row.type)!}
              pushEnabled={pushEnabled}
              onChange={onChange}
              onReset={onReset}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A label for a type the build has no words for: the type name made readable (the screen still works for it). */
function readable(type: string): string {
  return type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function PrefRow({
  row,
  entry,
  pushEnabled,
  onChange,
  onReset,
}: {
  pushEnabled: boolean;
  row: RowView;
  entry: PrefEntry;
  onChange: (type: string, channel: PrefChannel, value: boolean) => void;
  onReset: (type: string) => void;
}) {
  const t = useTranslations('notifications.prefs');
  const base = `types.${row.type}`;
  const label = t.has(`${base}.label`) ? t(`${base}.label`) : readable(row.type);
  const hint = t.has(`${base}.hint`) ? t(`${base}.hint`) : null;
  const meta = typeMeta(row.type);
  const noteId = useId();
  const onOff = (v: boolean) => t(v ? 'on' : 'off');
  const defaults = pushEnabled
    ? t('defaultSummaryPush', {
        bell: `${t('channelNames.bell')} ${onOff(entry.defaults.bell)}`,
        toast: `${t('channelNames.toast')} ${onOff(entry.defaults.toast && meta.toast)}`,
        sound: `${t('channelNames.sound')} ${onOff(entry.defaults.sound && meta.sound)}`,
        push: `${t('channelNames.push')} ${onOff(entry.defaults.push)}`,
      })
    : t('defaultSummary', {
        bell: `${t('channelNames.bell')} ${onOff(entry.defaults.bell)}`,
        toast: `${t('channelNames.toast')} ${onOff(entry.defaults.toast && meta.toast)}`,
        sound: `${t('channelNames.sound')} ${onOff(entry.defaults.sound && meta.sound)}`,
      });
  const bellOffNote = row.cells.toast.reason === 'bell_off';

  return (
    <div
      className={cn('space-y-2 px-4 py-3', pushEnabled ? GRID_WITH_PUSH : GRID)}
      data-type={row.type}
      data-custom={row.custom}
    >
      <div className="flex min-w-0 items-start gap-3">
        <TypeIcon icon={meta.icon} tone={meta.tone} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span dir="auto">{label}</span>
            {row.custom ? <Badge tone="neutral">{t('customised')}</Badge> : null}
            {row.blocked ? <Badge tone="warning">{t('workspaceOff')}</Badge> : null}
          </p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          <p id={noteId} className="text-xs text-muted-foreground">
            {row.blocked ? t('workspaceOffHelp') : bellOffNote ? t('bellOffHelp') : defaults}
          </p>
          {row.blocked && bellOffNote ? (
            <p className="text-xs text-muted-foreground">{t('bellOffHelp')}</p>
          ) : null}
        </div>
      </div>
      {channelsShown(pushEnabled).map((channel) => {
        const cell = row.cells[channel];
        const channelName = t(`channelNames.${channel}`);
        return (
          <div
            key={channel}
            className="flex items-center justify-between gap-3 sm:justify-center"
            data-channel={channel}
          >
            <span className="text-xs text-muted-foreground sm:hidden">
              {t(`columns.${channel}`)}
            </span>
            {cell.reason === 'not_available' ? (
              <span className="text-muted-foreground">
                <span aria-hidden="true">–</span>
                <span className="sr-only">
                  {t('toggleLabel', { event: label, channel: channelName })}: {t('notAvailable')}
                </span>
              </span>
            ) : (
              <Switch
                checked={cell.on}
                disabled={cell.disabled}
                label={t('toggleLabel', { event: label, channel: channelName })}
                onCheckedChange={(v) => onChange(row.type, channel, v)}
              />
            )}
          </div>
        );
      })}
      <div className="flex justify-end sm:justify-center">
        {row.custom ? (
          <button
            type="button"
            onClick={() => onReset(row.type)}
            aria-label={t('resetRowFor', { event: label })}
            className="rounded-md px-1 py-0.5 text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('resetRow')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
