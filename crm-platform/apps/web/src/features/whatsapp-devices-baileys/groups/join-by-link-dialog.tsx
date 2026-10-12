'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  WA_GROUP_INVITE_URL_PREFIX,
  parseWaGroupInviteCode,
  type WaDeviceGroupJoinPreview,
} from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal } from '@crm/ui';
import { useWaJoinByLink, useWaJoinPreview } from '../api/groups-hooks';
import { useGroupsCtx } from './groups-context';

/**
 * Joins a group from a `chat.whatsapp.com` link. The highest ban risk of every group action (WhatsApp watches automated joins), so it
 * has its own small daily cap, is off unless the platform enables it (the tab only offers this when the API says so), and needs the
 * risk box ticked. "Look up" asks WhatsApp what the link points at first and also counts toward the cap.
 */
export function JoinByLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('whatsapp-devices-baileys.groups.join');
  const tc = useTranslations('whatsapp-devices-baileys.groups');
  const { device, online, waitSeconds, notify, fail } = useGroupsCtx();
  const preview = useWaJoinPreview(device.id);
  const join = useWaJoinByLink(device.id);
  const [invite, setInvite] = useState('');
  const [ack, setAck] = useState(false);
  const [seen, setSeen] = useState<{ code: string; data: WaDeviceGroupJoinPreview } | null>(null);
  const id = useId();

  const code = parseWaGroupInviteCode(invite);
  const typed = invite.trim().length > 0;
  const blocked = !online || waitSeconds > 0;
  const preview_ok = seen !== null && seen.code === code;

  const close = () => {
    setInvite('');
    setAck(false);
    setSeen(null);
    preview.reset();
    join.reset();
    onClose();
  };

  const lookUp = () => {
    if (!code || blocked || preview.isPending) return;
    preview.mutate(invite.trim(), {
      onSuccess: (data) => setSeen({ code, data }),
      onError: fail,
    });
  };

  const doJoin = () => {
    if (!code || !ack || blocked || join.isPending) return;
    join.mutate(invite.trim(), {
      onSuccess: (r) => {
        notify({
          tone: 'success',
          text: r.status === 'joined' ? t('joined') : t('requested'),
        });
        close();
      },
      onError: fail,
    });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {tc('cancel')}
          </Button>
          <Button
            variant="secondary"
            disabled={!code || blocked || preview.isPending}
            onClick={lookUp}
          >
            {preview.isPending ? t('lookingUp') : t('lookUp')}
          </Button>
          <Button disabled={!code || !ack || blocked || join.isPending} onClick={doJoin}>
            {join.isPending ? t('joining') : t('submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert tone="warning" data-testid="groups-join-risk">
          {t('risk')}
        </Alert>
        <Field label={t('invite')} htmlFor={`${id}-invite`} hint={t('inviteHint')}>
          <Input
            id={`${id}-invite`}
            dir="ltr"
            value={invite}
            placeholder={`${WA_GROUP_INVITE_URL_PREFIX}…`}
            onChange={(e) => {
              setInvite(e.target.value);
              setSeen(null);
            }}
          />
        </Field>
        {typed && !code && (
          <p className="text-xs text-danger" data-testid="groups-join-invalid">
            {t('invalid')}
          </p>
        )}
        {preview_ok && seen && (
          <div
            className="rounded-md border border-border bg-muted/40 p-3 text-sm"
            data-testid="groups-join-preview"
          >
            <p className="font-medium" dir="auto">
              {seen.data.subject ?? tc('untitled')}
            </p>
            {seen.data.size !== null && (
              <p className="text-xs text-muted-foreground">
                {tc('memberCount', { count: seen.data.size })}
              </p>
            )}
            {seen.data.alreadyMember && (
              <p className="mt-1 text-xs text-warning">{t('alreadyMember')}</p>
            )}
            {seen.data.approvalRequired && !seen.data.alreadyMember && (
              <p className="mt-1 text-xs text-muted-foreground">{t('approvalRequired')}</p>
            )}
          </div>
        )}
        <Checkbox
          id={`${id}-ack`}
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          label={t('acknowledge')}
        />
        {!online && <p className="text-xs text-muted-foreground">{t('offline')}</p>}
      </div>
    </Modal>
  );
}
