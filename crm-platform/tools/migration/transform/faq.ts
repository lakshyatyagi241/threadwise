import { buildFaqDocs, type FaqDoc } from '../flows/faq';
import type { Doc } from '../util';
import { c, times, TS_COLS } from './common';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Row } from './types';

/**
 * Waboo FAQ knowledge -> WaDesk FAQs (the feature on main: faqs, faq_variations, faq_settings; ADR-0021). A DERIVED step, like flow_bots:
 * the collection is faq_variations, but the question text and the answer live in the bot's Intent / FAQ records (bot_workspace), so one
 * document per question is built from both (flows/faq.ts) and the step reads those. The older step faq_replies (faq_variations ->
 * inactive keyword replies) is untouched and still runs; both read the same collection, which the registry model cannot say (one
 * handler per collection), so this step carries its own id_map collection `faq_knowledge`.
 *
 *   faqs            one per question, owner_flow_id = the flow the bot became, status 'paused' (nothing answers a customer until a
 *                   person enables it), answer = the record's own text, else the flow (flow_id = the owner, flow_node_id empty)
 *   faq_variations  the question itself (source 'question', as the application keeps it), the other phrasings (source 'import');
 *                   embed_state 'pending', embedding NULL: WaDesk's own worker makes the vectors, this tool makes no call
 *   faq_settings    one row per flow that owns an FAQ, enabled = false (written by the loader hook: the table has no uuid)
 *
 * SAFETY: paused FAQs and a disabled flow switch, always. No event_outbox, audit or match-log row. Vectors are never copied.
 */
export const FAQ_DOC_FIELDS: FieldMap = {
  id: 'id (registered in migration.id_map): the bot and the qid of the question',
  botid: 'faqs.owner_flow_id: the flow the bot became (a bot without a flow is quarantined NO_OWNER_FLOW)',
  qid: 'groups the Intent / FAQ records and the faq_variations documents of one question; not stored (QID_NOT_ADDRESSABLE for a flow answer)',
  question: 'faqs.question (first question string of the records) and its own faq_variations row, source question',
  answer_type: "faqs.answer_type: 'text' when the record answers inline, else 'flow' when it names a journey, else NO_ANSWER",
  answer_text: 'faqs.answer_text: the text of the inline response, credential-looking parts redacted, at most 4096 characters',
  variations:
    'faq_variations: the other question strings and the phrases of faq_variations, source import, pending; over-long and over-cap ones counted',
  created_at: 'faqs / faq_variations created_at (earliest record)',
  updated_at: 'faqs / faq_variations updated_at (latest record)',
  records: 'drop:how many Intent / FAQ records were merged (soft RECORDS_MERGED when more than one)',
  soft: 'drop:soft issues of the builder (recorded in quarantine, not stored)',
  problem: 'drop:the reason a question is quarantined (recorded in quarantine, not stored)',
};

/** Columns the application's embed worker settles once it has seen a variation; the loader never writes them. */
const VARIATION_LIVE = [
  'text',
  'source',
  'embed_state',
  'embedding_model',
  'embedded_at',
  'embed_attempts',
  'embed_error',
  'updated_at',
  'row_version',
];

export const faqKnowledge: HandlerSpec = {
  handler: 'faq_knowledge',
  collection: 'faq_variations',
  mapCollection: 'faq_knowledge',
  virtual: true,
  // the plan inputs of the flows step decide which bots have a flow; bot_workspace holds the questions and answers
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
    faqs: {
      columns: [
        c('owner_flow_id', 'bigint'),
        c('question', 'text'),
        c('answer_type', 'text'),
        c('answer_text', 'text'),
        c('flow_id', 'bigint'),
        c('status', 'text'),
        ...TS_COLS,
      ],
      fp: ['question', 'answer_type', 'answer_text', 'status'],
      constants: {
        category: null,
        threshold_override: null,
        created_by: null,
        flow_node_id: null,
        row_version: 1,
      },
      // what people change in the FAQ screen once they work on it
      liveColumns: [
        'question',
        'answer_type',
        'answer_text',
        'flow_id',
        'flow_node_id',
        'category',
        'status',
        'threshold_override',
        'created_by',
        'updated_at',
        'row_version',
      ],
    },
    faq_variations: {
      // no uuid is written: the row hangs off its FAQ (faq_id), conflicts on uq_faq_variations_text are skipped, and a rerun never
      // reads a question whose FAQ is in id_map. The embedding column (halfvec) is deliberately not in the column list.
      keyless: { parent: 'faqs', parentCol: 'faq_id' },
      columns: [c('faq_id', 'bigint'), c('text', 'text'), c('source', 'text'), ...TS_COLS],
      constants: {
        embed_state: 'pending',
        embedding_model: null,
        embedded_at: null,
        embed_attempts: 0,
        embed_error: null,
        row_version: 1,
      },
      liveColumns: VARIATION_LIVE,
    },
    // written by the loader hook (load/flows.ts): the table is keyed by (org_id, flow_id) and has no uuid; reconcile/faq.ts verifies it
    faq_settings: {
      noUuid: true,
      columns: [c('flow_id', 'bigint'), c('enabled', 'boolean')],
      constants: { threshold: '0.450', min_margin: '0.000', log_queries: true, tuned_model: null, row_version: 1 },
      liveColumns: ['enabled', 'threshold', 'min_margin', 'log_queries', 'tuned_model', 'updated_at', 'row_version'],
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
    for (const d of docs) yield d as unknown as Doc;
  },
  transform(raw: Doc, ctx: Ctx): Outcome {
    const doc = raw as unknown as FaqDoc;
    if (doc.problem) return { kind: 'quarantine', code: doc.problem.code, reason: doc.problem.reason };
    const owner = ctx.ref('flow_bots', doc.botid);
    if (!owner || owner.table !== 'flows')
      return {
        kind: 'quarantine',
        code: 'NO_OWNER_FLOW',
        reason: 'the flow of its bot was not loaded into flows, so there is no flow to own the FAQ',
      };
    if (doc.question === null || doc.answer_type === null)
      return { kind: 'quarantine', code: 'NOT_PLANNED', reason: 'the document has no question or answer' };
    const t = times(doc as unknown as Doc, ctx.fallbackAt);
    const rows: Array<{ table: string; sub: string; row: Row }> = [
      {
        table: 'faqs',
        sub: '',
        row: {
          owner_flow_id: owner.id,
          question: doc.question,
          answer_type: doc.answer_type,
          answer_text: doc.answer_type === 'text' ? doc.answer_text : null,
          // a flow answer starts the flow of the bot (the owner); which journey inside it cannot be said (QID_NOT_ADDRESSABLE)
          flow_id: doc.answer_type === 'flow' ? owner.id : null,
          // SAFETY: nothing may answer a customer until a person enables it
          status: 'paused',
          created_at: t.created,
          updated_at: t.updated,
        },
      },
      ...doc.variations.map((v, i) => ({
        table: 'faq_variations',
        sub: `#${i + 1}`,
        row: { text: v.text, source: v.source, created_at: t.created, updated_at: t.updated } as Row,
      })),
    ];
    return { kind: 'rows', rows, soft: [...t.soft, ...doc.soft] };
  },
};
