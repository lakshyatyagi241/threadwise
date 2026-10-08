'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import type { WebhookResponse } from '@crm/contracts';
import { Alert, Badge, Modal, Spinner } from '@crm/ui';
import { useDeliveries } from '../api/webhooks';

/** The last deliveries of one endpoint: what was sent, what the server answered, how long it took, and why a try failed. */
export function DeliveriesDialog({
  webhook,
  onClose,
}: {
  webhook: WebhookResponse | null;
  onClose: () => void;
}) {
  const t = useTranslations('outbound-webhooks.deliveries');
  const te = useTranslations('outbound-webhooks.events');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const q = useDeliveries(webhook?.id ?? null);
  const rows = q.data?.data ?? [];
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone }).format(
      new Date(iso),
    );
  return (
    <Modal
      open={webhook !== null}
      onClose={onClose}
      size="lg"
      title={t('title', { name: webhook?.name || webhook?.url || '' })}
      closeLabel={t('close')}
    >
      {q.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : q.isError ? (
        <Alert tone="danger">{t('failed')}</Alert>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-start text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-start font-normal">{t('when')}</th>
                <th className="px-2 py-2 text-start font-normal">{t('event')}</th>
                <th className="px-2 py-2 text-start font-normal">{t('result')}</th>
                <th className="px-2 py-2 text-end font-normal">{t('time')}</th>
                <th className="px-2 py-2 text-end font-normal">{t('attempt')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((d) => {
                const ok = d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 300;
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums">{when(d.firedAt)}</td>
                    <td className="px-2 py-2">
                      {d.event === 'test_fire' ? t('test') : safeEvent(te, d.event)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={ok ? 'success' : 'danger'} title={d.error ?? undefined}>
                        {d.statusCode ?? t('noAnswer')}
                      </Badge>
                      {d.error && (
                        <span className="ms-2 text-xs text-muted-foreground">{d.error}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-end tabular-nums">
                      {d.latencyMs === null ? '-' : `${d.latencyMs} ms`}
                    </td>
                    <td className="px-2 py-2 text-end tabular-nums">{d.attempts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** An event the screen has no label for (a newer server) shows its own name. */
function safeEvent(te: (k: string) => string, event: string): string {
  try {
    return te(event);
  } catch {
    return event;
  }
}
