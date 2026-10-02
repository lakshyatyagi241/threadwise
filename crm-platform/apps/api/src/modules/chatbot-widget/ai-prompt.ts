import type { AssistantProfile, InboxLine, KnowledgeSource } from './_shims/tokens';

/**
 * The prompt of the widget's AI reply, as pure functions (WD-WGT-016 rules 2 and 4). The limits are WaDesk's: a knowledge
 * base of at most 12,000 characters, at most 20 turns of history inside a 6,000 character budget.
 */

export const KNOWLEDGE_BUDGET = 12_000;
export const HISTORY_TURNS = 20;
export const HISTORY_BUDGET = 6_000;
export const DEFAULT_PERSONA = 'You are a helpful website chatbot.';
export const DEFAULT_HANDOFF = 'A team member will join shortly.';
export const EMPTY_REPLY_FALLBACK =
  "Sorry, I couldn't generate a reply right now. A team member will follow up shortly.";
export const ERROR_FALLBACK =
  "Sorry, I'm having trouble right now. A team member will follow up shortly.";

const chars = (s: string): number => Array.from(s).length;
const cut = (s: string, max: number): string => Array.from(s).slice(0, max).join('');

/** Persona, tone, default language, the chat-style reminder and the handoff hint. */
export function systemPrompt(a: AssistantProfile): string {
  const base = (a.systemPrompt ?? '').trim() || DEFAULT_PERSONA;
  const tone = (a.tone ?? '').trim() || 'helpful';
  const lang = (a.language ?? '').trim() || 'en';
  let out = `${base}\n`;
  out += `Speak in a ${tone} tone. Default language: ${lang}. Match the visitor's language if different.\n`;
  out += 'Keep replies short — chat-style, not essay-style. No role prefixes like "Assistant:".';
  if (a.handoffEnabled && (a.handoffKeyword ?? '') !== '') {
    out +=
      `\nIf the visitor asks to talk to a human, or says "${a.handoffKeyword}", reply with: ` +
      ((a.handoffMessage ?? '').trim() || DEFAULT_HANDOFF);
  }
  return out;
}

const renderSource = (s: KnowledgeSource): string =>
  s.kind === 'qa'
    ? `Q: ${(s.question ?? '').trim()}\nA: ${(s.answer ?? '').trim()}`
    : (s.content ?? '');

/**
 * The trained material, in source order, cut to a shared budget: each chunk is cut to what is left (never under 500
 * characters), the budget shrinks by the whole chunk, and the walk stops once it is spent.
 */
export function knowledgeContext(sources: readonly KnowledgeSource[]): string {
  const parts: string[] = [];
  let budget = KNOWLEDGE_BUDGET;
  for (const s of sources) {
    const text = renderSource(s).trim();
    if (text === '') continue;
    const chunk = `[${s.label}]\n${text}`;
    parts.push(cut(chunk, Math.max(500, budget)));
    budget -= chars(chunk);
    if (budget <= 0) break;
  }
  return parts.join('\n\n');
}

/** The full system prompt: persona, then the knowledge base between its markers, then the language hint. */
export function fullSystemPrompt(
  a: AssistantProfile,
  sources: readonly KnowledgeSource[],
  replyLanguage: string | null,
): string {
  let system = systemPrompt(a);
  const context = knowledgeContext(sources);
  if (context !== '')
    system += `\n\n--- Knowledge base ---\n${context}\n--- End knowledge base ---`;
  if (replyLanguage) {
    system += `\n\nThe visitor is writing in language code "${replyLanguage}". Reply ENTIRELY in that same language, naturally.`;
  }
  return system;
}

/**
 * `lines` is the last turns of the thread, oldest first, WITHOUT the message being answered (WaDesk repeated it as both
 * history and "Visitor just said"; the port leaves it out of the history). Any outbound line is labelled Assistant,
 * human or bot. The walk stops when the character budget is spent.
 */
export function userPrompt(lines: readonly InboxLine[], visitorMessage: string): string {
  const out: string[] = [];
  let budget = HISTORY_BUDGET;
  for (const m of lines) {
    const line = `${m.direction === 'in' ? 'Visitor' : 'Assistant'}: ${(m.body ?? '').trim()}`;
    out.push(line);
    budget -= chars(line);
    if (budget <= 0) break;
  }
  const transcript = out.join('\n');
  return (
    (transcript !== '' ? `Conversation so far:\n${transcript}\n\n` : '') +
    `Visitor just said:\n${visitorMessage.trim()}` +
    '\n\nReply briefly and helpfully. Plain text only, no role prefix.'
  );
}
