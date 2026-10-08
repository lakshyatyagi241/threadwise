'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { WabaGroup } from '@crm/contracts';
import { Button, ConfirmDialog } from '@crm/ui';
import { useResetGroupLink } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { copyText, type GroupNotice } from './groups-model';

/**
 * The invite link of one group. No link yet is a real state, not an error: Meta issues it on a webhook moments after create. The link is
 * a bearer secret: shown in a left-to-right box (also in Arabic), copied on request, never put in a URL.
 */
export function InviteLinkPanel({
  number,
  group,
  canManage,
  onNotice,
}: {
  number: string;
  group: WabaGroup;
  canManage: boolean;
  onNotice: (n: GroupNotice) => void;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const errorText = useErrorText();
  const reset = useResetGroupLink(number);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    if (!group.inviteLink) return;
    if (!(await copyText(group.inviteLink))) {
      onNotice({ tone: 'warning', text: t('notice.copyFailed') });
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
        onNotice({ tone: 'success', text: t('notice.linkReset') });
      },
      onError: (err) => {
        setConfirm(false);
        const et = errorText(err);
        onNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
      },
    });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {group.awaitingInviteLink ? (
        <span className="text-sm text-muted-foreground">{t('link.awaiting')}</span>
      ) : (
        <>
          <code
            dir="ltr"
            aria-label={t('link.label')}
            className="max-w-full truncate rounded-md border border-border bg-muted px-2 py-1 text-xs"
          >
            {group.inviteLink}
          </code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? t('link.copied') : t('link.copy')}
          </Button>
        </>
      )}
      {canManage && (
        <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
          {t('link.newLink')}
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('confirm.linkTitle')}
        message={t('confirm.linkMessage')}
        confirmLabel={t('confirm.linkConfirm')}
        cancelLabel={t('confirm.cancel')}
        busy={reset.isPending}
        onConfirm={doReset}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
