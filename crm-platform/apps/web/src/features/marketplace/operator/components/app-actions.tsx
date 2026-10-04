'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MarketOperatorApp } from '@crm/contracts';
import { Button, ConfirmDialog, Field, Input, Modal, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { deleteApp, killApp, marketKeys, runAppAction, type AppStatusAction } from '../api';
import { KILL_REASON_MAX, KILL_REASON_MIN, killCheck } from '../lib/confirmations';
import { marketError } from '../lib/errors';
import { appActions, type AppAction } from '../lib/lifecycle';
import { CATALOGUE_PATH } from '../lib/paths';
import type { MarketAccess } from '../lib/permissions';
import { ErrorLine, useErrorText } from './ui';

const NS = 'marketplace.operator.actions';

export type Notice =
  | { kind: 'killed'; name: string; disabledInstallations: number }
  | { kind: 'published'; name: string; version: string; upgraded: number; awaitingConsent: number };

type Confirming = 'hide' | 'unhide' | 'unkill' | 'delete' | 'kill';

/**
 * What the operator can do to the listing as a whole, by the lifecycle table and the caller's key: hide and show again (installations keep
 * working), the kill switch and its undo, and delete for a draft that was never published. Each one confirms; kill asks the most.
 */
export function AppActions({
  app,
  access,
  onNotice,
}: {
  app: MarketOperatorApp;
  access: MarketAccess;
  onNotice: (n: Notice) => void;
}) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const errorText = useErrorText();
  const [confirm, setConfirm] = useState<Confirming | null>(null);
  const available = appActions(app, access);
  const has = (a: AppAction) => available.includes(a);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: marketKeys.appAll(app.slug) });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.usage });
  };
  const failed = (e: unknown) => {
    toast.error(errorText(e).text);
    // The listing moved under us (someone else hid it, killed it, ...): show what it is now.
    if (['conflict', 'general'].includes(marketError(e).kind)) refresh();
  };

  const status = useMutation({
    mutationFn: (action: AppStatusAction) => runAppAction(app.slug, action),
    onSuccess: (_a, action) => {
      toast.success(t(`done.${action}`, { name: app.name }));
      setConfirm(null);
      refresh();
    },
    onError: (e) => {
      setConfirm(null);
      failed(e);
    },
  });
  const kill = useMutation({
    mutationFn: (reason: string) => killApp(app.slug, reason),
    onSuccess: (r) => {
      toast.success(t('done.kill', { name: app.name }));
      setConfirm(null);
      onNotice({
        kind: 'killed',
        name: app.name,
        disabledInstallations: r.disabledInstallations,
      });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteApp(app.slug),
    onSuccess: () => {
      toast.success(t('done.delete', { name: app.name }));
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
      void qc.removeQueries({ queryKey: marketKeys.appAll(app.slug) });
      router.push(CATALOGUE_PATH);
    },
    onError: (e) => {
      setConfirm(null);
      failed(e);
    },
  });

  if (available.filter((a) => a !== 'editListing' && a !== 'newVersion').length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {has('hide') && (
          <Button
            variant="secondary"
            disabled={status.isPending}
            onClick={() => setConfirm('hide')}
          >
            {t('hide')}
          </Button>
        )}
        {has('unhide') && (
          <Button
            variant="secondary"
            disabled={status.isPending}
            onClick={() => setConfirm('unhide')}
          >
            {t('unhide')}
          </Button>
        )}
        {has('unkill') && (
          <Button
            variant="secondary"
            disabled={status.isPending}
            onClick={() => setConfirm('unkill')}
          >
            {t('unkill')}
          </Button>
        )}
        {has('delete') && (
          <Button
            variant="secondary"
            className="text-danger"
            disabled={remove.isPending}
            onClick={() => setConfirm('delete')}
          >
            {t('delete')}
          </Button>
        )}
        {has('kill') && (
          <Button variant="danger" onClick={() => setConfirm('kill')}>
            {t('kill')}
          </Button>
        )}
      </div>

      {(confirm === 'hide' || confirm === 'unhide' || confirm === 'unkill') && (
        <ConfirmDialog
          open
          title={t(`confirm.${confirm}.title`, { name: app.name })}
          message={<p>{t(`confirm.${confirm}.body`, { name: app.name })}</p>}
          confirmLabel={t(`confirm.${confirm}.action`)}
          cancelLabel={t('cancel')}
          busy={status.isPending}
          onConfirm={() => status.mutate(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          open
          title={t('confirm.delete.title', { name: app.name })}
          message={<p>{t('confirm.delete.body', { name: app.name })}</p>}
          confirmLabel={t('confirm.delete.action')}
          cancelLabel={t('cancel')}
          tone="danger"
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'kill' && (
        <KillDialog
          app={app}
          busy={kill.isPending}
          error={kill.error}
          onConfirm={(reason) => kill.mutate(reason)}
          onClose={() => {
            kill.reset();
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}

/**
 * THE KILL SWITCH confirmation. It names the app and how many workspaces have it installed, says exactly what happens, and keeps the red
 * button off until the operator has written a reason (5 to 300 characters) and typed the listing's slug.
 */
export function KillDialog({
  app,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  app: Pick<MarketOperatorApp, 'slug' | 'name' | 'installCount'>;
  busy?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('marketplace.operator.killDialog');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const check = killCheck(app.slug, typed, reason);
  const reasonId = 'kill-reason';
  const slugId = 'kill-slug';

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title', { name: app.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!check.canKill || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy && <Spinner />}
            {t('confirm', { name: app.name })}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="font-medium">{t('installs', { name: app.name, count: app.installCount })}</p>
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          <li>{t('effects.stop')}</li>
          <li>{t('effects.connections')}</li>
          <li>{t('effects.address')}</li>
          <li>{t('effects.uninstall')}</li>
        </ul>
        <p className="text-muted-foreground">{t('undo')}</p>

        <Field
          label={t('reason')}
          htmlFor={reasonId}
          hint={t('reasonHint', { min: KILL_REASON_MIN, max: KILL_REASON_MAX })}
        >
          <Textarea
            id={reasonId}
            rows={3}
            value={reason}
            invalid={check.reason.tooLong}
            aria-describedby={`${reasonId}-count`}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <p
          id={`${reasonId}-count`}
          className={`text-xs tabular-nums ${check.reason.ok ? 'text-muted-foreground' : 'text-danger'}`}
          aria-live="polite"
        >
          {t('count', { count: check.reason.length, min: KILL_REASON_MIN, max: KILL_REASON_MAX })}
        </p>

        <Field label={t('typeSlug', { slug: app.slug })} htmlFor={slugId} hint={t('typeSlugHint')}>
          <Input
            id={slugId}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            invalid={typed.trim() !== '' && !check.slugMatches}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>

        <ErrorLine error={error} />
      </div>
    </Modal>
  );
}
