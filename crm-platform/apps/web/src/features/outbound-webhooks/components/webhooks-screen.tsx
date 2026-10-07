'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { WEBHOOK_ALL, type WebhookResponse } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Spinner,
  Switch,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refresh, useWebhooks, webhooksApi } from '../api/webhooks';
import { healthOf, shortUrl } from '../lib/model';
import { DeliveriesDialog } from './deliveries-dialog';
import { WebhookDialog } from './webhook-dialog';

/** `/webhooks` (Settings > Integrations): the endpoints that receive this workspace's events, their health and their delivery log. */
export function WebhooksScreen() {
  const t = useTranslations('outbound-webhooks.page');
  const canRead = useCan('webhooks.read');
  const canManage = useCan('webhooks.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useWebhooks(canRead);
  const [editing, setEditing] = useState<WebhookResponse | 'new' | null>(null);
  const [deleting, setDeleting] = useState<WebhookResponse | null>(null);
  const [viewing, setViewing] = useState<WebhookResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = q.data?.data ?? [];
  const events = q.data?.availableEvents ?? [];

  async function toggle(w: WebhookResponse, active: boolean) {
    setBusy(w.id);
    try {
      await webhooksApi.update(w.id, { active });
      await refresh(qc);
    } catch {
      toast(t('toggleFailed'), 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function test(w: WebhookResponse) {
    setBusy(w.id);
    try {
      const { delivery } = await webhooksApi.test(w.id);
      const ok =
        delivery.statusCode !== null && delivery.statusCode >= 200 && delivery.statusCode < 300;
      toast(
        ok
          ? t('testOk', { status: delivery.statusCode ?? 0 })
          : t('testFailed', { reason: delivery.error ?? t('noAnswer') }),
        ok ? 'success' : 'danger',
      );
      await refresh(qc);
    } catch {
      toast(t('testError'), 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function remove(w: WebhookResponse) {
    setBusy(w.id);
    try {
      await webhooksApi.remove(w.id);
      toast(t('deleted'), 'success');
      setDeleting(null);
      await refresh(qc);
    } catch {
      toast(t('deleteFailed'), 'danger');
    } finally {
      setBusy(null);
    }
  }

  if (!canRead) {
    return (
      <section className="mx-auto max-w-4xl">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/integrations"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {t('back')}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage && <Button onClick={() => setEditing('new')}>{t('add')}</Button>}
      </header>

      {q.isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : q.isError ? (
        <Alert tone="danger">
          {t('loadFailed')}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void q.refetch()}
          >
            {t('retry')}
          </button>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('empty')}
          actions={
            canManage ? <Button onClick={() => setEditing('new')}>{t('add')}</Button> : undefined
          }
        />
      ) : (
        <ul className="space-y-3" aria-label={t('list')}>
          {rows.map((w) => (
            <Row
              key={w.id}
              w={w}
              busy={busy === w.id}
              canManage={canManage}
              onToggle={(on) => void toggle(w, on)}
              onTest={() => void test(w)}
              onEdit={() => setEditing(w)}
              onDelete={() => setDeleting(w)}
              onDeliveries={() => setViewing(w)}
            />
          ))}
        </ul>
      )}

      <WebhookDialog
        open={editing !== null}
        webhook={editing === 'new' || editing === null ? undefined : editing}
        events={events}
        onClose={() => setEditing(null)}
        onSaved={(_saved, created) => {
          toast(created ? t('created') : t('saved'), 'success');
          void refresh(qc);
        }}
      />
      <DeliveriesDialog webhook={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: deleting?.name || deleting?.url || '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        busy={deleting !== null && busy === deleting.id}
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function Row({
  w,
  busy,
  canManage,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  onDeliveries,
}: {
  w: WebhookResponse;
  busy: boolean;
  canManage: boolean;
  onToggle: (on: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeliveries: () => void;
}) {
  const t = useTranslations('outbound-webhooks.page');
  const te = useTranslations('outbound-webhooks.events');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const health = healthOf(w);
  const all = w.events.includes(WEBHOOK_ALL);
  return (
    <li className="space-y-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{w.name || shortUrl(w.url)}</h2>
            <Badge
              tone={
                health === 'failing'
                  ? 'danger'
                  : health === 'healthy'
                    ? 'success'
                    : health === 'off'
                      ? 'neutral'
                      : 'warning'
              }
            >
              {t(`health.${health}`)}
            </Badge>
            {w.hasSecret && <Badge tone="neutral">{t('signed')}</Badge>}
          </div>
          <p
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
            dir="ltr"
            title={w.url}
          >
            {shortUrl(w.url)}
          </p>
        </div>
        {canManage && (
          <Switch
            checked={w.active}
            onCheckedChange={onToggle}
            disabled={busy}
            label={t('activeFor', { name: w.name || shortUrl(w.url) })}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {all ? (
          <Badge>{t('allEvents')}</Badge>
        ) : (
          w.events.map((ev) => <Badge key={ev}>{te(ev)}</Badge>)
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {w.lastFiredAt
            ? t('lastDelivery', {
                when: new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                }).format(new Date(w.lastFiredAt)),
                status: w.lastStatusCode ?? t('noAnswer'),
              })
            : t('noDeliveries')}
          {' · '}
          {t('counts', { ok: w.successCount, failed: w.failureCount })}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onDeliveries}>
            {t('deliveries')}
          </Button>
          {canManage && (
            <>
              <Button variant="secondary" size="sm" onClick={onTest} disabled={busy}>
                {busy && <Spinner />}
                {t('test')}
              </Button>
              <Button variant="secondary" size="sm" onClick={onEdit}>
                {t('edit')}
              </Button>
              <Button variant="secondary" size="sm" onClick={onDelete}>
                {t('delete')}
              </Button>
            </>
          )}
        </span>
      </div>
      {w.isFailing && w.lastError && (
        <p role="status" className="text-xs text-danger">
          {t('lastError', { error: w.lastError })}
        </p>
      )}
    </li>
  );
}
