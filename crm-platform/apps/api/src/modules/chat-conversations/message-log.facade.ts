import type { Readable } from 'node:stream';
import type {
  CreateMessageLogExportInput,
  MessageLogExport,
  MessageLogExportList,
  MessageLogResponse,
} from '@crm/contracts';

/**
 * The door the inbox uses to reach the message delivery log (the events of every message, and the export of them to a file). The inbox
 * never touches `message_events` or the archive itself: it calls this. Every method runs under the ambient request context and speaks
 * uuids. None of them knows about read scopes: **the caller decides whether the person may see the conversation of the message before
 * it asks for its log**, and holds `inbox.logs.export` before it asks for an export.
 *
 * Bound to `MESSAGE_LOG_FACADE` by `ChatConversationsModule`.
 */
export interface MessageLogFacade {
  /** `GET /inbox/messages/:id/log`: the message's status now and every event, oldest first, from the live table and the archive. `MESSAGE_NOT_FOUND`. */
  messageLog(messageUuid: string): Promise<MessageLogResponse>;

  /**
   * `POST /inbox/message-logs/exports`: queues the export of a date range to a CSV, built in the background and announced to the
   * requester by email. `MESSAGE_LOG_EXPORT_RANGE_INVALID`, `MESSAGE_LOG_EXPORT_IN_PROGRESS`.
   */
  requestExport(input: CreateMessageLogExportInput): Promise<MessageLogExport>;

  /** `GET /inbox/message-logs/exports`: the workspace's latest exports, newest first. */
  listExports(): Promise<MessageLogExportList>;

  /** `GET /inbox/message-logs/exports/:id/download`: the CSV. `MESSAGE_LOG_EXPORT_NOT_FOUND`, `MESSAGE_LOG_EXPORT_NOT_READY` (not built yet, failed or expired). */
  downloadExport(exportUuid: string): Promise<{ stream: Readable; fileName: string }>;
}

export const MESSAGE_LOG_FACADE = Symbol('MESSAGE_LOG_FACADE');
