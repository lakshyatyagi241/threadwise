/**
 * Marks a screen can put on its elements for the Help assistant (docs/specs/help-agent-assistant.md sections 6.3 and 6.4). They are
 * plain data attributes: they do nothing until the assistant is running, and a screen that never mentions the assistant works the same.
 * Spread one onto the element: `<p {...AGENT_IGNORE}>`.
 */

/** Text written by customers or other third parties (messages, notes, form answers). The assistant never reads the region. */
export const AGENT_IGNORE = { 'data-agent-ignore': 'true' } as const;

/** Personal data (a person's name, phone, e-mail, address). The assistant never reads the region. */
export const AGENT_PII = { 'data-agent-pii': 'true' } as const;

/** One of the most dangerous buttons of the app (send, delete, pay, change a role). The assistant always asks before pressing it. */
export const AGENT_RISK_HIGH = { 'data-agent-risk': 'high' } as const;
