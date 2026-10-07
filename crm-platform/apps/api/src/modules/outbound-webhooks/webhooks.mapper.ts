import type { WebhookDeliveryResponse, WebhookResponse } from '@crm/contracts';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { DeliveryRow, WebhookRow } from './webhooks.repository';

/** The URL is kept encrypted (a customer may carry a token in its path); the screen shows it back to people who may read webhooks. */
export function toWebhookResponse(row: WebhookRow, crypto: CryptoService): WebhookResponse {
  const events = Array.isArray(row.events) ? (row.events as string[]) : [];
  return {
    id: row.uuid,
    name: row.name,
    url: crypto.decrypt(row.webhookUrl),
    events: events.length === 0 ? ['*'] : events,
    active: row.status,
    hasSecret: row.secret !== null && row.secret !== '',
    isFailing: row.isFailing,
    successCount: row.successCount,
    failureCount: row.failureCount,
    lastStatusCode: row.lastStatusCode,
    lastLatencyMs: row.lastLatencyMs,
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDeliveryResponse(row: DeliveryRow): WebhookDeliveryResponse {
  return {
    id: String(row.id),
    event: row.eventName,
    statusCode: row.statusCode,
    latencyMs: row.latencyMs,
    attempts: row.attempts,
    isRetry: row.isRetry,
    error: row.error,
    firedAt: row.firedAt.toISOString(),
  };
}
