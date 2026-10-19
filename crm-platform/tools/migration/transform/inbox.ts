import { obj, parseTurn, sentInteractiveFrom, TOP_KEYS } from '../inbox/parse';
import { iso, plain, primaryKey, scrub, str, toDate, type Doc } from '../util';
import { c, rest } from './common';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Row, Soft } from './types';

/**
 * chathistory (one document = one turn) -> messages. The conversation each message sits on, the channel and the ledger rows are made by
 * the step's loader hooks (load/inbox.ts) from the plan of pass 1 (inbox/plan.ts); this transform only turns one planned turn into its
 * `messages` row, the same way for the loader and the verifier.
 *
 * Quiet history, as the app's own history import writes it (inbound-ingest.service.ts `store`, conversations.repository.ts
 * `applyHistory`): created_at backdated to when the turn happened, no unread, no wait, no events, no outbox. Outbound turns are
 * ALWAYS `sent`: a `queued` row is re-dispatched by QueuedMessageRecoveryService, which would RESEND old bot messages to customers (R2).
 */
export const INBOX_FIELDS: FieldMap = {
  _id: 'id (messages.uuid is derived from it; registered in migration.id_map)',
  botid:
    'channel (via the operator channel map: conversations.channel_id) and jsonb:messages.meta.legacy.botid',
  session_id:
    'jsonb:messages.meta.legacy.sessionId (many Waboo sessions become ONE thread per number)',
  conversation_id: 'jsonb:messages.meta.legacy.conversationId',
  message_id: 'jsonb:messages.meta.legacy.messageId',
  meta_msg_id: 'col:provider_message_id (and a message_ledger row when it is a usable provider id)',
  ctype:
    'col:sender_kind (livechat out-turns are agent, bot out-turns are bot) and jsonb:meta.legacy.ctype',
  channel:
    'channel kind: whatsapp only; website chat is quarantined WEBCHAT_NO_CHANNEL until a webchat channel exists (Q6)',
  user: 'conversations: peer (user.mobile, user.user), status (conversation_status), conversation_state, contact (contact_id); the rest of the visitor_logs snapshot is dropped (phase-2 visitor_logs owns it)',
  context:
    'conversations: peer_name (visitor_name), peer (visitor_phone, mobile_phone_number), contact (contact_id); the rest (campaign / device / custom echoes of contact data) is dropped, the contact already carries it',
  createdAt: 'col:created_at, provider_ts, sent_at (out) -- the partition key',
  agent:
    'col:sender_user_id (agent turns) and conversations.assignee_user_id (newest agent); presence fields (chat_limit, status, devices ...) dropped',
  bot_response: 'col:body and col:kind; the whole object in jsonb:meta.legacy.response',
  user_query_object:
    'col:body (value) and col:kind (type); system line for fromAgent/toAgent; the rest in jsonb:meta.legacy.query',
  user_query: 'col:body (string, trimmed) or body + meta.legacy.mediaUrl ({url, text})',
  whatsapp_window: 'jsonb:messages.meta.legacy.whatsappWindow',
  whatapp_start_time: 'jsonb:messages.meta.legacy.windowStart',
  intent: 'jsonb:messages.meta.legacy.intent',
  entity: 'drop:always null in the pilot data (bot NLU bookkeeping)',
  question: 'jsonb:messages.meta.legacy.question',
  qid: 'jsonb:messages.meta.legacy.qid',
  session_created_time: 'jsonb:messages.meta.legacy.sessionCreatedTime',
};

/** Nested keys of the objects above that are read; every other nested key is dropped (listed with counts in the report). */
export const NESTED_READ: Record<string, string[]> = {
  user: ['mobile', 'user', 'contact_id', 'conversation_status', 'conversation_state'],
  context: ['visitor_phone', 'visitor_name', 'mobile_phone_number', 'contact_id'],
  agent: ['id', 'name'],
};

/** What the database will hold: no undefined, no class instances (the verifier compares this with the stored jsonb). */
const jsonOnly = (v: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

const compact = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export const MESSAGE_CONSTANTS: Record<string, unknown> = {
  sender_agent_id: null,
  media_key: null,
  media_mime: null,
  media_size: null,
  media_name: null,
  media_sha256: null,
  latitude: null,
  longitude: null,
  failure_code: null,
  failure_reason: null,
  client_message_id: null,
  reply_to_message_uuid: null,
  reaction: null,
  starred: false,
  pinned: false,
  edited_at: null,
  deleted_at: null,
  is_translated: false,
  translated_body: null,
  detected_language: null,
  template_id: null,
  delivered_at: null,
  read_at: null,
};

export const inbox: HandlerSpec = {
  handler: 'inbox',
  collection: 'chathistory',
  mapCollection: 'chathistory',
  extraKeysStored: true,
  fields: INBOX_FIELDS,
  tables: {
    messages: {
      columns: [
        // `id` and `conversation_id` are allocated by the loader hook (the ids exist before the INSERT); never compared row by row
        c('id', 'bigint'),
        c('conversation_id', 'bigint'),
        c('seq', 'bigint'),
        c('direction', 'text'),
        c('kind', 'text'),
        c('sender_kind', 'text'),
        c('sender_user_id', 'bigint'),
        c('body', 'text'),
        c('status', 'text'),
        c('provider_message_id', 'text'),
        c('meta', 'jsonb'),
        c('provider_ts', 'timestamptz'),
        c('sent_at', 'timestamptz'),
        c('created_at', 'timestamptz'),
      ],
      skipCompare: ['id', 'conversation_id'],
      constants: MESSAGE_CONSTANTS,
      windowCol: 'created_at',
      liveColumns: [
        'status',
        'delivered_at',
        'read_at',
        'failure_code',
        'failure_reason',
        'reaction',
        'starred',
        'pinned',
        'edited_at',
        'deleted_at',
        'is_translated',
        'translated_body',
        'detected_language',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.chat;
    const dp = plan?.docs.get(primaryKey(doc));
    if (!plan || !dp)
      return {
        kind: 'quarantine',
        code: 'NOT_PLANNED',
        reason: 'the inbox plan has no verdict for this document',
      };
    if (dp.state === 'exclude') return { kind: 'exclude', code: dp.code!, reason: dp.reason! };
    if (dp.state === 'quarantine')
      return { kind: 'quarantine', code: dp.code!, reason: dp.reason! };

    const turn = parseTurn(doc);
    const soft: Soft[] = [...dp.softs, ...turn.soft];
    const out = turn.direction === 'out';
    let senderUserId: number | null = null;
    if (turn.senderKind === 'agent' && ctx.idx.hasUsers) {
      const agentId = str(obj(doc.agent)?.id);
      if (agentId) {
        const ref = ctx.ref('user', agentId);
        if (ref && ref.table === 'users') senderUserId = ref.id;
        else
          soft.push({
            code: 'UNRESOLVED_AGENT',
            reason:
              'the Waboo agent of this turn matches no migrated user; sender_user_id is left empty',
          });
      }
    }
    const extra = rest(doc, TOP_KEYS);
    const meta = jsonOnly(
      scrub(
        plain({
          historySync: true,
          // the buttons under a bot message (Visit our website, Call now ...): the inbox draws them from meta.sentInteractive.
          // Not only for kind 'interactive': a button message with an image / video / document header is that file's message
          // (parseTurn), and it still carries its buttons.
          ...(out && turn.legacy.interactive !== undefined
            ? { sentInteractive: sentInteractiveFrom(turn.legacy.interactive, turn.body) }
            : {}),
          legacy: compact({
            src: 'waboo',
            sessionId: str(doc.session_id),
            conversationId: str(doc.conversation_id),
            messageId: str(doc.message_id),
            qid: str(doc.qid),
            intent: str(doc.intent),
            question: str(doc.question),
            ctype: str(doc.ctype),
            botid: str(doc.botid),
            whatsappWindow: typeof doc.whatsapp_window === 'boolean' ? doc.whatsapp_window : null,
            windowStart: iso(toDate(doc.whatapp_start_time)),
            sessionCreatedTime: iso(toDate(doc.session_created_time)),
            ...turn.legacy,
            extra: Object.keys(extra).length > 0 ? extra : null,
          }),
        }),
      ).value,
    );
    const at = dp.at!;
    const row: Row = {
      id: null,
      conversation_id: null,
      seq: dp.seq!,
      direction: turn.direction,
      kind: turn.kind,
      sender_kind: turn.senderKind,
      sender_user_id: senderUserId,
      body: turn.body,
      status: out ? 'sent' : 'received',
      provider_message_id: str(doc.meta_msg_id),
      meta,
      provider_ts: at,
      sent_at: out ? at : null,
      created_at: at,
      // carried to the loader hooks, never a column
      _thread: dp.thread,
      _ledger: dp.ledgerKey ?? null,
    };
    return { kind: 'rows', rows: [{ table: 'messages', sub: '', row }], soft };
  },
  group(doc, env) {
    const k = primaryKey(doc);
    const d = env.chat?.docs.get(k);
    return d?.state === 'thread' ? d.thread! : `~${k}`;
  },
  fingerprint: (env) => env.chat?.fingerprint ?? '',
};
