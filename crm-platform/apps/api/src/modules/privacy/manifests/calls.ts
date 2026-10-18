import { defineHolder } from '../registry/define';
import type { Link } from '../registry/types';

/**
 * Calls: the call log, WhatsApp call permissions, AI call logs (caller and callee numbers, recording URLs, transcripts) and the
 * recordings in object storage. Wiring map keys: calls.logs, calls.permissions, calls.recordings, calls.transcripts.
 */
const CONTACT: Link = { by: 'contact', column: 'contact_id' };

export const callsLogs = defineHolder({
  key: 'calls.logs',
  module: 'calling-voice',
  description: 'The call log: numbers, times, outcome, the recording and the transcript.',
  subjects: ['contact'],
  tables: [
    {
      table: 'wa_calls',
      link: [
        CONTACT,
        { by: 'conversation', column: 'conversation_id' },
        { by: 'phone', column: 'from_phone' },
        { by: 'phone', column: 'to_phone' },
      ],
      disposition: 'anonymise',
      set: {
        from_phone: 'tombstone',
        to_phone: 'tombstone',
        recording_path: 'null',
        transcript: 'null',
        error_payload: 'null',
        meta_payload: 'null',
      },
      tier: 'history',
      categories: ['identifier', 'communications', 'voice'],
      pii: [
        'from_phone',
        'to_phone',
        'recording_path',
        'transcript',
        'error_payload',
        'meta_payload',
      ],
      storage: [{ column: 'recording_path', note: 'the call recording (audio)' }],
      retention:
        'The call row is kept (billing, the log). The recording file is deleted by the daily sweep after the workspace window (default 90 days, 7 to 365; BL-144) unless a legal hold is set, by hand with call.recordings.manage, or when the person declines recording; an erasure also removes it. The consent evidence on the row (answer, method, time, notice version and hash) holds no personal value and stays. Transcripts: none stored yet (BL-146).',
    },
    {
      table: 'call_log_entries',
      link: [CONTACT, { by: 'phone', column: 'customer_phone' }],
      disposition: 'anonymise',
      set: {
        customer_phone: 'null',
        our_phone: 'null',
        notes: 'null',
        external_id: 'null',
        recording_ref: 'null',
      },
      tier: 'history',
      categories: ['identifier', 'communications', 'voice'],
      pii: ['customer_phone', 'our_phone', 'notes', 'external_id', 'recording_ref'],
      retention:
        'The call row is kept (the log, the analytics). Calls that are not WhatsApp calls: logged by hand, reported by the mobile app or by a telephony provider. The notes are free text written by a teammate; the recording reference is a pointer on the provider (never audio), cleared by the daily sweep after the workspace recording window (default 90 days) and only ever stored after the recording consent rules allowed it. An erasure clears the number, the notes, the provider call id and the reference.',
    },
    {
      // A click-to-call the workspace asked a telephony provider to bridge: the placement is only the correlation the provider's
      // completion callback needs to find the handler and the contact again. It is deleted when that callback arrives and by the
      // daily sweep after two days (call-log-retention.service.ts), so it is no history worth keeping without the person: an erasure
      // deletes it in either history mode (no `whenAnonymising`; `customer_phone` is NOT NULL and the row has no other use).
      // `user_id` is the staff member who clicked (a staff pointer, not the subject) and `contact_id` is ON DELETE SET NULL.
      // The sibling tables of the same migration hold no person's data and are therefore not registered: `telephony_connections`
      // keeps the workspace's own provider numbers and an encrypted signing secret, `call_logging_settings` two workspace switches
      // (the detector in registry.spec.ts flags neither, so an allow-list entry would itself fail the "no unneeded entry" check).
      table: 'telephony_click_calls',
      link: [CONTACT, { by: 'phone', column: 'customer_phone' }],
      disposition: 'delete',
      tier: 'history',
      categories: ['identifier', 'communications', 'voice'],
      pii: ['customer_phone', 'external_id'],
      retention:
        'Short-lived: deleted when the provider reports the finished call, otherwise by the daily sweep after 2 days. An erasure deletes whatever placement is still waiting, by contact or by number.',
    },
    {
      table: 'ai_call_logs',
      link: [
        { by: 'conversation', column: 'conversation_id' },
        { by: 'phone', column: 'caller_phone' },
        { by: 'phone', column: 'callee_phone' },
      ],
      disposition: 'anonymise',
      set: {
        caller_phone: 'tombstone',
        callee_phone: 'tombstone',
        recording_url_agent: 'null',
        recording_url_user: 'null',
        recording_url_mixed: 'null',
        transcript_json: 'null',
        tool_calls_json: 'null',
        failure_reason: 'null',
        meta_json: 'null',
      },
      tier: 'history',
      categories: ['identifier', 'communications', 'voice', 'ai_inference'],
      pii: [
        'caller_phone',
        'callee_phone',
        'recording_url_agent',
        'recording_url_user',
        'recording_url_mixed',
        'transcript_json',
        'tool_calls_json',
        'failure_reason',
        'meta_json',
      ],
      retention:
        'Forever today. Phone text without a foreign key to the contact; recording URLs point at the voice vendor, which holds its own copy (see the sub-processor register).',
    },
  ],
});

export const callsPermissions = defineHolder({
  key: 'calls.permissions',
  module: 'calling-voice',
  description: 'WhatsApp call permission state per number.',
  subjects: ['contact'],
  tables: [
    {
      table: 'wa_call_permissions',
      link: { by: 'phone', column: 'contact_phone' },
      disposition: 'delete',
      tier: 'history',
      categories: ['identifier', 'behaviour'],
      pii: ['contact_phone'],
      retention:
        'Until the permission expires or is withdrawn; no contact link, matched by number.',
    },
  ],
});
