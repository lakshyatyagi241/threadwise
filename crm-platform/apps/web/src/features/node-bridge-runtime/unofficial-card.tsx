'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unofficialWhatsappStateSchema, type NodeBridgeResponse } from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { ENABLE_PHRASE, phraseOk, unofficialView } from './lib/unofficial';
import { NODE_BRIDGE_QUERY_KEY } from './queries';

const NS = 'node-bridge-runtime.unofficial';

/**
 * The platform switch for the unofficial WhatsApp engine, at the top of the Node bridge page. Off is the supported state and the
 * default: workspaces see nothing of it. Turning it ON asks for a typed word (it is unsupported and can get numbers banned); turning
 * it OFF asks for a confirmation (workspaces stop being offered personal numbers and sends through them are refused).
 */
export function UnofficialCard({ data, canEdit }: { data: NodeBridgeResponse; canEdit: boolean }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const id = useId();
  const [dialog, setDialog] = useState<'enable' | 'disable' | null>(null);
  const [typed, setTyped] = useState('');
  const view = unofficialView(data.unofficialEnabled);

  function close() {
    setDialog(null);
    setTyped('');
  }

  const change = useMutation({
    mutationFn: (enabled: boolean) =>
      operatorFetch('/node-bridge/unofficial', {
        method: 'PUT',
        body: { enabled },
        schema: unofficialWhatsappStateSchema,
      }),
    onSuccess: async (state) => {
      toast.success(t(state.unofficialEnabled ? 'enabledToast' : 'disabledToast'));
      close();
      await qc.invalidateQueries({ queryKey: NODE_BRIDGE_QUERY_KEY });
      // The console menu badge is drawn by the server layout.
      router.refresh();
    },
    onError: (err) => toast.error(t(`errors.${errorKind(err)}`)),
  });

  return (
    <Card className="space-y-4 border-2" data-testid="unofficial-card" data-state={view.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('eyebrow')}
          </p>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <Badge tone={view.tone} data-testid="unofficial-status">
          {t(`status.${view.status}`)}
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('explanation')}</p>
      <p className="max-w-3xl text-sm">{t(`state.${view.status}`)}</p>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={view.next ? 'danger' : 'secondary'}
            disabled={change.isPending}
            onClick={() => setDialog(view.next ? 'enable' : 'disable')}
            data-testid="unofficial-toggle"
          >
            {t(view.next ? 'enable' : 'disable')}
          </Button>
        </div>
      )}

      <Modal
        open={dialog === 'enable'}
        onClose={() => {
          if (!change.isPending) close();
        }}
        title={t('enableDialog.title')}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={change.isPending}>
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!phraseOk(typed) || change.isPending}
              onClick={() => change.mutate(true)}
              data-testid="unofficial-enable-confirm"
            >
              {t('enableDialog.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t('enableDialog.body')}</p>
          <Field
            label={t('enableDialog.typeLabel', { word: ENABLE_PHRASE })}
            htmlFor={`${id}-confirm`}
          >
            <Input
              id={`${id}-confirm`}
              value={typed}
              dir="ltr"
              autoComplete="off"
              className="font-mono"
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
      <ConfirmDialog
        open={dialog === 'disable'}
        title={t('disableDialog.title')}
        message={t('disableDialog.body')}
        confirmLabel={t('disableDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={change.isPending}
        onConfirm={() => change.mutate(false)}
        onClose={close}
      />
    </Card>
  );
}
