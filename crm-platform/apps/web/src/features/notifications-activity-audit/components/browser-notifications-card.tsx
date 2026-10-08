'use client';

import { useTranslations } from 'next-intl';
import type { PushDevice } from '@crm/contracts';
import { Alert, Badge, Button, Card, Spinner } from '@crm/ui';
import {
  useBrowserPush,
  usePushDeployment,
  type BrowserPush,
  type PushProblem,
} from '../push/use-browser-push';
import type { PushUiState, TestOutcome } from '../push/support';

/**
 * Account, Notifications: "Browser notifications". An OS-level notification for the events that reach your bell, even with the CRM
 * closed, on the devices where you allowed it. It does not exist at all when the deployment has no push keys.
 *
 * Permission is asked only from the click on "Enable" (never on page load), and every state the browser can be in has its own honest
 * sentence: unsupported, needs installing (iPhone and iPad), blocked in the browser's settings, off, on for this device.
 */
export function BrowserNotificationsCard() {
  const deployment = usePushDeployment();
  // Nothing to show until the deployment answers, and nothing at all when it has no keys: the feature is invisible.
  if (deployment.loading || !deployment.configured) return null;
  return <ConfiguredCard />;
}

function ConfiguredCard() {
  const push = useBrowserPush();
  return <BrowserNotificationsView push={push} />;
}

/** Everything the card draws, as a plain component of props so each state can be rendered in a test. */
export function BrowserNotificationsView({ push }: { push: BrowserPush }) {
  const t = useTranslations('notifications.prefs.push');
  const state: PushUiState = push.state;
  if (state === 'unconfigured') return null;

  return (
    <Card className="space-y-3 p-4" data-testid="browser-notifications" data-state={state}>
      <header className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {t('title')}
          <StateBadge state={state} />
        </h2>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </header>

      {push.problem && <ProblemAlert problem={push.problem} onDismiss={push.dismissProblem} />}

      {state === 'checking' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner label={t('checking')} /> {t('checking')}
        </p>
      )}

      {state === 'unsupported' && <p className="text-sm">{t('unsupported')}</p>}

      {state === 'needs_install' && (
        <div className="space-y-1 text-sm">
          <p>{t('needsInstall')}</p>
          <p className="text-xs text-muted-foreground">{t('needsInstallSteps')}</p>
        </div>
      )}

      {state === 'blocked' && (
        <div className="space-y-1 text-sm">
          <p>{t('blocked')}</p>
          <p className="text-xs text-muted-foreground">{t('blockedHelp')}</p>
        </div>
      )}

      {state === 'off' && (
        <div className="space-y-2">
          <p className="text-sm">{t('offHelp')}</p>
          {/* The one place permission is requested: the click. */}
          <Button onClick={() => void push.enable()} disabled={push.busy !== null}>
            {push.busy === 'enable' ? t('enabling') : t('enable')}
          </Button>
        </div>
      )}

      {state === 'on' && (
        <div className="space-y-2">
          <p className="text-sm">{t('onHelp')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void push.sendTest()}
              disabled={push.busy !== null}
            >
              {push.busy === 'test' ? t('testing') : t('test')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void push.disable()}
              disabled={push.busy !== null}
            >
              {push.busy === 'disable' ? t('disabling') : t('disable')}
            </Button>
          </div>
          {push.testResult && <TestResult outcome={push.testResult} />}
          <p className="text-xs text-muted-foreground">{t('howItWorks')}</p>
        </div>
      )}

      {(state === 'on' || state === 'off' || state === 'blocked') && (
        <Devices
          devices={push.devices}
          failed={push.devicesFailed}
          thisDeviceId={push.thisDeviceId}
          busy={push.busy !== null}
          onRemove={(id) => void push.remove(id)}
        />
      )}
    </Card>
  );
}

function StateBadge({ state }: { state: PushUiState }) {
  const t = useTranslations('notifications.prefs.push');
  if (state === 'on') return <Badge tone="success">{t('state.on')}</Badge>;
  if (state === 'off') return <Badge tone="neutral">{t('state.off')}</Badge>;
  if (state === 'blocked') return <Badge tone="warning">{t('state.blocked')}</Badge>;
  if (state === 'unsupported' || state === 'needs_install') {
    return <Badge tone="neutral">{t('state.unavailable')}</Badge>;
  }
  return null;
}

function ProblemAlert({ problem, onDismiss }: { problem: PushProblem; onDismiss: () => void }) {
  const t = useTranslations('notifications.prefs');
  return (
    <Alert tone="danger" className="flex items-start justify-between gap-3">
      <span>{t(`push.problem.${problem}`)}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded text-xs font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('dismiss')}
      </button>
    </Alert>
  );
}

function TestResult({ outcome }: { outcome: TestOutcome | 'wait' }) {
  const t = useTranslations('notifications.prefs.push');
  return (
    <Alert tone={outcome === 'sent' ? 'success' : outcome === 'wait' ? 'info' : 'warning'}>
      {t(`testResult.${outcome}`)}
    </Alert>
  );
}

function Devices({
  devices,
  failed,
  thisDeviceId,
  busy,
  onRemove,
}: {
  devices: PushDevice[] | undefined;
  failed: boolean;
  thisDeviceId: string | null;
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations('notifications.prefs.push');
  if (failed) return <p className="text-xs text-muted-foreground">{t('devicesFailed')}</p>;
  if (!devices || devices.length === 0) return null;
  return (
    <section className="space-y-1.5" aria-label={t('devices.title')}>
      <h3 className="text-xs font-semibold text-muted-foreground">{t('devices.title')}</h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {devices.map((device) => (
          <li
            key={device.id}
            className="flex items-center justify-between gap-3 px-3 py-2"
            data-device={device.id}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span dir="auto">{device.label}</span>
                {device.id === thisDeviceId && (
                  <Badge tone="neutral">{t('devices.thisDevice')}</Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('devices.added', { date: formatDate(device.createdAt) })}
                {device.lastUsedAt
                  ? ` · ${t('devices.lastUsed', { date: formatDate(device.lastUsedAt) })}`
                  : ` · ${t('devices.neverUsed')}`}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(device.id)}
              aria-label={t('devices.removeFor', { device: device.label })}
              className="shrink-0 rounded-md px-1 py-0.5 text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {t('devices.remove')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
