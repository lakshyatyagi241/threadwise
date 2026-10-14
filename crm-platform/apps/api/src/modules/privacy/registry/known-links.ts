/**
 * Links from a table to a person that the database does not declare as a foreign key, written down so the registry test can find
 * them. Each entry is asserted to still exist in the schema, so the list cannot rot. A table here must be registered (the test fails
 * otherwise); this list is how the test knows to look at it.
 *
 * `messages` and the tables around it have no foreign key on purpose (migration 20261014100600: a partitioned stream that is deleted
 * with its conversation by a trigger), `ai_call_logs` and the lead scoring log store a phone or an id as plain text/number.
 */
export interface KnownLink {
  table: string;
  column: string;
  /** What the column holds. */
  holds: string;
}

export const KNOWN_NO_FK_LINKS: readonly KnownLink[] = [
  { table: 'messages', column: 'conversation_id', holds: 'conversations.id (a conversation belongs to a contact or a peer number)' },
  { table: 'message_events', column: 'message_id', holds: 'messages.id' },
  { table: 'conversation_events', column: 'conversation_id', holds: 'conversations.id' },
  { table: 'faq_match_logs', column: 'conversation_id', holds: 'conversations.id' },
  { table: 'flow_runs', column: 'conversation_id', holds: 'conversations.id' },
  { table: 'ai_call_logs', column: 'caller_phone', holds: 'the caller number as text' },
  { table: 'ai_call_logs', column: 'callee_phone', holds: 'the callee number as text' },
  { table: 'lead_scoring_runs', column: 'contact_id', holds: 'contacts.id as a plain number' },
  { table: 'api_library_logs', column: 'contact_uuid', holds: 'contacts.uuid' },
  { table: 'wa_call_permissions', column: 'contact_phone', holds: 'the contact number as text' },
  { table: 'keyword_reply_logs', column: 'contact_phone', holds: 'the sender number as text' },
  { table: 'auto_reply_lookups', column: 'contact_phone', holds: 'the sender number as text' },
  { table: 'google_form_sessions', column: 'contact_phone', holds: 'the respondent number as text' },
];
