/**
 * team-inbox-conversations (TIB1): the agent-facing inbox over the conversation core. The list row, message, note, send and read bodies
 * are in `chat-conversations/`; this folder holds what the inbox adds (detail, timeline, attachments, the status state machine).
 * See docs/api/team-inbox-conversations.md and docs/threadwise-port/plan-inbox-chat.md.
 */
export * from './errors';
export * from './inbox';
