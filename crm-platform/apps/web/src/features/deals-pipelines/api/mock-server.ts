import {
  majorToMinor,
  minorToMajor,
  type BoardResponse,
  type DealActivityResponse,
  type DealReportsResponse,
  type DealResponse,
  type DealTotals,
  type LostReasonResponse,
  type PipelineResponse,
  type PipelineStageResponse,
} from '@crm/contracts';
import type { ApiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/**
 * An in-memory stand-in for the deals API, used only when the real endpoints are unreachable on purpose (see `http.ts`).
 * It answers in the wire format of `@crm/contracts` (decimal-string money, nested refs, per-currency totals) on the same
 * routes as the Nest controllers, and enforces the rules the spec gives the server: won/lost derived from the stage, one won
 * and one lost stage per pipeline, deals must be moved before a stage or pipeline is deleted, ordering by neighbours.
 */
type Kind = 'open' | 'won' | 'lost';
type Source = DealResponse['source'];

interface StageRow {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  probability: number;
  kind: Kind;
  rowVersion: number;
}
interface PipelineRow {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  rowVersion: number;
  stages: StageRow[];
}
interface DealRow {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  valueMinor: number;
  currency: string;
  ownerId: string | null;
  contactId: string | null;
  expectedCloseDate: string | null;
  source: Source;
  lostReason: string | null;
  lostReasonId: string | null;
  notes: string | null;
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  rank: number;
}
interface ActivityRow {
  id: string;
  dealId: string;
  type: DealActivityResponse['type'];
  body: string | null;
  dueAt: string | null;
  doneAt: string | null;
  assigneeId: string | null;
  authorId: string | null;
  stageChange: {
    from: { id: string | null; name: string } | null;
    to: { id: string | null; name: string };
  } | null;
  createdAt: string;
}
interface ReasonRow {
  id: string;
  name: string;
  isActive: boolean;
  rowVersion: number;
}
interface Db {
  pipelines: PipelineRow[];
  deals: DealRow[];
  activities: ActivityRow[];
  reasons: ReasonRow[];
  settings: { lostReasonRequired: boolean; rowVersion: number };
  seq: number;
}

const MEMBERS = [
  { id: 'a0000000-0000-4000-8000-000000000001', fullName: 'Nachiket Challawar' },
  { id: 'a0000000-0000-4000-8000-000000000002', fullName: 'Sara Haddad' },
  { id: 'a0000000-0000-4000-8000-000000000003', fullName: 'Omar Farouk' },
];
const CONTACTS = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Ana Lopez',
    phone: '+34911222333',
    email: 'ana@example.com',
  },
  {
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Bilal Khan',
    phone: '+971501234567',
    email: null,
  },
  {
    id: 'b0000000-0000-4000-8000-000000000003',
    name: 'Chen Wei',
    phone: '+8613800138000',
    email: null,
  },
  {
    id: 'b0000000-0000-4000-8000-000000000004',
    name: 'Dana Whitfield',
    phone: '+14155550123',
    email: 'dana@example.com',
  },
  {
    id: 'b0000000-0000-4000-8000-000000000005',
    name: 'Eli Cohen',
    phone: '+972501112222',
    email: null,
  },
];
const USD_PER: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, AED: 0.2723, INR: 0.012 };

let db: Db | null = null;
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const uuid = () => crypto.randomUUID();

const mkStage = (
  pipelineId: string,
  name: string,
  color: string,
  probability: number,
  kind: Kind,
): StageRow => ({ id: uuid(), pipelineId, name, color, probability, kind, rowVersion: 1 });

function seed(): Db {
  const mainId = uuid();
  const partnersId = uuid();
  const main: PipelineRow = {
    id: mainId,
    name: 'Sales Pipeline',
    currency: 'USD',
    isDefault: true,
    rowVersion: 1,
    stages: [
      mkStage(mainId, 'New Lead', '#64748B', 10, 'open'),
      mkStage(mainId, 'Qualified', '#0EA5E9', 25, 'open'),
      mkStage(mainId, 'Proposal', '#6366F1', 50, 'open'),
      mkStage(mainId, 'Negotiation', '#F59E0B', 75, 'open'),
      mkStage(mainId, 'Won', '#16A34A', 100, 'won'),
      mkStage(mainId, 'Lost', '#DC2626', 0, 'lost'),
    ],
  };
  const partners: PipelineRow = {
    id: partnersId,
    name: 'Partnerships',
    currency: 'EUR',
    isDefault: false,
    rowVersion: 1,
    stages: [
      mkStage(partnersId, 'Intro call', '#0EA5E9', 20, 'open'),
      mkStage(partnersId, 'Pilot', '#F59E0B', 60, 'open'),
      mkStage(partnersId, 'Signed', '#16A34A', 100, 'won'),
      mkStage(partnersId, 'Declined', '#DC2626', 0, 'lost'),
    ],
  };
  const titles = [
    'Acme annual plan',
    'Beta Corp onboarding',
    'Northwind renewal',
    'Globex expansion',
    'Initech pilot',
    'Umbrella support contract',
    'Stark Industries rollout',
    'Wayne Enterprises CRM',
    'Hooli seats upgrade',
    'Pied Piper licences',
    'Soylent migration',
    'Vandelay import deal',
    'Cyberdyne audit',
    'Tyrell onboarding',
    'Massive Dynamic POC',
    'Oscorp bulk order',
    'Gringotts treasury suite',
    'Duff beverages campaign',
    'Wonka factory CRM',
    'Dunder Mifflin paper deal',
    'Sterling Cooper retainer',
    'Prestige Worldwide',
    'Monsters Inc support',
    'Aperture science lab',
    'Los Pollos supply',
    'Bluth Company housing',
    'Krusty Krab POS',
    'Planet Express fleet',
    'Rekall memory plan',
    'Tessier-Ashpool vault',
  ];
  const sources: Source[] = [
    'manual',
    'inbox',
    'order',
    'form',
    'api',
    'flow',
    'facebook',
    'shopify',
  ];
  const deals: DealRow[] = titles.map((title, i) => {
    const st = main.stages[i % 6]!;
    const created = -(i * 3 + 1);
    return {
      id: uuid(),
      title,
      pipelineId: main.id,
      stageId: st.id,
      valueMinor: (1 + ((i * 7) % 19)) * 25_000 + (i % 3) * 1_050,
      currency: i % 7 === 6 ? 'EUR' : 'USD',
      ownerId: i % 5 === 4 ? null : MEMBERS[i % 3]!.id,
      contactId: i % 4 === 3 ? null : CONTACTS[i % 5]!.id,
      expectedCloseDate:
        i % 3 === 0 ? iso(7 + i).slice(0, 10) : i % 6 === 1 ? iso(-3).slice(0, 10) : null,
      source: sources[i % sources.length]!,
      lostReason: st.kind === 'lost' ? 'Price too high' : null,
      lostReasonId: null,
      notes: null,
      wonAt: st.kind === 'won' ? iso(-(i % 120)) : null,
      lostAt: st.kind === 'lost' ? iso(-(i % 90)) : null,
      createdAt: iso(created),
      updatedAt: iso(created),
      rowVersion: 1,
      rank: i * 1000,
    };
  });
  deals.push({
    ...deals[0]!,
    id: uuid(),
    title: 'Reseller agreement Gulf',
    pipelineId: partners.id,
    stageId: partners.stages[1]!.id,
    currency: 'EUR',
    valueMinor: 480_000,
    wonAt: null,
    lostAt: null,
    lostReason: null,
    rank: 0,
  });
  const out: Db = {
    pipelines: [main, partners],
    deals,
    activities: [],
    reasons: [
      { id: uuid(), name: 'Price too high', isActive: true, rowVersion: 1 },
      { id: uuid(), name: 'Chose a competitor', isActive: true, rowVersion: 1 },
      { id: uuid(), name: 'No budget', isActive: true, rowVersion: 1 },
      { id: uuid(), name: 'No response', isActive: true, rowVersion: 1 },
      { id: uuid(), name: 'Bad timing', isActive: false, rowVersion: 1 },
    ],
    settings: { lostReasonRequired: true, rowVersion: 1 },
    seq: 1,
  };
  out.activities.push(
    {
      id: uuid(),
      dealId: deals[0]!.id,
      type: 'task',
      body: 'Send the revised quote',
      dueAt: iso(1),
      doneAt: null,
      assigneeId: MEMBERS[1]!.id,
      authorId: MEMBERS[1]!.id,
      stageChange: null,
      createdAt: iso(-2),
    },
    {
      id: uuid(),
      dealId: deals[0]!.id,
      type: 'note',
      body: 'Asked for a 10% discount if we sign this quarter.',
      dueAt: null,
      doneAt: null,
      assigneeId: null,
      authorId: MEMBERS[0]!.id,
      stageChange: null,
      createdAt: iso(-3),
    },
    {
      id: uuid(),
      dealId: deals[1]!.id,
      type: 'task',
      body: 'Call back about the contract',
      dueAt: iso(-2),
      doneAt: null,
      assigneeId: MEMBERS[2]!.id,
      authorId: MEMBERS[2]!.id,
      stageChange: null,
      createdAt: iso(-6),
    },
  );
  return out;
}

const get = (): Db => (db ??= seed());

const err = (
  status: number,
  code: string,
  message: string,
  fields: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, message, 'mock-request', fields);

const pipelineOf = (id: string) => {
  const p = get().pipelines.find((x) => x.id === id);
  if (!p) throw err(404, 'NOT_FOUND', 'Pipeline not found');
  return p;
};
const dealOf = (id: string) => {
  const d = get().deals.find((x) => x.id === id);
  if (!d) throw err(404, 'NOT_FOUND', 'Deal not found');
  return d;
};
const stageOfPipeline = (p: PipelineRow, id: string) => {
  const s = p.stages.find((x) => x.id === id);
  if (!s)
    throw err(422, 'DEAL_STAGE_MISMATCH', 'The stage belongs to another pipeline', [
      { path: 'stageId', message: 'invalid' },
    ]);
  return s;
};
const findStage = (id: string) => {
  for (const p of get().pipelines) {
    const s = p.stages.find((x) => x.id === id);
    if (s) return { pipeline: p, stage: s };
  }
  throw err(404, 'NOT_FOUND', 'Stage not found');
};
const stageOf = (d: DealRow) => findStage(d.stageId).stage;
const member = (id: string | null) => MEMBERS.find((m) => m.id === id) ?? null;
const ref = (id: string | null) => {
  const m = member(id);
  return m ? { id: m.id, name: m.fullName } : null;
};

const convert = (minor: number, from: string, to: string) =>
  Math.round((minor * (USD_PER[from] ?? 1)) / (USD_PER[to] ?? 1));

const money = (minor: number, currency: string) => ({
  currency,
  amount: minorToMajor(BigInt(minor), currency),
});

function totals(rows: DealRow[], convertTo?: string, factor = (_: DealRow) => 1): DealTotals {
  const by = new Map<string, number>();
  let conv = 0;
  for (const r of rows) {
    const v = Math.round(r.valueMinor * factor(r));
    by.set(r.currency, (by.get(r.currency) ?? 0) + v);
    if (convertTo) conv += convert(v, r.currency, convertTo);
  }
  return {
    byCurrency: [...by.entries()].map(([c, n]) => money(n, c)),
    ...(convertTo ? { converted: money(conv, convertTo), unconverted: [] } : {}),
  };
}

const syncCounts = () => {
  const d = get();
  return (stageId: string) => d.deals.filter((x) => x.stageId === stageId).length;
};

function stageResponse(s: StageRow, order: number, count: number): PipelineStageResponse {
  return {
    id: s.id,
    pipelineId: s.pipelineId,
    name: s.name,
    color: s.color,
    probability: s.probability,
    kind: s.kind,
    sortOrder: order,
    dealCount: count,
    rowVersion: s.rowVersion,
    createdAt: iso(-30),
    updatedAt: iso(-1),
  };
}

function pipelineResponse(p: PipelineRow): PipelineResponse {
  const count = syncCounts();
  return {
    id: p.id,
    name: p.name,
    currency: p.currency,
    isDefault: p.isDefault,
    sortOrder: get().pipelines.indexOf(p),
    stages: p.stages.map((s, i) => stageResponse(s, i, count(s.id))),
    dealCount: get().deals.filter((d) => d.pipelineId === p.id).length,
    rowVersion: p.rowVersion,
    createdAt: iso(-30),
    updatedAt: iso(-1),
  };
}

function dealResponse(d: DealRow): DealResponse {
  const p = pipelineOf(d.pipelineId);
  const s = stageOf(d);
  const contact = CONTACTS.find((c) => c.id === d.contactId) ?? null;
  return {
    id: d.id,
    title: d.title,
    pipeline: { id: p.id, name: p.name },
    stage: { id: s.id, name: s.name, color: s.color, probability: s.probability, kind: s.kind },
    status: s.kind,
    value: minorToMajor(BigInt(d.valueMinor), d.currency),
    currency: d.currency,
    owner: ref(d.ownerId),
    contact: contact
      ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email }
      : null,
    company: null,
    expectedCloseDate: d.expectedCloseDate,
    source: d.source,
    lostReason: d.lostReason,
    lostReasonId: d.lostReasonId,
    notes: d.notes,
    wonAt: d.wonAt,
    lostAt: d.lostAt,
    rowVersion: d.rowVersion,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function settle(d: DealRow, st: StageRow, lost?: { text: string | null; id: string | null }) {
  d.stageId = st.id;
  d.wonAt = st.kind === 'won' ? (d.wonAt ?? new Date().toISOString()) : null;
  d.lostAt = st.kind === 'lost' ? (d.lostAt ?? new Date().toISOString()) : null;
  if (st.kind === 'open') {
    d.lostReason = null;
    d.lostReasonId = null;
  }
  if (st.kind === 'lost' && lost) {
    d.lostReason = lost.text;
    d.lostReasonId = lost.id;
  }
}

function log(d: DealRow, from: StageRow | null, to: StageRow) {
  get().activities.push({
    id: uuid(),
    dealId: d.id,
    type: 'stage_change',
    body: null,
    dueAt: null,
    doneAt: null,
    assigneeId: null,
    authorId: MEMBERS[0]!.id,
    stageChange: {
      from: from ? { id: from.id, name: from.name } : null,
      to: { id: to.id, name: to.name },
    },
    createdAt: new Date().toISOString(),
  });
}

function activityResponse(a: ActivityRow): DealActivityResponse {
  return {
    id: a.id,
    dealId: a.dealId,
    type: a.type,
    body: a.body,
    dueAt: a.dueAt,
    doneAt: a.doneAt,
    done: a.doneAt !== null,
    assignee: ref(a.assigneeId),
    author: ref(a.authorId),
    stageChange: a.stageChange,
    rowVersion: 1,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
  };
}

function reasonResponse(r: ReasonRow, i: number): LostReasonResponse {
  return {
    id: r.id,
    name: r.name,
    sortOrder: i,
    isActive: r.isActive,
    dealCount: get().deals.filter((d) => d.lostReasonId === r.id).length,
    rowVersion: r.rowVersion,
    createdAt: iso(-30),
    updatedAt: iso(-1),
  };
}

function filtered(q: URLSearchParams, pipelineId: string | null) {
  const needle = (q.get('q') ?? '').toLowerCase();
  return get().deals.filter((d) => {
    if (pipelineId && d.pipelineId !== pipelineId) return false;
    if (needle && !d.title.toLowerCase().includes(needle)) return false;
    if (q.get('unassigned') === 'true' && d.ownerId) return false;
    const owner = q.get('ownerId');
    if (owner && d.ownerId !== owner) return false;
    if (q.get('source') && d.source !== q.get('source')) return false;
    if (q.get('status') && stageOf(d).kind !== q.get('status')) return false;
    if (q.get('stageId') && d.stageId !== q.get('stageId')) return false;
    return true;
  });
}

function paged<T>(items: T[], q: URLSearchParams) {
  const limit = Math.min(200, Number(q.get('limit') ?? 50) || 50);
  const offset = Number(q.get('cursor') ?? 0) || 0;
  const more = offset + limit < items.length;
  return {
    data: items.slice(offset, offset + limit),
    page: { nextCursor: more ? String(offset + limit) : null, hasMore: more, limit },
  };
}

const byRank = (a: DealRow, b: DealRow) => a.rank - b.rank;

function board(q: URLSearchParams): BoardResponse {
  const d = get();
  const p = q.get('pipelineId')
    ? pipelineOf(q.get('pipelineId')!)
    : (d.pipelines.find((x) => x.isDefault) ?? d.pipelines[0]!);
  const convertTo = q.get('convertTo') ?? p.currency;
  const narrowed = filtered(q, p.id);
  const all = d.deals.filter((x) => x.pipelineId === p.id);
  const limit = Number(q.get('limit') ?? 25) || 25;
  const stages = p.stages.map((s, i) => {
    const rows = narrowed.filter((x) => x.stageId === s.id).sort(byRank);
    const more = rows.length > limit;
    return {
      stage: {
        id: s.id,
        name: s.name,
        color: s.color,
        probability: s.probability,
        kind: s.kind,
        sortOrder: i,
      },
      count: rows.length,
      total: totals(rows, convertTo),
      weighted:
        s.kind === 'open' ? totals(rows, convertTo, () => s.probability / 100) : { byCurrency: [] },
      deals: rows.slice(0, limit).map(dealResponse),
      page: { nextCursor: more ? String(limit) : null, hasMore: more, limit },
    };
  });
  const open = all.filter((x) => stageOf(x).kind === 'open');
  const won = all.filter((x) => stageOf(x).kind === 'won');
  const lost = all.filter((x) => stageOf(x).kind === 'lost');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return {
    pipeline: { id: p.id, name: p.name, currency: p.currency, isDefault: p.isDefault },
    stages,
    kpis: {
      openCount: open.length,
      openValue: totals(open, convertTo),
      forecast: totals(open, convertTo, (x) => stageOf(x).probability / 100),
      wonThisMonthCount: won.filter((x) => x.wonAt && new Date(x.wonAt) >= monthStart).length,
      wonThisMonthValue: totals(
        won.filter((x) => x.wonAt && new Date(x.wonAt) >= monthStart),
        convertTo,
      ),
      winRate:
        won.length + lost.length === 0
          ? 0
          : Math.round((won.length / (won.length + lost.length)) * 100),
    },
  };
}

function report(q: URLSearchParams): DealReportsResponse {
  const d = get();
  const pid = q.get('pipelineId');
  const rows = d.deals.filter((x) => !pid || x.pipelineId === pid);
  const convertTo = q.get('convertTo') ?? 'USD';
  const from = q.get('from');
  const to = q.get('to');
  const inRange = (at: string | null) =>
    !!at && (!from || at.slice(0, 10) >= from) && (!to || at.slice(0, 10) <= to);
  const open = rows.filter((x) => stageOf(x).kind === 'open');
  const won = rows.filter((x) => stageOf(x).kind === 'won' && inRange(x.wonAt));
  const lost = rows.filter((x) => stageOf(x).kind === 'lost' && inRange(x.lostAt));
  const stageSet = pid ? pipelineOf(pid).stages : d.pipelines.flatMap((p) => p.stages);
  const end = to ? new Date(`${to}T00:00:00`) : new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(end.getFullYear(), end.getMonth() - (5 - i), 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const w = rows.filter((x) => stageOf(x).kind === 'won' && x.wonAt?.slice(0, 7) === key);
    return {
      month: key,
      wonCount: w.length,
      wonValue: totals(w, convertTo),
      lostCount: rows.filter((x) => stageOf(x).kind === 'lost' && x.lostAt?.slice(0, 7) === key)
        .length,
    };
  });
  const byOwner = new Map<string, DealRow[]>();
  for (const w of won)
    if (w.ownerId) byOwner.set(w.ownerId, [...(byOwner.get(w.ownerId) ?? []), w]);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const reasons = new Map<string, number>();
  for (const l of lost) reasons.set(l.lostReason ?? '', (reasons.get(l.lostReason ?? '') ?? 0) + 1);
  const monthWon = rows.filter(
    (x) => stageOf(x).kind === 'won' && x.wonAt && new Date(x.wonAt) >= monthStart,
  );
  return {
    timezone: 'UTC',
    convertedTo: convertTo,
    open: {
      count: open.length,
      value: totals(open, convertTo),
      forecast: totals(open, convertTo, (x) => stageOf(x).probability / 100),
    },
    won: {
      count: won.length,
      value: totals(won, convertTo),
      thisMonth: { count: monthWon.length, value: totals(monthWon, convertTo) },
      avgDaysToClose: won.length
        ? Math.round(
            won.reduce(
              (n, x) => n + (new Date(x.wonAt!).getTime() - new Date(x.createdAt).getTime()) / DAY,
              0,
            ) / won.length,
          )
        : null,
    },
    lost: { count: lost.length, value: totals(lost, convertTo) },
    winRate:
      won.length + lost.length === 0
        ? 0
        : Math.round((won.length / (won.length + lost.length)) * 100),
    byStage: stageSet.map((s) => {
      const inStage = open.filter((x) => x.stageId === s.id);
      return {
        stageId: s.id,
        pipelineId: s.pipelineId,
        name: s.name,
        color: s.color,
        kind: s.kind,
        probability: s.probability,
        count: inStage.length,
        value: totals(inStage, convertTo),
        weighted: totals(inStage, convertTo, () => s.probability / 100),
      };
    }),
    months,
    leaders: [...byOwner.entries()]
      .map(([id, list]) => ({
        owner: ref(id)!,
        wonCount: list.length,
        value: totals(list, convertTo),
      }))
      .sort(
        (a, b) => Number(b.value.converted?.amount ?? 0) - Number(a.value.converted?.amount ?? 0),
      )
      .slice(0, 10),
    lostReasons: [...reasons.entries()].map(([reason, count]) => ({
      reason: reason || null,
      count,
    })),
  };
}

function rankBetween(
  stageId: string,
  dealId: string,
  before: string | null,
  after: string | null,
): number {
  const others = get()
    .deals.filter((x) => x.stageId === stageId && x.id !== dealId)
    .sort(byRank);
  const b = before ? others.find((x) => x.id === before) : undefined;
  const a = after ? others.find((x) => x.id === after) : undefined;
  if (b) {
    const i = others.indexOf(b);
    const prev = others[i - 1];
    return prev ? (prev.rank + b.rank) / 2 : b.rank - 1000;
  }
  if (a) {
    const i = others.indexOf(a);
    const next = others[i + 1];
    return next ? (a.rank + next.rank) / 2 : a.rank + 1000;
  }
  return others[0] ? others[0].rank - 1000 : 0;
}

function parseValue(value: unknown, currency: string): number {
  const m = majorToMinor(String(value), currency);
  if (m === null)
    throw err(422, 'DEAL_VALUE_INVALID', 'Invalid value', [{ path: 'value', message: 'invalid' }]);
  return Number(m);
}

type Body = Record<string, unknown>;

function handle(method: string, path: string, q: URLSearchParams, body: Body): unknown {
  const d = get();
  let m: RegExpMatchArray | null;

  if (path === '/users' && method === 'GET') return paged(MEMBERS, q);
  if (path === '/contacts' && method === 'GET') {
    const needle = (q.get('q') ?? '').toLowerCase();
    return paged(
      CONTACTS.filter((c) => !needle || `${c.name} ${c.phone}`.toLowerCase().includes(needle)),
      q,
    );
  }

  // --- pipelines and stages -------------------------------------------------------------------------------------------
  if (path === '/pipelines' && method === 'GET') return d.pipelines.map(pipelineResponse);
  if (path === '/pipelines' && method === 'POST') {
    const name = String(body.name ?? '').trim();
    if (!name)
      throw err(422, 'VALIDATION_FAILED', 'Invalid', [{ path: 'name', message: 'required' }]);
    if (d.pipelines.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      throw err(409, 'DEAL_PIPELINE_NAME_TAKEN', 'Name taken');
    }
    const id = uuid();
    const p: PipelineRow = {
      id,
      name,
      currency: String(body.currency ?? 'USD'),
      isDefault: body.isDefault === true,
      rowVersion: 1,
      stages: [
        mkStage(id, 'New Lead', '#64748B', 10, 'open'),
        mkStage(id, 'Qualified', '#0EA5E9', 25, 'open'),
        mkStage(id, 'Won', '#16A34A', 100, 'won'),
        mkStage(id, 'Lost', '#DC2626', 0, 'lost'),
      ],
    };
    if (p.isDefault) for (const x of d.pipelines) x.isDefault = false;
    d.pipelines.push(p);
    return pipelineResponse(p);
  }
  if ((m = path.match(/^\/pipelines\/([^/]+)$/))) {
    const p = pipelineOf(m[1]!);
    if (method === 'PATCH') {
      if (body.rowVersion !== p.rowVersion)
        throw err(409, 'ROW_VERSION_CONFLICT', 'Changed by someone else');
      if (typeof body.name === 'string' && body.name.trim()) p.name = body.name.trim();
      if (typeof body.currency === 'string') p.currency = body.currency;
      if (body.isDefault === true) for (const x of d.pipelines) x.isDefault = x.id === p.id;
      p.rowVersion++;
      return pipelineResponse(p);
    }
    if (method === 'DELETE') {
      if (p.isDefault) throw err(409, 'DEAL_PIPELINE_DEFAULT_PROTECTED', 'Default pipeline');
      const rows = d.deals.filter((x) => x.pipelineId === p.id);
      const target = q.get('moveDealsToPipelineId');
      if (rows.length > 0 && !target)
        throw err(409, 'DEAL_PIPELINE_HAS_DEALS', 'Pipeline has deals');
      if (target) {
        const t = pipelineOf(target);
        for (const x of rows) {
          const kind = stageOf(x).kind;
          const st = t.stages.find((s) => s.kind === kind) ?? t.stages[0]!;
          x.pipelineId = t.id;
          settle(x, st);
        }
      }
      d.pipelines = d.pipelines.filter((x) => x.id !== p.id);
      return undefined;
    }
    if (method === 'GET') return pipelineResponse(p);
  }
  if ((m = path.match(/^\/pipelines\/([^/]+)\/stages$/)) && method === 'POST') {
    const p = pipelineOf(m[1]!);
    const kind = (body.kind as Kind | undefined) ?? 'open';
    if (kind !== 'open' && p.stages.some((s) => s.kind === kind))
      throw err(409, 'DEAL_STAGE_KIND_TAKEN', 'One per pipeline');
    const name = String(body.name ?? '').trim();
    if (p.stages.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      throw err(409, 'DEAL_STAGE_NAME_TAKEN', 'Name taken');
    const s = mkStage(
      p.id,
      name,
      String(body.color ?? '#64748B'),
      kind === 'won' ? 100 : kind === 'lost' ? 0 : Number(body.probability ?? 0),
      kind,
    );
    const firstClosing = p.stages.findIndex((x) => x.kind !== 'open');
    p.stages.splice(kind === 'open' && firstClosing !== -1 ? firstClosing : p.stages.length, 0, s);
    return stageResponse(s, p.stages.indexOf(s), 0);
  }
  if ((m = path.match(/^\/pipelines\/([^/]+)\/stages\/order$/)) && method === 'PUT') {
    const p = pipelineOf(m[1]!);
    const ids = body.stageIds as string[];
    if (ids.length !== p.stages.length)
      throw err(422, 'DEAL_ORDER_INVALID', 'Send every stage once');
    p.stages = ids.map((id) => stageOfPipeline(p, id));
    return pipelineResponse(p);
  }
  if ((m = path.match(/^\/pipeline-stages\/([^/]+)$/))) {
    const { pipeline: p, stage: s } = findStage(m[1]!);
    if (method === 'PATCH') {
      if (body.rowVersion !== s.rowVersion)
        throw err(409, 'ROW_VERSION_CONFLICT', 'Changed by someone else');
      const kind = (body.kind as Kind | undefined) ?? s.kind;
      const count = d.deals.filter((x) => x.stageId === s.id).length;
      if (kind !== s.kind && count > 0)
        throw err(409, 'DEAL_STAGE_HAS_DEALS', 'Only an empty stage can change kind');
      if (kind !== 'open' && p.stages.some((x) => x.id !== s.id && x.kind === kind)) {
        throw err(409, 'DEAL_STAGE_KIND_TAKEN', 'One per pipeline');
      }
      if (typeof body.name === 'string' && body.name.trim()) s.name = body.name.trim();
      if (typeof body.color === 'string') s.color = body.color;
      s.kind = kind;
      s.probability =
        kind === 'won' ? 100 : kind === 'lost' ? 0 : Number(body.probability ?? s.probability);
      s.rowVersion++;
      return stageResponse(s, p.stages.indexOf(s), count);
    }
    if (method === 'DELETE') {
      if (p.stages.length === 1) throw err(409, 'DEAL_STAGE_LAST', 'Last stage');
      const rows = d.deals.filter((x) => x.stageId === s.id);
      const to = q.get('moveDealsToStageId');
      if (rows.length > 0 && !to) throw err(409, 'DEAL_STAGE_HAS_DEALS', 'Stage has deals');
      if (to) {
        const target = stageOfPipeline(p, to);
        for (const x of rows) {
          settle(x, target);
          x.rank = rankBetween(target.id, x.id, null, null);
        }
      }
      p.stages = p.stages.filter((x) => x.id !== s.id);
      return undefined;
    }
  }

  // --- lost reasons and settings --------------------------------------------------------------------------------------
  if (path === '/deal-lost-reasons' && method === 'GET') {
    const rows = q.get('activeOnly') === 'true' ? d.reasons.filter((r) => r.isActive) : d.reasons;
    return rows.map((r) => reasonResponse(r, d.reasons.indexOf(r)));
  }
  if (path === '/deal-lost-reasons' && method === 'POST') {
    const name = String(body.name ?? '').trim();
    if (d.reasons.some((r) => r.name.toLowerCase() === name.toLowerCase()))
      throw err(409, 'DEAL_LOST_REASON_NAME_TAKEN', 'Name taken');
    const r: ReasonRow = { id: uuid(), name, isActive: true, rowVersion: 1 };
    d.reasons.push(r);
    return reasonResponse(r, d.reasons.length - 1);
  }
  if (path === '/deal-lost-reasons/order' && method === 'PUT') {
    const ids = body.reasonIds as string[];
    d.reasons = ids.map((id) => d.reasons.find((r) => r.id === id)!);
    return d.reasons.map((r, i) => reasonResponse(r, i));
  }
  if ((m = path.match(/^\/deal-lost-reasons\/([^/]+)$/))) {
    const r = d.reasons.find((x) => x.id === m![1]);
    if (!r) throw err(404, 'NOT_FOUND', 'Reason not found');
    if (method === 'PATCH') {
      if (body.rowVersion !== r.rowVersion)
        throw err(409, 'ROW_VERSION_CONFLICT', 'Changed by someone else');
      if (typeof body.name === 'string' && body.name.trim()) r.name = body.name.trim();
      if (typeof body.isActive === 'boolean') r.isActive = body.isActive;
      r.rowVersion++;
      return reasonResponse(r, d.reasons.indexOf(r));
    }
    if (method === 'DELETE') {
      d.reasons = d.reasons.filter((x) => x.id !== r.id);
      return undefined;
    }
  }
  if (path === '/deal-settings') {
    if (method === 'PUT') {
      d.settings = {
        lostReasonRequired: body.lostReasonRequired === true,
        rowVersion: d.settings.rowVersion + 1,
      };
    }
    return d.settings;
  }

  // --- deals -----------------------------------------------------------------------------------------------------------
  if (path === '/deals/board' && method === 'GET') return board(q);
  if ((m = path.match(/^\/deals\/board\/stages\/([^/]+)\/deals$/)) && method === 'GET') {
    q.set('stageId', m[1]!);
    const rows = filtered(q, null).sort(byRank);
    const out = paged(rows, q);
    return { data: out.data.map(dealResponse), page: out.page };
  }
  if (path === '/deals/reports' && method === 'GET') return report(q);
  if (path === '/deals' && method === 'GET') {
    const rows = filtered(q, q.get('pipelineId')).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const out = paged(rows, q);
    return { data: out.data.map(dealResponse), page: out.page };
  }
  if (path === '/deals' && method === 'POST') {
    const p = body.pipelineId
      ? pipelineOf(String(body.pipelineId))
      : (d.pipelines.find((x) => x.isDefault) ?? d.pipelines[0]!);
    const title = String(body.title ?? '').trim();
    if (!title)
      throw err(422, 'VALIDATION_FAILED', 'Invalid', [{ path: 'title', message: 'required' }]);
    const st = body.stageId ? stageOfPipeline(p, String(body.stageId)) : p.stages[0]!;
    const currency = String(body.currency ?? p.currency);
    const ownerId = 'ownerId' in body ? ((body.ownerId as string | null) ?? null) : MEMBERS[0]!.id;
    if (ownerId && !member(ownerId)) throw err(422, 'DEAL_OWNER_INVALID', 'Owner is not a member');
    const now = new Date().toISOString();
    const row: DealRow = {
      id: uuid(),
      title,
      pipelineId: p.id,
      stageId: st.id,
      valueMinor: body.value ? parseValue(body.value, currency) : 0,
      currency,
      ownerId,
      contactId: (body.contactId as string | null | undefined) ?? null,
      expectedCloseDate: (body.expectedCloseDate as string | null | undefined) ?? null,
      source: 'manual',
      lostReason: null,
      lostReasonId: null,
      notes: null,
      wonAt: null,
      lostAt: null,
      createdAt: now,
      updatedAt: now,
      rowVersion: 1,
      rank: rankBetween(st.id, '', null, null),
    };
    settle(row, st);
    d.deals.push(row);
    log(row, null, st);
    return dealResponse(row);
  }
  if ((m = path.match(/^\/deals\/([^/]+)$/))) {
    const deal = dealOf(m[1]!);
    if (method === 'GET') return dealResponse(deal);
    if (method === 'PATCH') {
      if (body.rowVersion !== deal.rowVersion)
        throw err(409, 'ROW_VERSION_CONFLICT', 'Changed by someone else');
      if (typeof body.title === 'string' && body.title.trim()) deal.title = body.title.trim();
      const currency = typeof body.currency === 'string' ? body.currency : deal.currency;
      if (typeof body.currency === 'string' && body.currency !== deal.currency && !body.value) {
        throw err(422, 'DEAL_VALUE_INVALID', 'A new currency needs the value with it');
      }
      if (typeof body.value === 'string') deal.valueMinor = parseValue(body.value, currency);
      deal.currency = currency;
      if ('ownerId' in body) {
        const id = (body.ownerId as string | null) ?? null;
        if (id && !member(id)) throw err(422, 'DEAL_OWNER_INVALID', 'Owner is not a member');
        deal.ownerId = id;
      }
      if ('contactId' in body) deal.contactId = (body.contactId as string | null) ?? null;
      if ('expectedCloseDate' in body)
        deal.expectedCloseDate = (body.expectedCloseDate as string | null) ?? null;
      deal.rowVersion++;
      deal.updatedAt = new Date().toISOString();
      return dealResponse(deal);
    }
    if (method === 'DELETE') {
      d.deals = d.deals.filter((x) => x.id !== deal.id);
      d.activities = d.activities.filter((a) => a.dealId !== deal.id);
      return undefined;
    }
  }
  if ((m = path.match(/^\/deals\/([^/]+)\/stage$/)) && method === 'PATCH') {
    const deal = dealOf(m[1]!);
    const p = pipelineOf(deal.pipelineId);
    const to = stageOfPipeline(p, String(body.stageId));
    const from = stageOf(deal);
    if (to.kind === 'lost' && from.kind !== 'lost') {
      const named = d.reasons.find((r) => r.id === body.lostReasonId);
      const text =
        named?.name ??
        (typeof body.lostReason === 'string' ? body.lostReason.trim().slice(0, 191) : '');
      if (d.settings.lostReasonRequired && !text) {
        throw err(422, 'DEAL_LOST_REASON_REQUIRED', 'A reason is required', [
          { path: 'lostReason', message: 'required' },
        ]);
      }
      deal.rank = rankBetween(
        to.id,
        deal.id,
        (body.beforeDealId as string) ?? null,
        (body.afterDealId as string) ?? null,
      );
      log(deal, from, to);
      settle(deal, to, { text: text || null, id: named?.id ?? null });
    } else {
      deal.rank = rankBetween(
        to.id,
        deal.id,
        (body.beforeDealId as string) ?? null,
        (body.afterDealId as string) ?? null,
      );
      if (from.id !== to.id) log(deal, from, to);
      settle(deal, to);
    }
    deal.rowVersion++;
    deal.updatedAt = new Date().toISOString();
    return dealResponse(deal);
  }
  if ((m = path.match(/^\/deals\/([^/]+)\/activities$/))) {
    const deal = dealOf(m[1]!);
    if (method === 'GET') {
      const list = d.activities
        .filter((a) => a.dealId === deal.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const out = paged(list, q);
      return { data: out.data.map(activityResponse), page: out.page };
    }
    if (method === 'POST') {
      const type = body.type as ActivityRow['type'];
      const text = String(body.body ?? '').trim();
      if (!text)
        throw err(422, 'VALIDATION_FAILED', 'Invalid', [{ path: 'body', message: 'required' }]);
      if (type !== 'task' && body.dueAt)
        throw err(422, 'VALIDATION_FAILED', 'Invalid', [{ path: 'dueAt', message: 'tasks only' }]);
      const a: ActivityRow = {
        id: uuid(),
        dealId: deal.id,
        type,
        body: text,
        dueAt: type === 'task' ? ((body.dueAt as string | undefined) ?? null) : null,
        doneAt: null,
        assigneeId: type === 'task' ? MEMBERS[0]!.id : null,
        authorId: MEMBERS[0]!.id,
        stageChange: null,
        createdAt: new Date().toISOString(),
      };
      d.activities.push(a);
      return activityResponse(a);
    }
  }
  if (
    (m = path.match(/^\/deals\/([^/]+)\/activities\/([^/]+)\/(complete|reopen)$/)) &&
    method === 'POST'
  ) {
    const deal = dealOf(m[1]!);
    const a = d.activities.find((x) => x.id === m![2] && x.dealId === deal.id && x.type === 'task');
    if (!a) throw err(404, 'DEAL_TASK_NOT_FOUND', 'Task not found');
    a.doneAt = m[3] === 'complete' ? (a.doneAt ?? new Date().toISOString()) : null;
    return activityResponse(a);
  }

  throw err(404, 'NOT_FOUND', `No mock for ${method} ${path}`);
}

export async function mockCall<T>(path: string, req: ApiRequest<T>): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {}))
    if (v !== undefined && v !== '') q.set(k, String(v));
  const body = JSON.parse(JSON.stringify(req.body ?? {})) as Body;
  const out = handle(req.method ?? 'GET', path, q, body);
  const json: unknown = out === undefined ? undefined : JSON.parse(JSON.stringify(out));
  return (req.schema ? req.schema.parse(json) : (undefined as T)) as T;
}

/** For tests and the dev switch: start again from the seed data. */
export function resetMock(): void {
  db = null;
}
