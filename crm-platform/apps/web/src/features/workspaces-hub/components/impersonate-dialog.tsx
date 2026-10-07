'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { IMPERSONATION_MAX_MINUTES, type StartImpersonationResponse } from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Modal, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { impersonateOwner } from '../api';
import { MIN_IMPERSONATION_REASON as MIN_REASON, impersonationDraft } from '../lib/query';
import { HubErrorLine } from './error-line';

/** "Login as Owner": a reason (kept in the audit trail), an optional read-only session, then the workspace opens in a new tab. */
export function ImpersonateDialog({
  workspace,
  onClose,
}: {
  workspace: { workspaceId: string; name: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-hub.impersonate');
  const tc = useTranslations('workspaces-hub.common');
  const toast = useToast();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [touched, setTouched] = useState(false);
  const [blocked, setBlocked] = useState<StartImpersonationResponse | null>(null);

  const draft = impersonationDraft(reason, readOnly);
  const reasonInvalid = draft === null;

  const run = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('invalid');
      return impersonateOwner(workspace!.workspaceId, draft);
    },
    onSuccess: (r) => {
      const tab = window.open(r.handoffUrl, '_blank');
      if (!tab) {
        // The handoff code is one-time: keep the link on screen instead of asking for a second one.
        setBlocked(r);
        return;
      }
      tab.opener = null;
      toast.success(t('opened', { name: r.workspaceName }));
      close();
    },
  });

  const close = () => {
    setReason('');
    setReadOnly(false);
    setTouched(false);
    setBlocked(null);
    run.reset();
    onClose();
  };

  return (
    <Modal
      open={workspace !== null}
      onClose={() => {
        if (!run.isPending) close();
      }}
      title={t('title', { name: workspace?.name ?? '' })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={run.isPending}>
            {tc('cancel')}
          </Button>
          {!blocked && (
            <Button
              data-testid="impersonate-submit"
              disabled={run.isPending}
              onClick={() => {
                setTouched(true);
                if (!reasonInvalid) run.mutate();
              }}
            >
              {run.isPending && <Spinner />}
              {t('submit')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('help', { minutes: IMPERSONATION_MAX_MINUTES })}
        </p>
        <Field
          label={t('reason')}
          htmlFor={reasonId}
          hint={t('reasonHint', { min: MIN_REASON })}
          error={touched && reasonInvalid ? t('reasonShort', { min: MIN_REASON }) : undefined}
        >
          <Textarea
            id={reasonId}
            value={reason}
            rows={3}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={touched && reasonInvalid ? true : undefined}
          />
        </Field>
        <div className="space-y-1">
          <Checkbox
            label={t('readOnly')}
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
          />
          <p className="ps-6 text-xs text-muted-foreground">{t('readOnlyHint')}</p>
        </div>
        {blocked && (
          <Alert tone="warning" className="space-y-2">
            <p>{t('popupBlocked')}</p>
            <a
              href={blocked.handoffUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              {t('submit')}
            </a>
          </Alert>
        )}
        {run.isError && <HubErrorLine error={run.error} />}
      </div>
    </Modal>
  );
}
