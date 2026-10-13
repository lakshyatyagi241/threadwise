'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { WaDeviceGroup } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Spinner } from '@crm/ui';
import { useResetWaInviteLink, useWaGroupInviteLink } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { useGroupsCtx } from './groups-context';
import { copyText, rowAccess } from './groups-model';

/**
 * The invite link of one group, shown only when the person opens it. It is a bearer secret (anyone with it can join): read when the
 * panel opens and never cached, shown in a left-to-right box (also in Arabic), copied on request, never put in a URL. A new link
 * ends the old one, so it asks first.
 */
export function InviteLinkPanel({ group }: { group: WaDeviceGroup }) {
  const t = useTranslations('whatsapp-devices-baileys.groups.link');
  const tc = useTranslations('whatsapp-devices-baileys.groups');
  const errorText = useErrorText();
  const { device, online, perms, waitSeconds, notify, fail } = useGroupsCtx();
  const access = rowAccess(group, perms, online);
  const [open, setOpen] = useState(false);
  const link = useWaGroupInviteLink(device.id, group.id, open && access.canAdminister);
  const reset = useResetWaInviteLink(device.id);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!perms.manage || group.left) return null;

  const copy = async (url: string) => {
    if (!(await copyText(url))) {
      notify({ tone: 'warning', text: t('copyFailed') });
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  const doReset = () =>
    reset.mutate(group.id, {
      onSuccess: () => {
        setConfirm(false);
        notify({ tone: 'success', text: t('reset') });
      },
      onError: (err) => {
        setConfirm(false);
        fail(err);
      },
    });

  return (
    <div className="mt-3" data-testid="groups-invite-panel">
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={!access.canAdminister}
        title={access.blockedBy ? tc(`blocked.${access.blockedBy}`) : undefined}
      >
        {open ? t('hide') : t('show')}
      </Button>
      {open && access.canAdminister && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {link.isPending ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('loading')}
            </span>
          ) : link.isError ? (
            <Alert tone="danger">{errorText(link.error).text}</Alert>
          ) : (
            <>
              <code
                dir="ltr"
                aria-label={t('label')}
                className="max-w-full truncate rounded-md border border-border bg-muted px-2 py-1 text-xs"
              >
                {link.data.url}
              </code>
              <Button variant="secondary" size="sm" onClick={() => void copy(link.data.url)}>
                {copied ? t('copied') : t('copy')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={waitSeconds > 0 || reset.isPending}
                onClick={() => setConfirm(true)}
              >
                {t('newLink')}
              </Button>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('confirmTitle')}
        message={t('confirmMessage')}
        confirmLabel={t('confirmButton')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={reset.isPending}
        onConfirm={doReset}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
