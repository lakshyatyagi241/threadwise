/**
 * The pure rules of the flow AI node (TW-FLR-030): which vendor a model name means, the extra system text that forces JSON, how a
 * reply is read as JSON and spread into variables, and the conversation transcript. No database, no clock, no vendor.
 */

/** Reference's ai-call endpoint inferred the vendor from the model name; an unknown name means OpenAI. */
export function providerOfModel(model: string): string {
  const m = model.trim().toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'gemini';
  if (
    m.startsWith('mistral') ||
    m.startsWith('ministral') ||
    m.startsWith('open-mistral') ||
    m.startsWith('open-mixtral')
  )
    return 'mistral';
  return 'openai';
}

/**
 * The system prompt of a step that runs as an AI agent (Settings, AI Training): the agent's own instructions (the step's prompt when
 * the agent has none), then its tone and default language, as the website chatbot words them. A JSON reply gets no chat-style reminder.
 */
export function agentSystemPrompt(
  agent: { systemPrompt: string | null; tone: string | null; language: string | null },
  fallback: string,
  json: boolean,
): string {
  const base = (agent.systemPrompt ?? '').trim() || fallback;
  const tone = (agent.tone ?? '').trim() || 'helpful';
  const lang = (agent.language ?? '').trim() || 'en';
  let out = `${base}\nSpeak in a ${tone} tone. Default language: ${lang}. Match the customer's language if different.`;
  if (!json)
    out += '\nKeep replies short, chat-style, not essay-style. No role prefixes like "Assistant:".';
  return out;
}

/** The text added to the system prompt in extraction mode (the word "json" must appear for OpenAI's json_object mode). */
export function extractionSuffix(fields: readonly string[]): string {
  const keys = fields.map((f) => f.trim()).filter((f) => f !== '');
  const keyList = keys.length > 0 ? `each with exactly these keys: ${keys.join(', ')}. ` : '';
  return (
    '\n\nIMPORTANT: Respond with ONLY valid JSON, no markdown, no code fences, no commentary. ' +
    'Read the ENTIRE message and extract EVERY record it contains. ' +
    `If the message contains a SINGLE record, return one JSON object ${keyList}` +
    'If it contains MULTIPLE records, return {"rows": [ ... ]} where each array element is one such object ' +
    `${keys.length > 0 ? '(same keys). ' : '. '}` +
    'Use an empty string "" for any value you cannot determine. Do not invent data.'
  );
}

/** The system prompt of the hidden extraction pass that runs when a conversation ends (TW-FLR-030 rule: extract on exit). */
export function transcriptExtractionPrompt(fields: readonly string[]): string {
  return (
    'You extract structured data from a support/sales chat transcript. ' +
    'Read the whole conversation and return ONLY a single JSON object with exactly these keys: ' +
    `${fields.join(', ')}. Use the values the CUSTOMER provided. If a value is missing, use an empty string. ` +
    'Do not invent data. Return JSON only, no prose, no code fences.'
  );
}

/** The JSON in a model reply: bare, inside a code fence, or the first `{...}` block of some prose; null when there is none. */
export function tryParseJson(s: unknown): unknown {
  if (typeof s !== 'string') return null;
  let t = s.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = (fence[1] ?? '').trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to the block search */
  }
  const block = /\{[\s\S]*\}/.exec(t);
  if (block) {
    try {
      return JSON.parse(block[0]);
    } catch {
      /* not JSON */
    }
  }
  return null;
}

const flat = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

const ROW_KEYS = ['rows', 'items', 'records', 'data', 'results'] as const;

/**
 * What a reply writes into the run's variables: the raw text under `saveAs`, and when the reply is JSON each top-level field as
 * `saveAs.<key>`. A JSON array puts the whole list under `saveAs.__rows` (the Sheets node writes one row per record) and spreads
 * its first record; an object that wraps its records under rows, items, records, data or results promotes that list to `__rows`.
 */
export function replyVariables(saveAs: string, reply: string): Record<string, unknown> {
  const out: Record<string, unknown> = { [saveAs]: reply };
  const parsed = tryParseJson(reply);
  if (Array.isArray(parsed)) {
    out[`${saveAs}.__rows`] = parsed;
    const first = parsed[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      for (const [k, v] of Object.entries(first)) out[`${saveAs}.${k}`] = flat(v);
    }
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const rowKey = ROW_KEYS.find((k) => {
      const list = obj[k];
      return Array.isArray(list) && list.length > 0 && typeof list[0] === 'object';
    });
    if (rowKey) out[`${saveAs}.__rows`] = obj[rowKey];
    for (const [k, v] of Object.entries(obj)) out[`${saveAs}.${k}`] = flat(v);
  }
  return out;
}

/** What `fields` extraction writes when the transcript is read on exit: only the object's fields, plus the raw text under `saveAs`. */
export function transcriptVariables(saveAs: string, raw: string): Record<string, unknown> | null {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) out[`${saveAs}.${k}`] = flat(v);
  out[saveAs] = raw;
  return out;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** The prompt of a conversation turn: the last ten turns as context, then the customer's latest message. */
export function conversationPrompt(history: readonly ChatTurn[], userMessage: string): string {
  if (history.length === 0) return userMessage;
  const lines = history
    .slice(-10)
    .map((h) => `${h.role === 'assistant' ? 'Assistant' : 'Customer'}: ${h.content}`);
  return (
    `Conversation so far:\n${lines.join('\n')}\n\nCustomer: ${userMessage}\n\n` +
    'Reply as the assistant to the latest customer message. Be natural, helpful, and concise.'
  );
}

/** The whole transcript for the extraction pass. */
export function transcriptText(history: readonly ChatTurn[]): string {
  return history
    .map((h) => `${h.role === 'assistant' ? 'Assistant' : 'Customer'}: ${h.content}`)
    .join('\n');
}

/** The history kept in the wait: this turn added, each message cut to 2000 characters, the last 20 turns kept. */
export function appendTurn(
  history: readonly ChatTurn[],
  userMessage: string,
  reply: string,
): ChatTurn[] {
  const next = [...history];
  if (userMessage) next.push({ role: 'user', content: userMessage.slice(0, 2000) });
  next.push({ role: 'assistant', content: reply.slice(0, 2000) });
  return next.slice(-20);
}

/** Reads the history back out of a wait's `data` (a hand-edited or old row never breaks a turn). */
export function historyOf(data: unknown): ChatTurn[] {
  const raw = (data as { history?: unknown } | null | undefined)?.history;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (h): h is ChatTurn =>
        !!h && typeof h === 'object' && typeof (h as ChatTurn).content === 'string',
    )
    .map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content }));
}
