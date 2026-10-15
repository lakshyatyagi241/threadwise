import { primaryKey, str, toDate, type Doc } from '../util';

/** The collection, a NUL and the primary key: how the plan names one source document. */
export const docKey = (collection: string, d: Doc): string =>
  collection + String.fromCharCode(0) + primaryKey(d);

/**
 * The small pure rules of the flow step: which node documents the converter (wabo-convert.ts) can use, which version of a bot is
 * "latest", what the conversion loses. Nothing here touches the database.
 */
export const obj = (v: unknown): Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
    ? (v as Doc)
    : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** Characters, not UTF-16 units (an emoji is one): the way WaDesk counted. */
export const clipChars = (v: string, n: number): string => {
  const a = Array.from(v);
  return a.length <= n ? v : a.slice(0, n).join('');
};

/** The subTypes wabo-convert.ts turns into a step; any other node is skipped by it ("Skipped a ... step"). */
export const CONVERTED_SUBTYPES = new Set([
  'text',
  'delay',
  'media',
  'whatsapp-template',
  'share-location',
  'interactive-button-url',
  'interactive-message',
  'flow-list',
  'interactive-message-list',
  'img-file',
  'name',
  'email',
  'number',
  'alphanumeric',
  'textfield',
]);

/** The converter's own test of "this record is a node" (string nodeId, qid and subType). */
export const isNodeShape = (d: Doc): boolean =>
  typeof d.nodeId === 'string' && typeof d.qid === 'string' && typeof d.subType === 'string';
/** The console's built-in opt-in / opt-out messages: the converter leaves them out. */
export const isOptInOut = (qid: string): boolean => /^OPT-(IN|OUT)\b/i.test(qid);

export type NodeVerdict = 'eligible' | 'bad' | 'duplicate' | 'optinout' | 'unsupported';

/** Replays the converter's filter, in file order: the first record of a nodeId wins, opt-in/out flows are dropped. */
export function classifyNodes(docs: Doc[]): Array<{ doc: Doc; verdict: NodeVerdict }> {
  const seen = new Set<string>();
  return docs.map((doc) => {
    if (!isNodeShape(doc)) return { doc, verdict: 'bad' };
    const id = s(doc.nodeId);
    if (seen.has(id)) return { doc, verdict: 'duplicate' };
    if (isOptInOut(s(doc.qid))) return { doc, verdict: 'optinout' };
    seen.add(id);
    return { doc, verdict: CONVERTED_SUBTYPES.has(s(doc.subType)) ? 'eligible' : 'unsupported' };
  });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DISPLAY = /^\s*(\d{1,2}) ([A-Za-z]{3}),? (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?(AM|PM)\s*$/i;
/** The console's display string "dd Mon, yyyy h:mm:ss AM" (day not zero padded, English month, AM/PM, no zone). */
export const isDisplayDate = (v: unknown): boolean => typeof v === 'string' && DISPLAY.test(v);
/**
 * A Waboo date: a Date, an ObjectId, an ISO string, or the display string above. The display string has NO zone: it is read as UTC
 * (never in the machine's zone) and the flow gets the soft issue DATE_ZONE_ASSUMED. Unreadable = null, never a throw.
 */
export function wabooDate(v: unknown): Date | null {
  if (typeof v === 'string') {
    const m = DISPLAY.exec(v);
    if (m) {
      const mon = MONTHS.indexOf(m[2]!.toLowerCase());
      const h = Number(m[4]);
      const day = Number(m[1]);
      if (
        mon < 0 ||
        h < 1 ||
        h > 12 ||
        Number(m[5]) > 59 ||
        Number(m[6]) > 59 ||
        day < 1 ||
        day > 31
      )
        return null;
      const d = new Date(
        Date.UTC(
          Number(m[3]),
          mon,
          day,
          (h % 12) + (m[7]!.toUpperCase() === 'PM' ? 12 : 0),
          Number(m[5]),
          Number(m[6]),
        ),
      );
      return d.getUTCDate() === day ? d : null;
    }
  }
  return toDate(v);
}
const t = (v: unknown): number => wabooDate(v)?.getTime() ?? Number.NEGATIVE_INFINITY;
/** Newest first; a tie goes to the larger document key, so the choice never depends on file order. */
export const newest = (a: Doc, b: Doc, field: string): number =>
  t(b[field]) - t(a[field]) ||
  (primaryKey(a) < primaryKey(b) ? 1 : primaryKey(a) > primaryKey(b) ? -1 : 0);

export const statusOf = (v: Doc): string => (str(v.status) ?? '').toLowerCase();

export interface Candidate {
  kind: 'version' | 'workspace' | 'unversioned' | 'orphan-version';
  versionId: string | null;
  version: Doc | null;
  docs: Doc[];
}

/**
 * The candidates for "the latest version" of one bot, best first, for the policy (spec C Q1). The caller takes the first one that has
 * at least one step the converter can use, and records a soft issue for every candidate it passed over.
 */
export function candidatesFor(
  policy: 'published' | 'draft' | 'newest',
  versions: Doc[],
  data: Doc[],
  workspaceNodes: Doc[],
): { list: Candidate[]; ambiguous: boolean } {
  const byVersion = new Map<string, Doc[]>();
  const loose: Doc[] = [];
  for (const d of data) {
    const v = str(d.version_id);
    if (v === null) loose.push(d);
    else byVersion.set(v, [...(byVersion.get(v) ?? []), d]);
  }
  const known = new Set<string>();
  const ofVersion = (v: Doc): Candidate => {
    const id = str(v.version_id);
    if (id !== null) known.add(id);
    return {
      kind: 'version',
      versionId: id,
      version: v,
      docs: id === null ? [] : (byVersion.get(id) ?? []),
    };
  };
  const published = versions
    .filter((v) => statusOf(v) === 'published')
    .sort((a, b) => newest(a, b, 'publishedAt'));
  const ambiguous =
    published.length > 1 && t(published[0]!.publishedAt) === t(published[1]!.publishedAt);
  const all = [...versions].sort((a, b) => newest(a, b, 'createdAt'));
  const ws: Candidate = { kind: 'workspace', versionId: null, version: null, docs: workspaceNodes };
  const order: Candidate[] = [];
  const pushed = new Set<Doc>();
  const push = (v: Doc | undefined): void => {
    if (v && !pushed.has(v)) {
      pushed.add(v);
      order.push(ofVersion(v));
    }
  };
  if (policy === 'draft') order.push(ws);
  if (policy === 'newest') {
    // newest by the later of createdAt and publishedAt
    for (const v of [...versions].sort((a, b) => {
      const ta = Math.max(t(a.createdAt), t(a.publishedAt));
      const tb = Math.max(t(b.createdAt), t(b.publishedAt));
      return tb - ta || (primaryKey(a) < primaryKey(b) ? 1 : -1);
    }))
      push(v);
  } else {
    push(published[0]);
    for (const v of all) push(v);
  }
  if (policy !== 'draft') order.push(ws);
  // records with no version, then versions the headers do not know
  order.push({ kind: 'unversioned', versionId: null, version: null, docs: loose });
  const orphans = [...byVersion].filter(
    ([id]) => !known.has(id) && !versions.some((v) => str(v.version_id) === id),
  );
  orphans.sort(
    (a, b) =>
      Math.max(...b[1].map((d) => t(d.createdAt))) - Math.max(...a[1].map((d) => t(d.createdAt))) ||
      (a[0] < b[0] ? 1 : -1),
  );
  for (const [id, docs] of orphans)
    order.push({ kind: 'orphan-version', versionId: id, version: null, docs });
  return { list: order, ambiguous };
}

export interface Loss {
  quickActions: number;
  apiActions: number;
  otherActions: number;
  templateVariables: number;
  multiLanguage: number;
  extraResponses: number;
  headers: number;
  liveAgentButtons: number;
  otherButtons: number;
}

/** What the converter does not carry across, counted over the steps it did convert (spec C A.5). */
export function lossOf(eligible: Doc[]): Loss {
  const loss: Loss = {
    quickActions: 0,
    apiActions: 0,
    otherActions: 0,
    templateVariables: 0,
    multiLanguage: 0,
    extraResponses: 0,
    headers: 0,
    liveAgentButtons: 0,
    otherButtons: 0,
  };
  for (const d of eligible) {
    if (arr(d.quickActions).length > 0) loss.quickActions += arr(d.quickActions).length;
    for (const a of arr(d.actions).map(obj)) {
      if (a.type === 'connect_node') continue;
      if (/api/i.test(s(a.type)) || str(a.apiLibraryId) !== null) loss.apiActions += 1;
      else loss.otherActions += 1;
    }
    const resp = arr(d.response);
    if (resp.length > 1) loss.extraResponses += resp.length - 1;
    if (arr(d.languages).length > 0 || d.multi_lingual === true) loss.multiLanguage += 1;
    const first = obj(resp[0]);
    if (d.subType === 'whatsapp-template') {
      const v = obj(first.value);
      if (
        arr(first.variables).length > 0 ||
        arr(first.components).length > 0 ||
        arr(v.variables).length > 0 ||
        arr(v.components).length > 0 ||
        Object.keys(obj(first.variables)).length > 0
      )
        loss.templateVariables += 1;
    }
    const inter = obj(first.interactive);
    if (inter.header) loss.headers += 1;
    for (const b of arr(obj(inter.action).buttons).map(obj)) {
      if (b.type === 'live_agent') loss.liveAgentButtons += 1;
      else if (b.type !== 'flow') loss.otherButtons += 1;
    }
  }
  return loss;
}

export const lossTotal = (l: Loss): number => Object.values(l).reduce((a, b) => a + b, 0);
