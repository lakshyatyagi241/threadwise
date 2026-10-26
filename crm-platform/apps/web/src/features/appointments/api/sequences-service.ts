import {
  reminderPackAdoptResultSchema,
  reminderPackPreviewSchema,
  reminderPacksResponseSchema,
  reminderReportSchema,
  reminderTestSendResultSchema,
  type ReminderPack,
  type ReminderPackAdoptInput,
  type ReminderPackAdoptResult,
  type ReminderPackKey,
  type ReminderPackPreview,
  type ReminderPackPreviewInput,
  type ReminderReport,
  type ReminderReportQuery,
  type ReminderTestSendResult,
} from '@crm/contracts';
import { call } from './http';

/**
 * The reminder sequences' own calls (BL-424 to BL-429): the packs and their preview, applying a pack, the email test of a step and the
 * delivery report. Always the real API, like the channels and the message library: these need the worker, the templates and the
 * delivery records, which the development stand-in does not have, so with it on they fail visibly instead of faking an answer.
 */
export const sequencesApi = {
  packs(signal?: AbortSignal): Promise<ReminderPack[]> {
    return call('/appointment-reminder-packs', {
      schema: reminderPacksResponseSchema.transform((r) => r.data),
      signal,
    });
  },
  /** What applying the pack to the booking type would do. Writes nothing. */
  previewPack(
    key: ReminderPackKey,
    input: ReminderPackPreviewInput,
    signal?: AbortSignal,
  ): Promise<ReminderPackPreview> {
    return call(`/appointment-reminder-packs/${key}/preview`, {
      method: 'POST',
      body: input,
      schema: reminderPackPreviewSchema,
      signal,
    });
  },
  /** Creates the messages and templates once per workspace and saves the booking type's steps. 409 until a replacement is confirmed. */
  adoptPack(
    key: ReminderPackKey,
    input: ReminderPackAdoptInput,
    idempotencyKey?: string,
  ): Promise<ReminderPackAdoptResult> {
    return call(`/appointment-reminder-packs/${key}/adopt`, {
      method: 'POST',
      body: input,
      schema: reminderPackAdoptResultSchema,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  },
  /**
   * Sends one saved step as an email to the signed-in user's own address, or to `to` when one is typed. The worker sends it; the result
   * arrives as a notification.
   */
  testEmail(typeId: string, reminderId: string, to?: string): Promise<ReminderTestSendResult> {
    return call(`/booking-types/${typeId}/reminders/${reminderId}/test-email`, {
      method: 'POST',
      body: to ? { to } : {},
      schema: reminderTestSendResultSchema,
    });
  },
  report(query: ReminderReportQuery, signal?: AbortSignal): Promise<ReminderReport> {
    return call('/appointment-reminder-report', {
      query: { ...query },
      schema: reminderReportSchema,
      signal,
    });
  },
};
