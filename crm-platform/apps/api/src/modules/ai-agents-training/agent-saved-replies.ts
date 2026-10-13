import { renderSavedReply, type VariableLookup } from '@crm/contracts';

/** Reference puts the 15 most used shared replies into the agent's prompt. */
export const AGENT_SAVED_REPLIES_MAX = 15;
/** Reference cuts each reply to its first 280 characters. */
export const AGENT_SAVED_REPLY_CHARS = 280;
/** The whole section stays under this many characters, so it never crowds out the knowledge base (the flow AI node's is 12,000). */
export const AGENT_SAVED_REPLIES_BUDGET = 4_000;

export interface PromptReply {
  title: string;
  body: string;
}

export interface PromptFacts {
  workspaceName: string;
  /** `YYYY-MM-DD`. */
  today: string;
}

/**
 * The variables a workspace-wide prompt can fill: the workspace's name and today's date. Everything else (the contact, the agent, the
 * channel) differs per conversation, so a reply that uses any of it is NOT usable as a reference example: it would show the model a
 * literal `{{first_name}}`, which it might then say to a customer.
 */
export const promptLookup =
  (f: PromptFacts): VariableLookup =>
  (key) => {
    if (key === 'workspace_name' || key === 'company_name' || key === 'business_name')
      return f.workspaceName;
    if (key === 'today') return f.today;
    return undefined;
  };

/**
 * The prompt section built from the library's shared replies (already ordered, most used first): each reply as `- Title: text`
 * (workspace variables filled, text cut to AGENT_SAVED_REPLY_CHARS), at most AGENT_SAVED_REPLIES_MAX replies and
 * AGENT_SAVED_REPLIES_BUDGET characters. A reply with a variable that cannot be filled here is left out, not shown with braces. Empty
 * string when nothing is left. Pure.
 */
export function buildSavedRepliesSection(
  replies: readonly PromptReply[],
  facts: PromptFacts,
): { text: string; included: number; skippedForVariables: number } {
  const lookup = promptLookup(facts);
  const lines: string[] = [];
  let used = 0;
  let skipped = 0;
  for (const r of replies) {
    if (lines.length >= AGENT_SAVED_REPLIES_MAX) break;
    const filled = renderSavedReply(r.body, lookup);
    if (filled.issues.length > 0) {
      skipped += 1;
      continue;
    }
    const body = filled.text.replace(/\s+/g, ' ').trim();
    if (body === '') continue;
    const cut = Array.from(body).slice(0, AGENT_SAVED_REPLY_CHARS).join('');
    const line = `- ${r.title.replace(/\s+/g, ' ').trim()}: ${cut}`;
    if (used + line.length > AGENT_SAVED_REPLIES_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return { text: '', included: 0, skippedForVariables: skipped };
  return {
    text: `Approved replies your team uses. Treat them as examples of tone and wording, not as scripts; answer the customer's actual question:\n${lines.join('\n')}`,
    included: lines.length,
    skippedForVariables: skipped,
  };
}
