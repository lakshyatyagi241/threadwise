'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { dangerActionResponseSchema, type DangerActionResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { DANGER_ACTIONS, endsCallersSession, phraseMatches, type DangerKind } from '../lib/danger';
import { operatorFetch } from '../operator-fetch';
import { SECURITY_NS } from './policy-form';

/**
 * The confirmation behind every danger action: the person reads what will happen, types the
 * action's name, and only then can the request be sent. The result (with the `affected` count)
 * stays on screen until they close it.
 */
export function DangerDialog({
  kind,
  onClose,
  onDone,
}: {
  kind: DangerKind | null;
  onClose: () => void;
  /** Called once after a successful action, with its result. */
  onDone: (result: DangerActionResponse) => void;
}) {
  const t = useTranslations(`${SECURITY_NS}.danger.dialog`);
  return (
    <Modal open={kind !== null} onClose={onClose} title={kind ? t(`${kind}.title`) : ''}>
      {kind && <DialogBody key={kind} kind={kind} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function DialogBody({
  kind,
  onClose,
  onDone,
}: {
  kind: DangerKind;
  onClose: () => void;
  onDone: (result: DangerActionResponse) => void;
}) {
  const t = useTranslations(`${SECURITY_NS}.danger.dialog`);
  const spec = DANGER_ACTIONS[kind];
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DangerActionResponse | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const matches = phraseMatches(typed, spec.phrase);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await operatorFetch(spec.path, {
        method: 'POST',
        schema: dangerActionResponseSchema,
      });
      setResult(res);
      onDone(res);
    } catch (err) {
      const api = err instanceof ApiError ? err : null;
      setError({
        message: api?.status === 403 ? t('errors.forbidden') : t('errors.unexpected'),
        requestId: api?.requestId,
      });
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <Alert tone="success" className="space-y-1">
          <p className="font-medium">{t(`${kind}.done`, { count: result.affected })}</p>
          {kind === 'rotate_webhook_secrets' && result.affected === 0 && (
            <p className="text-xs">{t('rotate_webhook_secrets.noneRotated')}</p>
          )}
          {endsCallersSession(kind) && <p className="text-xs">{t('revoke_sessions.signedOut')}</p>}
        </Alert>
        <div className="flex justify-end">
          <Button onClick={onClose} autoFocus>
            {endsCallersSession(kind) ? t('signInAgain') : t('close')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void run(e)} className="space-y-4">
      <p className="text-sm">{t(`${kind}.body`)}</p>
      <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        <li>{t(`${kind}.effect1`)}</li>
        <li>{t(`${kind}.effect2`)}</li>
      </ul>
      <Field
        label={t.rich('typeToConfirm', {
          phrase: spec.phrase,
          code: (chunks) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] font-semibold">
              {chunks}
            </code>
          ),
        })}
        htmlFor="danger-phrase"
        hint={t('phraseHint')}
      >
        <Input
          id="danger-phrase"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          className="font-mono"
        />
      </Field>
      {error && (
        <Alert tone="danger" className="space-y-1">
          <p>{error.message}</p>
          {error.requestId && (
            <p className="text-xs opacity-80">
              {t('requestId')}: <span className="font-mono">{error.requestId}</span>
            </p>
          )}
        </Alert>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          variant={kind === 'resume_sends' ? 'primary' : 'danger'}
          disabled={!matches || pending}
        >
          {pending && <Spinner label={t('working')} />}
          {pending ? t('working') : t(`${kind}.confirm`)}
        </Button>
      </div>
    </form>
  );
}
