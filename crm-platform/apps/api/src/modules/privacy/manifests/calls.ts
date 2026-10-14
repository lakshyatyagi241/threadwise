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
      retention: 'Forever today (no recording retention rule yet, backlog BL-144 and BL-146).',
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
