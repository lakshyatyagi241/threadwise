'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Modal, Select, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, startFlowOnConversation } from '../api/flow-runtime';
import { useErrorText } from './parts';

export interface StartFlowDialogProps {
  open: boolean;
  onClose: () => void;
  /** The conversation (uuid) the flow starts on. */
  conversationId: string;
  /**
   * The flows to pick from. The caller supplies them: there is no session-authenticated "list flows" endpoint yet (the editor is
   * not ported), so this dialog cannot fetch the list itself.
   */
  flows: Array<{ id: string; name: string }>;
  onStarted?: (runId: string) => void;
}

/**
 * "Start flow" for an open conversation (the team inbox mounts it): pick a flow, start it. Needs `flr.runs.manage`; the
 * 404, 422 and 502 problems are shown with their own sentence. Must be rendered inside a `ToastProvider`.
 */
export function StartFlowDialog({
  open,
  onClose,
  conversationId,
  flows,
  onStarted,
}: StartFlowDialogProps) {
  const t = useTranslations('flr.start');
  const canManage = useCan('flr.runs.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errText = useErrorText();
  const [flowId, setFlowId] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!flowId) return;
    setBusy(true);
    try {
      const { runId } = await startFlowOnConversation(conversationId, flowId);
      toast(t('started'), 'success');
      void qc.invalidateQueries({ queryKey: KEYS.runs });
      onStarted?.(runId);
      setFlowId('');
      onClose();
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            disabled={!canManage || !flowId || busy}
            onClick={() => void start()}
          >
            {busy ? t('submitting') : t('submit')}
          </Button>
        </>
      }
    >
      {!canManage ? (
        <p className="text-sm text-muted-foreground">{t('denied')}</p>
      ) : flows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noFlows')}</p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-sm text-muted-foreground">{t('intro')}</span>
          <span className="sr-only">{t('flowLabel')}</span>
          <Select
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            aria-label={t('flowLabel')}
          >
            <option value="">{t('flowPlaceholder')}</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </label>
      )}
    </Modal>
  );
}
