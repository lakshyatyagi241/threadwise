import {
  buildFaqDocs,
  buildKbFaqDocs,
  faqEntryText,
  KB_FAQ_LABEL,
  type FaqDoc,
  type KbFaqDoc,
} from '../flows/faq';
import type { Doc } from '../util';
import { c, times, TS_COLS } from './common';
import type { Ctx, FieldMap, HandlerSpec, Outcome } from './types';

/**
 * Waboo FAQ knowledge -> ONE text entry labelled "FAQ" per AI agent in the knowledge base (ai_training_sources, kind text; ADR-0021
 * addendum 3: the FAQ engine is retired, a FAQ is text an agent reads). A DERIVED step, like flow_bots: the collection is
 * faq_variations, but the question text and the answer live in the bot's Intent / FAQ records (bot_workspace), so one document per
 * question is built from both (flows/faq.ts) and those are grouped by the agent that will hold them.
 *
 *   entry text      'Q: question\nAlso asked as: a | b\nA: answer' blocks separated by a blank line (the format of the knowledge-base
 *                   merge migration 20270205090000); status ready, no chunks (the application's embed worker cuts and embeds them)
 *   which agent     the bot's own assistant (ai_chat_assistants of the widgets step); a bot without one shares ONE entry that goes to the
 *                   workspace's first active agent, else its first agent, else a new "FAQ assistant" (assigned in the loader hook,
 *                   load/flows.ts, because it needs the target database)
 *   not carried     a question that answers by starting a flow (no text to keep): quarantined FLOW_ANSWER_NOT_CARRIED, like the merge
 *
 * SAFETY: the agents are loaded paused (widgets step), so nothing answers a customer until a person enables an agent. No event_outbox,
 * audit row or vector is written: the chunks are made by the application's own worker.
 */
export const FAQ_DOC_FIELDS: FieldMap = {
  id: 'id (registered in migration.id_map): the entry (kb|botid, or kb|* for the shared one) or, for a question left behind, botid|qid',
  botid: 'the bot whose assistant holds the entry (null: the shared entry); for a quarantined question, the bot that owned it',
  qid: 'groups the Intent / FAQ records and the faq_variations documents of one question; not stored',
  question: 'drop:the question (inside entries for a loaded one; recorded in quarantine for a left-behind one)',
  answer_type: "drop:'text' or 'flow' (a flow answer is quarantined FLOW_ANSWER_NOT_CARRIED)",
  answer_text: 'drop:inside entries',
  variations: 'drop:inside entries as "Also asked as"',
  entries: 'ai_training_sources.content: the questions as Q / Also asked as / A blocks, answers credential-redacted',
  created_at: 'ai_training_sources.created_at (earliest question)',
  updated_at: 'ai_training_sources.updated_at (latest question)',
  records: 'drop:how many Intent / FAQ records were merged',
  soft: 'drop:soft issues of the builder (recorded in quarantine, not stored)',
  problem: 'drop:the reason a question is quarantined (recorded in quarantine, not stored)',
};

export const faqKnowledge: HandlerSpec = {
  handler: 'faq_knowledge',
  collection: 'faq_variations',
  mapCollection: 'faq_knowledge',
  virtual: true,
  // the plan inputs of the flows step decide which bots have a flow and an assistant; bot_workspace holds the questions and answers
  shaCollections: [
    'bot_workspace',
    'chatbots',
    'bot_flow_version',
    'bot_flow_version_data',
    'flows',
    'chatbot_configuration',
    'chatbot_theme',
    'broadcast_templates',
    'journey',
  ],
  fields: FAQ_DOC_FIELDS,
  tables: {
    ai_training_sources: {
      // assistant_id is resolved in the loader hook when the bot has no assistant of its own (so it is not in the fingerprint; the
      // verifier, reconcile/faq.ts, checks it)
      columns: [
        c('assistant_id', 'bigint'),
        c('kind', 'text'),
        c('label', 'text'),
        c('content', 'text'),
        c('status', 'text'),
        c('tokens_estimate', 'integer'),
        ...TS_COLS,
      ],
      fp: ['kind', 'label', 'content', 'status'],
      constants: { row_version: 1 },
      // what the application's worker and the people of the knowledge screen change
      liveColumns: [
        'assistant_id',
        'label',
        'content',
        'status',
        'error',
        'tokens_estimate',
        'updated_at',
        'row_version',
      ],
    },
  },
  async *read({ source, client, ctx }): AsyncIterable<Doc> {
    const plan = ctx?.flows;
    if (!plan) return;
    const all = async (collection: string): Promise<Doc[]> => {
      const out: Doc[] = [];
      if (source.collections(client).includes(collection))
        for await (const d of source.read(client, collection)) out.push(d);
      return out;
    };
    const docs = buildFaqDocs({
      workspace: await all('bot_workspace'),
      variations: await all('faq_variations'),
      owner: (botId) => {
        const v = plan.bots.get(botId)?.verdict;
        if (v?.kind === 'load') return { ok: true };
        return v
          ? { ok: false, code: v.code, reason: v.reason }
          : { ok: false, code: 'UNKNOWN_BOT', reason: 'the flows plan does not know this bot' };
      },
    });
    const grouped = buildKbFaqDocs(docs, (botId) => {
      const w = plan.widgets.get(botId);
      return Boolean(w?.assistant) && w?.verdict.kind === 'load';
    });
    for (const d of grouped) yield d as unknown as Doc;
  },
  transform(raw: Doc, ctx: Ctx): Outcome {
    const doc = raw as unknown as FaqDoc & Partial<KbFaqDoc>;
    if (doc.problem) return { kind: 'quarantine', code: doc.problem.code, reason: doc.problem.reason };
    if (!doc.entries || doc.entries.length === 0)
      return { kind: 'quarantine', code: 'NOT_PLANNED', reason: 'the document has no question or answer' };
    let assistantId: number | null = null;
    if (doc.botid !== null && doc.botid !== undefined) {
      const ref = ctx.ref('widget_assistants', doc.botid);
      if (!ref || ref.table !== 'ai_chat_assistants')
        return {
          kind: 'quarantine',
          code: 'ASSISTANT_NOT_LOADED',
          reason: 'the assistant of its bot was not loaded into ai_chat_assistants, so there is no agent to hold the FAQ',
        };
      assistantId = ref.id;
    }
    const content = faqEntryText(doc.entries);
    const t = times(doc as unknown as Doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      rows: [
        {
          table: 'ai_training_sources',
          sub: '',
          row: {
            assistant_id: assistantId,
            kind: 'text',
            label: KB_FAQ_LABEL,
            content,
            status: 'ready',
            tokens_estimate: Math.ceil(content.length / 4),
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
      soft: [...t.soft, ...(doc.soft ?? [])],
    };
  },
};
