'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Modal, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { hubKeys, suspendWorkspace, unsuspendWorkspace } from '../api';
import { suspendBody } from '../lib/query';
import { HubErrorLine } from './error-line';

/** Suspend or reactivate one workspace, with an optional reason that is kept with the change. */
export function SuspendDialog({
  workspace,
  mode,
  onClose,
}: {
  workspace: { workspaceId: string; name: string } | null;
  mode: 'suspend' | 'unsuspend';
  onClose: () => void;
}) {
  const t = useTranslations(`workspaces-hub.${mode}`);
  const tc = useTranslations('workspaces-hub.common');
  const toast = useToast();
  const qc = useQueryClient();
  const reasonId = useId();
  const [reason, setReason] = useState('');

  const run = useMutation({
    mutationFn: () => {
      const body = suspendBody(reason);
      return (mode === 'suspend' ? suspendWorkspace : unsuspendWorkspace)(
        workspace!.workspaceId,
        body,
      );
    },
    onSuccess: async () => {
      toast.success(t('done', { name: workspace?.name ?? '' }));
      await qc.invalidateQueries({ queryKey: hubKeys.all });
      close();
    },
  });

  const close = () => {
    setReason('');
    run.reset();
    onClose();
  };

  const name = workspace?.name ?? '';
  return (
    <Modal
      open={workspace !== null}
      onClose={() => {
        if (!run.isPending) close();
      }}
      title={t('title', { name })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={run.isPending}>
            {tc('cancel')}
          </Button>
          <Button
            variant={mode === 'suspend' ? 'danger' : 'primary'}
            data-testid="suspend-confirm"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('message')}</p>
        <Field label={t('reason')} htmlFor={reasonId}>
          <Textarea
            id={reasonId}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {run.isError && <HubErrorLine error={run.error} />}
      </div>
    </Modal>
  );
}
