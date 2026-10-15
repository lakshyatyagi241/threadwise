'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PersonalDeviceDetail } from '@crm/contracts';
import { Alert, Badge, Button, Field, Input, Spinner, Switch, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  PhoneField,
  type PhoneValue,
} from '@/features/auth-registration-security/shared/phone-field';
import { useDevice, useDevices, useUpdateDevice } from '../api/devices';
import { PERMISSIONS, formatWhen, type DevicePerms } from '../lib/format';
import { readDevicePhone } from '../lib/phone-model';
import { canDisconnect, canEditNumber, primaryAction } from '../lib/state-model';
import { nameProblem } from '../lib/wizard-model';
import { ConnectWizard } from './connect-wizard';
import { DeleteDialog, DisconnectDialog } from './device-dialogs';
import { HistoryImportCard } from './history-import-card';
import { ErrorNotice } from './error-notice';
import { ReasonText, StateBadge } from './state-badge';
import { useErrorText, type ErrorText } from './use-error-text';

const NS = 'whatsapp-devices-baileys';

type Dialog = 'wizard' | 'disconnect' | 'delete' | null;

/** `/devices/:id` (spec 13.2): status and reason, the edit form, disconnect and delete. No proxy section in phase 1. */
export function DeviceDetailScreen({ id }: { id: string }) {
  const t = useTranslations(`${NS}.detail`);
  const tl = useTranslations(`${NS}.list`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const router = useRouter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const detail = useDevice(id);
  // The meter and the notice standing come with the list; the wizard needs them to open at the right step.
  const list = useDevices();
  const perms: DevicePerms = {
    create: useCan(PERMISSIONS.create),
    pair: useCan(PERMISSIONS.pair),
    disconnect: useCan(PERMISSIONS.disconnect),
    delete: useCan(PERMISSIONS.delete),
  };
  const [dialog, setDialog] = useState<Dialog>(null);

  if (detail.isPending) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    const et = errorText(detail.error);
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <BackLink />
        <ErrorNotice error={et.code === 'NOT_FOUND' ? { ...et, text: t('notFound') } : et} />
        {et.code !== 'NOT_FOUND' && et.code !== 'WA_UNOFFICIAL_DISABLED' && (
          <Button variant="secondary" size="sm" onClick={() => detail.refetch()}>
            {tl('retry')}
          </Button>
        )}
      </div>
    );
  }

  const d = detail.data;
  const action = primaryAction(d.connectionState);
  const when = (iso: string | null) => formatWhen(iso, locale, timeZone);
  const close = () => setDialog(null);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <BackLink />
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{d.name}</h1>
          <Badge tone="warning">{tc('unofficial')}</Badge>
          <StateBadge state={d.connectionState} />
        </div>
        <div dir="ltr" className="text-sm text-muted-foreground [unicode-bidi:isolate]">
          {d.phone}
        </div>
      </header>

      <Alert tone="warning">
        <span>{tc('reminder')}</span>{' '}
        <Link href="/help/personal-whatsapp-connect" className="font-semibold underline">
          {tc('readGuide')}
        </Link>
      </Alert>

      <section className="space-y-3 rounded-md border border-border p-4" aria-label={t('status')}>
        <ReasonText reason={d.stateReason} className="text-sm" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('lastSeen')}</dt>
          <dd>{when(d.lastSeenAt) ?? tl('lastSeenNever')}</dd>
          <dt className="text-muted-foreground">{t('linkedSince')}</dt>
          <dd>{when(d.stateChangedAt) ?? '-'}</dd>
          {d.assignee && (
            <>
              <dt className="text-muted-foreground">{t('assignedTo')}</dt>
              <dd>{d.assignee.name}</dd>
            </>
          )}
          {d.createdBy && (
            <>
              <dt className="text-muted-foreground">{t('createdBy')}</dt>
              <dd>{d.createdBy.name}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          {action && perms.pair && (
            <Button size="sm" onClick={() => setDialog('wizard')}>
              {tl(`action.${action}`)}
            </Button>
          )}
          <Link
            href="/warmer"
            className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium underline"
          >
            {t('warmerLink')}
          </Link>
        </div>
      </section>

      <HistoryImportCard deviceId={d.id} canCancel={perms.pair} />

      <EditCard device={d} canEdit={perms.create} />

      {(perms.disconnect || perms.delete) && (
        <section
          className="space-y-3 rounded-md border border-border p-4"
          aria-label={t('dangerTitle')}
        >
          <h2 className="text-base font-semibold">{t('dangerTitle')}</h2>
          {perms.disconnect && canDisconnect(d.connectionState) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-md text-sm text-muted-foreground">{t('disconnectHelp')}</p>
              <Button variant="secondary" size="sm" onClick={() => setDialog('disconnect')}>
                {tl('action.disconnect')}
              </Button>
            </div>
          )}
          {perms.delete && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-md text-sm text-muted-foreground">{t('deleteHelp')}</p>
              <Button variant="danger" size="sm" onClick={() => setDialog('delete')}>
                {tl('action.delete')}
              </Button>
            </div>
          )}
        </section>
      )}

      {dialog === 'wizard' && (
        <ConnectWizard
          existing={d}
          noticeVersion={list.data?.meta.noticeVersion ?? null}
          noticeAccepted={list.data?.meta.noticeAccepted ?? false}
          historyFullAllowed={list.data?.meta.historyFullAllowed ?? false}
          onClose={close}
        />
      )}
      {dialog === 'disconnect' && (
        <DisconnectDialog
          device={d}
          onClose={close}
          onDone={(r) => {
            close();
            toast(
              tl(r.unlinked ? 'done.disconnected' : 'done.disconnectedNotUnlinked', {
                name: d.name,
              }),
              r.unlinked ? 'success' : 'info',
            );
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteDialog
          device={d}
          onClose={close}
          onDone={() => {
            toast(tl('done.deleted', { name: d.name }), 'success');
            router.push('/devices');
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  const t = useTranslations(`${NS}.detail`);
  return (
    <Link href="/devices" className="inline-block text-sm underline">
      {t('back')}
    </Link>
  );
}

/** Name, "use for sending" and, while no session exists, the number. Saves one PATCH with the row version. */
function EditCard({ device, canEdit }: { device: PersonalDeviceDetail; canEdit: boolean }) {
  const t = useTranslations(`${NS}.detail`);
  const tn = useTranslations(`${NS}.wizard.number`);
  const errorText = useErrorText();
  const update = useUpdateDevice();
  const [name, setName] = useState(device.name);
  const [active, setActive] = useState(device.active);
  const [phone, setPhone] = useState<PhoneValue | null>(null);
  const [error, setError] = useState<ErrorText | null>(null);
  const [saved, setSaved] = useState(false);

  const numberEditable = canEditNumber(device.connectionState) && !device.hasSession;
  const problem = nameProblem(name);
  const read = phone && !phone.empty ? readDevicePhone(phone.e164) : null;
  const phoneBad = phone !== null && !phone.empty && (!read || !read.ok);
  const changed =
    name.trim() !== device.name ||
    active !== device.active ||
    (read?.ok === true && read.e164 !== device.phone);

  const save = () => {
    if (problem || phoneBad || !changed) return;
    setError(null);
    setSaved(false);
    update.mutate(
      {
        id: device.id,
        input: {
          rowVersion: device.rowVersion,
          ...(name.trim() !== device.name ? { name: name.trim() } : {}),
          ...(active !== device.active ? { active } : {}),
          ...(read?.ok && numberEditable && read.e164 !== device.phone
            ? { countryCode: `+${read.callingCode}`, phone: read.nationalDigits }
            : {}),
        },
      },
      { onSuccess: () => setSaved(true), onError: (e) => setError(errorText(e)) },
    );
  };

  return (
    <section className="space-y-4 rounded-md border border-border p-4" aria-label={t('editTitle')}>
      <h2 className="text-base font-semibold">{t('editTitle')}</h2>
      <Field
        label={t('name')}
        htmlFor="wadev-edit-name"
        error={problem ? tn(`nameError.${problem}`) : undefined}
      >
        <Input
          id="wadev-edit-name"
          value={name}
          maxLength={191}
          disabled={!canEdit}
          invalid={problem !== null}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label={t('number')}
        htmlFor="wadev-edit-phone"
        hint={numberEditable ? undefined : t('numberLocked')}
        error={phoneBad ? tn('phoneError.invalid') : undefined}
      >
        {numberEditable && canEdit ? (
          <PhoneField
            id="wadev-edit-phone"
            initial={device.phone}
            onChange={setPhone}
            invalid={phoneBad}
          />
        ) : (
          <div dir="ltr" className="text-sm [unicode-bidi:isolate]" id="wadev-edit-phone">
            {device.phone}
          </div>
        )}
      </Field>
      <div className="flex items-center gap-2 text-sm">
        <Switch
          checked={active}
          onCheckedChange={setActive}
          label={t('sending')}
          disabled={!canEdit}
        />
        <span>{t('sending')}</span>
      </div>
      {error && <ErrorNotice error={error} />}
      {saved && !error && (
        <p role="status" className="text-sm text-success">
          {t('saved')}
        </p>
      )}
      {canEdit && (
        <Button
          size="sm"
          onClick={save}
          disabled={update.isPending || !changed || problem !== null || phoneBad}
        >
          {update.isPending && <Spinner />}
          {update.isPending ? t('saving') : t('save')}
        </Button>
      )}
    </section>
  );
}
