'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PersonalDevice } from '@crm/contracts';
import { Button, ConfirmDialog, Field, Input, Modal, Spinner } from '@crm/ui';
import { useDeleteDevice, useDisconnectDevice, useUpdateDevice } from '../api/devices';
import { nameProblem } from '../lib/wizard-model';
import { ErrorNotice } from './error-notice';
import { useErrorText, type ErrorText } from './use-error-text';

const NS = 'whatsapp-devices-baileys';

/** Disconnect: unlinks the number and removes its saved session (spec 10.2). The answer says whether the phone was unlinked too. */
export function DisconnectDialog({
  device,
  onClose,
  onDone,
}: {
  device: PersonalDevice;
  onClose: () => void;
  onDone: (result: { unlinked: boolean }) => void;
}) {
  const t = useTranslations(`${NS}.dialog.disconnect`);
  const tc = useTranslations(`${NS}.dialog`);
  const errorText = useErrorText();
  const disconnect = useDisconnectDevice();
  const [error, setError] = useState<ErrorText | null>(null);
  return (
    <ConfirmDialog
      open
      title={t('title', { name: device.name })}
      message={
        <div className="space-y-2">
          <p>{t('message')}</p>
          {error && <ErrorNotice error={error} />}
        </div>
      }
      confirmLabel={t('confirm')}
      cancelLabel={tc('cancel')}
      tone="danger"
      busy={disconnect.isPending}
      onClose={onClose}
      onConfirm={() =>
        disconnect.mutate(device.id, {
          onSuccess: (r) => onDone({ unlinked: r.unlinked }),
          onError: (e) => setError(errorText(e)),
        })
      }
    />
  );
}

/** Delete: explains that the chats stay in the inbox (spec 13.2). Cannot be undone. */
export function DeleteDialog({
  device,
  onClose,
  onDone,
}: {
  device: PersonalDevice;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations(`${NS}.dialog.delete`);
  const tc = useTranslations(`${NS}.dialog`);
  const errorText = useErrorText();
  const remove = useDeleteDevice();
  const [error, setError] = useState<ErrorText | null>(null);
  return (
    <ConfirmDialog
      open
      title={t('title', { name: device.name })}
      message={
        <div className="space-y-2">
          <p>{t('message')}</p>
          {error && <ErrorNotice error={error} />}
        </div>
      }
      confirmLabel={t('confirm')}
      cancelLabel={tc('cancel')}
      tone="danger"
      busy={remove.isPending}
      onClose={onClose}
      onConfirm={() =>
        remove.mutate(device.id, {
          onSuccess: () => onDone(),
          onError: (e) => setError(errorText(e)),
        })
      }
    />
  );
}

/** Rename: the name is the only thing every state may change (the number is locked while a session exists). */
export function RenameDialog({
  device,
  onClose,
  onDone,
}: {
  device: PersonalDevice;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const t = useTranslations(`${NS}.dialog.rename`);
  const tn = useTranslations(`${NS}.wizard.number.nameError`);
  const tc = useTranslations(`${NS}.dialog`);
  const errorText = useErrorText();
  const update = useUpdateDevice();
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<ErrorText | null>(null);
  const problem = nameProblem(name);
  const submit = () => {
    if (problem) return;
    update.mutate(
      { id: device.id, input: { name: name.trim(), rowVersion: device.rowVersion } },
      { onSuccess: (d) => onDone(d.name), onError: (e) => setError(errorText(e)) },
    );
  };
  return (
    <Modal
      open
      onClose={() => {
        if (!update.isPending) onClose();
      }}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} disabled={update.isPending || problem !== null}>
            {update.isPending && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('label')} htmlFor="wadev-rename" error={problem ? tn(problem) : undefined}>
          <Input
            id="wadev-rename"
            value={name}
            maxLength={191}
            invalid={problem !== null}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        {error && <ErrorNotice error={error} />}
      </form>
    </Modal>
  );
}
