'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Modal, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, requestPermission, useCallEligibility } from '../api/calling';
import { CallError, digitsOf, isPermissionRequested } from '../lib/calls';
import { useCalling } from './calling-provider';
import { useErrorText } from './use-error-text';
import { PhoneIcon } from './icons';

export interface CallButtonProps {
  conversationId: string;
  /** Shown in the on-call panel; the number when empty. */
  displayName?: string;
  contactId?: string;
}

/**
 * The green Call button of the conversation header (WD-CALL-007). Hidden unless calling is on for the conversation's number
 * and the customer has a phone number. Without a usable permission a dialog offers "Call anyway" (works if the customer
 * already tapped Allow) or "Ask permission" (sends the request, places no call).
 */
export function CallButton({ conversationId, displayName, contactId }: CallButtonProps) {
  const t = useTranslations('calling-voice');
  const { toast } = useToast();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const canUse = useCan('call.calls.use');
  const { startOutboundCall } = useCalling();
  const eligibility = useCallEligibility(conversationId, canUse);
  const [ask, setAsk] = useState(false);
  const [working, setWorking] = useState(false);

  const e = eligibility.data;
  if (!canUse || !e?.enabled || !e.contactPhone) return null;

  const to = digitsOf(e.contactPhone);

  const place = async () => {
    if (!e.numberId) {
      toast(t('toast.noNumber'), 'danger');
      return;
    }
    try {
      await startOutboundCall({ numberId: e.numberId, to, contactId, conversationId, displayName });
    } catch (err) {
      if (isPermissionRequested(err)) {
        // The server sent a permission request instead of placing the call.
        toast(t('toast.permissionSent'), 'info');
        void qc.invalidateQueries({ queryKey: KEYS.eligibility(conversationId) });
      } else if (err instanceof CallError) toast(errorText(err), 'danger');
      else toast(t('toast.startFailed', { message: errorText(err) }), 'danger');
    }
  };

  const onClick = () => {
    if (!to) {
      toast(t('toast.noPhone'), 'danger');
      return;
    }
    if (!e.numberId) {
      toast(t('toast.noNumber'), 'danger');
      return;
    }
    if (!e.usable) {
      setAsk(true);
      return;
    }
    void place();
  };

  const askPermission = async () => {
    setAsk(false);
    if (!e.numberId) return;
    setWorking(true);
    try {
      const r = await requestPermission({ numberId: e.numberId, to });
      if (r.alreadyPermitted) {
        toast(t('toast.alreadyPermitted'), 'success');
        await place();
      } else {
        toast(t('toast.permissionSent'), 'success');
        void qc.invalidateQueries({ queryKey: KEYS.eligibility(conversationId) });
      }
    } catch (err) {
      toast(t('toast.permissionFailed', { message: errorText(err) }), 'danger');
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Button
        variant="brand"
        size="sm"
        className="rounded-full bg-success text-background"
        title={t('button.tooltip')}
        disabled={working}
        onClick={onClick}
      >
        <PhoneIcon className="size-3.5" />
        {working ? t('button.working') : t('button.label')}
      </Button>
      <Modal
        open={ask}
        onClose={() => setAsk(false)}
        title={t('confirm.title')}
        closeLabel={t('confirm.close')}
        footer={
          <>
            <Button variant="secondary" onClick={() => void askPermission()}>
              {t('confirm.askPermission')}
            </Button>
            <Button
              variant="brand"
              onClick={() => {
                setAsk(false);
                void place();
              }}
            >
              {t('confirm.callAnyway')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('confirm.body')}</p>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">{t('confirm.callAnyway')}</strong> -{' '}
            {t('confirm.callAnywayHint')}
          </li>
          <li>
            <strong className="text-foreground">{t('confirm.askPermission')}</strong> -{' '}
            {t('confirm.askPermissionHint')}
          </li>
        </ul>
      </Modal>
    </>
  );
}
