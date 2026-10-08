'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PersonalDevice } from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Input, Spinner, Tabs, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useDevices, useUpdateDevice } from '../api/devices';
import { capIndicator } from '../lib/cap-model';
import { PERMISSIONS, type DevicePerms } from '../lib/format';
import { STATE_FILTERS, filterDevices, type StateFilter } from '../lib/state-model';
import { ConnectWizard } from './connect-wizard';
import { DeviceCard, type CardAction } from './device-card';
import { DeleteDialog, DisconnectDialog, RenameDialog } from './device-dialogs';
import { ErrorNotice } from './error-notice';
import { useErrorText } from './use-error-text';

const NS = 'whatsapp-devices-baileys';

type Dialog =
  | { kind: 'wizard'; device: PersonalDevice | null }
  | { kind: 'disconnect' | 'rename' | 'delete'; device: PersonalDevice };

/**
 * The numbers list (spec 13.2): the standing reminder, the cap meter, one card per number with its status, "Connect a number" and
 * the actions the session may take. A number being linked or reconnected opens the same wizard as a new one.
 */
export function DevicesScreen() {
  const t = useTranslations(`${NS}.list`);
  const tc = useTranslations(`${NS}.common`);
  const errorText = useErrorText();
  const { toast } = useToast();
  const list = useDevices();
  const canCreate = useCan(PERMISSIONS.create);
  const canPair = useCan(PERMISSIONS.pair);
  const canDisconnect = useCan(PERMISSIONS.disconnect);
  const canDelete = useCan(PERMISSIONS.delete);
  const perms: DevicePerms = {
    create: canCreate,
    pair: canPair,
    disconnect: canDisconnect,
    delete: canDelete,
  };

  const [tab, setTab] = useState<StateFilter>('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [sendingError, setSendingError] = useState<ReturnType<typeof errorText> | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const toggle = useUpdateDevice();

  const items = list.data?.data ?? [];
  const meta = list.data?.meta;
  const cap = capIndicator(meta?.used ?? items.length, meta?.limit);
  const close = () => setDialog(null);

  const onAction = (action: CardAction, device: PersonalDevice) => {
    setSendingError(null);
    setDialog(action === 'link' ? { kind: 'wizard', device } : { kind: action, device });
  };

  const onSending = (device: PersonalDevice, active: boolean) => {
    setSendingError(null);
    setSendingId(device.id);
    toggle.mutate(
      { id: device.id, input: { active, rowVersion: device.rowVersion } },
      {
        onSuccess: () => toast(t('done.sendingSaved'), 'success'),
        onError: (e) => setSendingError(errorText(e)),
      },
    );
  };

  const canConnect = canCreate && canPair && !cap.full;
  const shown = filterDevices(items, tab, query);

  const body = () => {
    if (list.isPending) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      );
    }
    if (list.isError) {
      const et = errorText(list.error);
      return (
        <div className="space-y-2">
          <ErrorNotice error={et} />
          {et.code !== 'WA_UNOFFICIAL_DISABLED' && (
            <Button variant="secondary" size="sm" onClick={() => list.refetch()}>
              {t('retry')}
            </Button>
          )}
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <EmptyState
          title={t('empty.title')}
          message={t('empty.message')}
          actions={
            canCreate && canPair ? (
              <Button onClick={() => setDialog({ kind: 'wizard', device: null })}>
                {t('empty.action')}
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">{t('empty.noPermission')}</span>
            )
          }
        />
      );
    }
    const cards =
      shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('noMatch')}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="devices-grid">
          {shown.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              perms={perms}
              busy={toggle.isPending && sendingId === d.id}
              onAction={onAction}
              onSending={onSending}
            />
          ))}
        </ul>
      );
    return (
      <div className="space-y-4">
        <div className="max-w-sm">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
          />
        </div>
        <Tabs
          value={tab}
          onValueChange={(id) => setTab(id as StateFilter)}
          items={STATE_FILTERS.map((f) => ({
            id: f,
            label: t(`tabs.${f}`),
            content: f === tab ? cards : null,
          }))}
        />
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <Badge tone="warning">{tc('unofficial')}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            {meta && (
              <span
                className="text-sm text-muted-foreground"
                data-testid="cap-meter"
                aria-label={t('capLabel')}
              >
                {cap.limit !== null
                  ? t('capCount', { used: cap.used, limit: cap.limit })
                  : t('capUnlimited', { used: cap.used })}
              </span>
            )}
            <Button
              onClick={() => setDialog({ kind: 'wizard', device: null })}
              disabled={!canConnect || list.isPending}
            >
              {t('connect')}
            </Button>
          </div>
          {cap.full && cap.limit !== null && (
            <p className="text-xs text-muted-foreground" data-testid="cap-full">
              {t('capFull', { limit: cap.limit })}
            </p>
          )}
        </div>
      </header>

      <Alert tone="warning" data-testid="standing-reminder">
        <span>{tc('reminder')}</span>{' '}
        <Link href="/help/personal-whatsapp-connect" className="font-semibold underline">
          {tc('readGuide')}
        </Link>
      </Alert>

      {meta && !meta.noticeAccepted && items.length > 0 && canPair && (
        <Alert tone="info" data-testid="notice-changed">
          <div className="font-semibold">{t('noticeChanged.title')}</div>
          <div>{t('noticeChanged.body')}</div>
          <Link href="/devices/notice" className="mt-1 inline-block font-semibold underline">
            {t('noticeChanged.action')}
          </Link>
        </Alert>
      )}

      {meta && !meta.workerRunning && (
        <Alert tone="warning" data-testid="worker-down">
          {t('workerDown')}
        </Alert>
      )}

      {sendingError && <ErrorNotice error={sendingError} />}

      {body()}

      {dialog?.kind === 'wizard' && (
        <ConnectWizard
          existing={dialog.device}
          noticeVersion={meta?.noticeVersion ?? null}
          noticeAccepted={meta?.noticeAccepted ?? false}
          onClose={close}
        />
      )}
      {dialog?.kind === 'disconnect' && (
        <DisconnectDialog
          device={dialog.device}
          onClose={close}
          onDone={(r) => {
            close();
            toast(
              t(r.unlinked ? 'done.disconnected' : 'done.disconnectedNotUnlinked', {
                name: dialog.device.name,
              }),
              r.unlinked ? 'success' : 'info',
            );
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          device={dialog.device}
          onClose={close}
          onDone={() => {
            close();
            toast(t('done.deleted', { name: dialog.device.name }), 'success');
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          device={dialog.device}
          onClose={close}
          onDone={(name) => {
            close();
            toast(t('done.renamed', { name }), 'success');
          }}
        />
      )}
    </div>
  );
}
