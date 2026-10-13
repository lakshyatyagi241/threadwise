'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import type { SecretTarget } from '../lib/social-draft';

const NS = 'auth-registration-security.platform.social.removeSecret';

/**
 * "Remove saved secret": a secret is write-only, so the only way to take one out is to ask the API
 * to delete it. It sits behind a confirmation because the provider stops working until a new one is saved.
 */
export function RemoveSecret({
  target,
  live,
  onRemove,
}: {
  target: SecretTarget;
  /** The provider is working right now, so removing its secret switches it off. */
  live: boolean;
  onRemove: (target: SecretTarget) => Promise<void>;
}) {
  const t = useTranslations(NS);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ requestId?: string } | null>(null);
  const name = t(`names.${target}`);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
  };

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onRemove(target);
      setOpen(false);
    } catch (err) {
      setError({ requestId: err instanceof ApiError ? err.requestId : undefined });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-danger hover:bg-danger/10"
        onClick={() => setOpen(true)}
      >
        {t('action')}
        <span className="sr-only"> {name}</span>
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t('title', { name })}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              {t('cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={pending}>
              {pending && <Spinner label={t('working')} />}
              {pending ? t('working') : t('confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{t('body', { name })}</p>
          {live && <Alert tone="warning">{t('liveWarning', { name })}</Alert>}
          {error && (
            <Alert tone="danger" className="space-y-1">
              <p>{t('error')}</p>
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
}
