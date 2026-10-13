import { primaryKey, redactText, str, toDate, type Doc } from '../util';
import type { Soft } from '../transform/types';
import { arr, isDisplayDate, obj, s, wabooDate } from './rules';

/**
 * Waboo FAQ knowledge -> WaDesk FAQs (faqs + faq_variations + faq_settings), pass 1: from the dump alone, one derived document per
 * question. The loader and the verifier build the same documents (transform/faq.ts reads them through `read`).
 *
 * Where the pieces live in Waboo:
 *   bot_workspace   records of type Intent / FAQ: botid, qid, `question` / `query` (a string or a list of strings), `intent` (a label),
 *                   `journey` {qid, name, nodeId} (the flow the question starts) and, on an FAQ that answers inline, `response[]`
 *                   (the same message objects the flow steps use: a string value, a {text,url} value, or an interactive body)
 *   faq_variations  {botid, qid, phrases[]}: extra phrasings of the question whose qid it carries
 * One question = the Intent / FAQ records of a bot that share a qid (an Intent that starts a flow shares the qid of that journey's
 * steps; an FAQ that answers inline has its own qid), plus the faq_variations documents of that qid.
 *
 * The limits are the application's own (FAQ_LIMITS in packages/contracts/src/faq-knowledge/entries.ts and FAQ_PLATFORM_DEFAULTS in
 * .../platform.ts on main; counted in UTF-16 units like the zod schemas): what the API would refuse is trimmed or quarantined here, so
 * every row this tool writes is one a person could have saved in the screen.
 */
export const FAQ_LIMITS = {
  question: 500,
  answerText: 4096,
  variation: 500,
  /** platform default maxFaqs: FAQs one flow may hold */
  faqsPerFlow: 500,
  /** platform default maxVariationsPerFaq: the question's own variation counts */
  variationsPerFaq: 60,
} as const;

/** One whitespace-collapsed, trimmed copy without NUL: what the application stores and compares (faq.rules.ts tidy). */
export const tidy = (v: string): string => v.replaceAll('\u0000', '').replace(/\s+/gu, ' ').trim();
/** The key two phrasings are the same under (uq_faqs_question / uq_faq_variations_text: lower(btrim(...))). */
export const sameKey = (v: string): string => tidy(v).toLowerCase();

export interface FaqVariation {
  text: string;
  /** `question` is the FAQ's own question kept as a variation (the app keeps exactly one, in step with the question) */
  source: 'question' | 'import';
}

/** The derived document of one question. Every key is listed in FAQ_DOC_FIELDS (transform/faq.ts). */
export interface FaqDoc {
  /** `${botid}|${qid}` */
  id: string;
  botid: string;
  qid: string;
  question: string | null;
  answer_type: 'text' | 'flow' | null;
  answer_text: string | null;
  variations: FaqVariation[];
  created_at: string | null;
  updated_at: string | null;
  /** how many Intent / FAQ records were merged into this question */
  records: number;
  soft: Soft[];
  /** set = the document is quarantined with this code (never guessed around) */
  problem: { code: string; reason: string } | null;
}

export type OwnerCheck = { ok: true } | { ok: false; code: string; reason: string };

export interface FaqInput {
  workspace: Doc[];
  variations: Doc[];
  /** can the bot's flow be the owner of FAQs (the flows plan says the bot became a flow) */
  owner(botId: string): OwnerCheck;
}

/** wabo writes text as light HTML; the FAQ answer is plain lines (the same rules as the flow converter's `plain`). */
function htmlText(v: unknown): string {
  return s(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const wordsOf = (v: unknown): string[] => {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === 'string') {
      if (x.trim() !== '') out.push(x);
    } else if (Array.isArray(x)) x.forEach(walk);
  };
  walk(v);
  return out;
};

interface Group {
  botid: string;
  qid: string;
  records: Doc[];
  vdocs: Doc[];
}

interface Answer {
  text: string;
  /** a journey is named by the records (the question starts a flow) */
  journey: string | null;
  buttons: number;
  other: number;
  media: number;
}

/** The inline answer of the records of a question: the text of their response[] elements, in order. Buttons and files are counted, not kept. */
function answerOf(records: Doc[]): Answer {
  const parts: string[] = [];
  let journey: string | null = null;
  let buttons = 0;
  let other = 0;
  let media = 0;
  for (const r of records) {
    journey ??= str(obj(r.journey).qid);
    for (const el of arr(r.response)) {
      const e = obj(el);
      const inter = obj(e.interactive);
      if (typeof e.value === 'string') {
        const t = htmlText(e.value);
        if (t) parts.push(t);
        else other++;
      } else if (Object.keys(inter).length > 0) {
        const t = [htmlText(inter.body), htmlText(inter.footer)].filter(Boolean).join('\n\n');
        if (t) parts.push(t);
        buttons += arr(obj(inter.action).buttons).length + (obj(inter.action).sections ? 1 : 0);
        if (!t) other++;
      } else if (e.value !== null && typeof e.value === 'object') {
        const v = obj(e.value);
        const t = [htmlText(v.text), str(v.url)].filter(Boolean).join('\n');
        if (t) {
          parts.push(t);
          media++;
        } else other++;
      } else other++;
    }
  }
  return { text: parts.join('\n\n'), journey, buttons, other, media };
}

const clipUnits = (v: string, n: number): string => (v.length <= n ? v : v.slice(0, n).trimEnd());

export function buildFaqDocs(a: FaqInput): FaqDoc[] {
  // --- the questions: Intent / FAQ records grouped by (bot, qid), then the faq_variations documents attached ---------------------
  const groups = new Map<string, Group>();
  const byJourney = new Map<string, string>();
  const gkey = (bot: string, qid: string): string => `${bot}\u0000${qid}`;
  for (const d of a.workspace) {
    const ty = (str(d.type) ?? '').toLowerCase();
    if (ty !== 'intent' && ty !== 'faq') continue;
    const botid = str(d.botid);
    if (botid === null) continue; // the flows plan quarantines it NO_BOT_ID; there is no bot to own an FAQ
    const jq = str(obj(d.journey).qid);
    const qid = str(d.qid) ?? jq ?? `rec:${primaryKey(d)}`;
    const k = gkey(botid, qid);
    const g = groups.get(k) ?? { botid, qid, records: [], vdocs: [] };
    g.records.push(d);
    groups.set(k, g);
    if (jq !== null && !byJourney.has(gkey(botid, jq))) byJourney.set(gkey(botid, jq), k);
  }
  for (const v of a.variations) {
    const botid = str(v.botid);
    if (botid === null) continue; // faq_replies quarantines it NO_BOT_ID
    const qid = str(v.qid) ?? `var:${primaryKey(v)}`;
    const k = groups.has(gkey(botid, qid)) ? gkey(botid, qid) : (byJourney.get(gkey(botid, qid)) ?? gkey(botid, qid));
    const g = groups.get(k) ?? { botid, qid, records: [], vdocs: [] };
    g.vdocs.push(v);
    groups.set(k, g);
  }

  // --- one document per question -----------------------------------------------------------------------------------------------
  const docs: FaqDoc[] = [];
  for (const g of groups.values()) {
    const soft: Soft[] = [];
    const state: { problem: FaqDoc['problem'] } = { problem: null };
    const stop = (code: string, reason: string): void => {
      state.problem ??= { code, reason };
    };

    const owner = a.owner(g.botid);
    if (!owner.ok) stop('NO_OWNER_FLOW', `its bot has no flow to own the FAQ (${owner.code}): ${owner.reason}`);

    // the question: the first non-empty `question` (else `query`) of the records; the other strings are extra phrasings
    const asked: string[] = [];
    const askedKeys = new Set<string>();
    for (const r of g.records) {
      const w = wordsOf(r.question);
      for (const raw of w.length > 0 ? w : wordsOf(r.query)) {
        const t = tidy(raw);
        if (t !== '' && !askedKeys.has(t.toLowerCase())) {
          askedKeys.add(t.toLowerCase());
          asked.push(t);
        }
      }
    }
    const question = asked[0] ?? null;
    if (question === null)
      stop(
        'NO_QUESTION',
        g.records.length === 0
          ? 'no Intent / FAQ record of this bot carries this qid, so the question text is unknown (the phrases alone are not a question; nothing is guessed)'
          : 'the Intent / FAQ record has no question text',
      );
    else if (question.length > FAQ_LIMITS.question)
      stop('QUESTION_TOO_LONG', `the question is longer than ${FAQ_LIMITS.question} characters, which the application refuses`);
    if (g.records.length > 1)
      soft.push({
        code: 'RECORDS_MERGED',
        reason: 'several Intent / FAQ records share this qid: one FAQ, the first question is the question, the others are variations',
        detail: g.records.length,
      });

    // the answer: the record's own inline text, else the flow of its journey
    const ans = answerOf(g.records);
    let answerType: 'text' | 'flow' | null = null;
    let answerText: string | null = null;
    if (ans.text !== '') {
      const red = redactText(ans.text);
      answerText = red.text.trim();
      answerType = 'text';
      if (red.n > 0)
        soft.push({
          code: 'ANSWER_REDACTED',
          reason: 'something in the answer looked like a credential and was replaced by [redacted]',
          detail: red.n,
        });
      if (answerText.length > FAQ_LIMITS.answerText)
        stop('ANSWER_TOO_LONG', `the answer is longer than ${FAQ_LIMITS.answerText} characters, which the application refuses (never cut)`);
      if (ans.buttons + ans.other + ans.media > 0)
        soft.push({
          code: 'ANSWER_PARTS_LOST',
          reason:
            'an FAQ answer is plain text: buttons and list rows are lost, a file or image is kept as its caption and link, an empty message is skipped',
          detail: { buttons: ans.buttons, empty: ans.other, mediaAsLink: ans.media },
        });
      if (ans.journey !== null)
        soft.push({
          code: 'ANSWER_ALSO_FLOW',
          reason: 'the record has an inline answer and a journey; the inline answer is used and the journey is not linked',
          detail: ans.journey,
        });
    } else if (ans.journey !== null) {
      answerType = 'flow';
      soft.push({
        code: 'QID_NOT_ADDRESSABLE',
        reason:
          'a journey inside a flow cannot be addressed: the FAQ (paused) starts the whole flow of its bot from its trigger (flow_node_id stays empty); check it before enabling',
        detail: ans.journey,
      });
    } else {
      stop('NO_ANSWER', 'the record has neither an inline answer (response) nor a journey, so there is nothing to answer with');
    }

    // the variations: the question itself (as the application keeps it), the other questions, then the faq_variations phrases
    const variations: FaqVariation[] = [];
    if (question !== null) {
      const seen = new Set<string>();
      let tooLong = 0;
      let capped = 0;
      const add = (text: string, source: FaqVariation['source']): void => {
        const k = text.toLowerCase();
        if (text === '' || seen.has(k)) return;
        if (text.length > FAQ_LIMITS.variation) {
          tooLong++;
          return;
        }
        if (variations.length >= FAQ_LIMITS.variationsPerFaq) {
          capped++;
          seen.add(k);
          return;
        }
        seen.add(k);
        variations.push({ text, source });
      };
      add(question, 'question');
      for (const t of asked.slice(1)) add(t, 'import');
      for (const v of g.vdocs)
        for (const p of Array.isArray(v.phrases) ? v.phrases : typeof v.phrases === 'string' ? [v.phrases] : [])
          if (typeof p === 'string') add(tidy(p), 'import');
      if (tooLong > 0)
        soft.push({
          code: 'VARIATION_TOO_LONG_DROPPED',
          reason: `a phrase longer than ${FAQ_LIMITS.variation} characters is refused by the application and was left out`,
          detail: tooLong,
        });
      if (capped > 0)
        soft.push({
          code: 'VARIATIONS_CAPPED',
          reason: `an FAQ holds at most ${FAQ_LIMITS.variationsPerFaq} variations (the question included); the later phrases were left out`,
          detail: capped,
        });
    }

    // dates: the earliest creation and the latest update of the records
    const created: Date[] = [];
    const updated: Date[] = [];
    let display = false;
    for (const r of g.records) {
      const c = wabooDate(r.createdAt);
      const u = wabooDate(r.updatedAt);
      if (c) created.push(c);
      if (u) updated.push(u);
      display ||= isDisplayDate(r.createdAt) || isDisplayDate(r.updatedAt);
    }
    // only when no record has a date: the ObjectId time of the faq_variations document (it has no date field of its own)
    if (created.length === 0)
      for (const v of g.vdocs) {
        const c = toDate(v._id);
        if (c) created.push(c);
      }
    if (display)
      soft.push({
        code: 'DATE_ZONE_ASSUMED',
        reason: 'dates written as "dd Mon, yyyy h:mm:ss AM" carry no time zone: they were read as UTC',
      });
    const min = created.length ? new Date(Math.min(...created.map((x) => x.getTime()))) : null;
    const max = updated.length ? new Date(Math.max(...updated.map((x) => x.getTime()))) : min;

    docs.push({
      id: `${g.botid}|${g.qid}`,
      botid: g.botid,
      qid: g.qid,
      question,
      answer_type: answerType,
      answer_text: answerText,
      variations,
      created_at: min ? min.toISOString() : null,
      updated_at: max && min && max >= min ? max.toISOString() : min ? min.toISOString() : null,
      records: g.records.length,
      soft,
      problem: state.problem,
    });
  }

  // --- per flow, in order: the unique question and the cap ----------------------------------------------------------------------
  const taken = new Map<string, Set<string>>();
  const count = new Map<string, number>();
  for (const d of docs) {
    if (d.problem !== null || d.question === null) continue;
    const used = taken.get(d.botid) ?? taken.set(d.botid, new Set()).get(d.botid)!;
    const n = count.get(d.botid) ?? 0;
    if (n >= FAQ_LIMITS.faqsPerFlow) {
      d.problem = {
        code: 'FAQ_LIMIT',
        reason: `a flow holds at most ${FAQ_LIMITS.faqsPerFlow} FAQs and this would be number ${n + 1}`,
      };
      continue;
    }
    count.set(d.botid, n + 1);
    let q = d.question;
    if (used.has(q.toLowerCase())) {
      // two questions of one flow with the same text (uq_faqs_question): the later one is numbered, in load order, and flagged
      let k = 2;
      let next = '';
      do {
        const tail = ` (${k++})`;
        next = `${clipUnits(d.question, FAQ_LIMITS.question - tail.length)}${tail}`;
      } while (used.has(next.toLowerCase()));
      d.soft.push({
        code: 'QUESTION_DUPLICATE_RENAMED',
        reason:
          'another FAQ of the same flow has this question (the application keeps a question unique per flow): this one is numbered; its own wording stays as a variation. Merge or reword before enabling',
        detail: { number: k - 1 },
      });
      // the application keeps exactly one `question` variation, equal to the question: the numbered text takes that place
      const rest = d.variations.filter((v) => v.source !== 'question');
      d.variations = [{ text: next, source: 'question' }, { text: q, source: 'import' }, ...rest.filter((v) => v.text.toLowerCase() !== q.toLowerCase())].slice(
        0,
        FAQ_LIMITS.variationsPerFaq,
      );
      q = next;
      d.question = next;
    }
    used.add(q.toLowerCase());
  }
  return docs;
}
