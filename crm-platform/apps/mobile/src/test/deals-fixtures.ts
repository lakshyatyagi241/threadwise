import type {
  AssigneeResponse,
  BoardResponse,
  BoardStageResponse,
  ContactSelectItem,
  DealActivityResponse,
  DealResponse,
  DealStageRef,
  LostReasonResponse,
  SessionResponse,
} from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the deals endpoints, for tests. Fake names and amounts only. */

export const PIPELINE_ID = 'a1111111-1111-4111-8111-111111111111';

const stage = (
  n: number,
  name: string,
  color: string,
  probability: number,
  kind: DealStageRef['kind'],
): DealStageRef => ({
  id: `b${n}111111-1111-4111-8111-111111111111`,
  name,
  color,
  probability,
  kind,
});

export const stageNew = stage(1, 'New Lead', '#6366F1', 10, 'open');
export const stageProposal = stage(2, 'Proposal', '#F59E0B', 50, 'open');
export const stageWon = stage(3, 'Won', '#22C55E', 100, 'won');
export const stageLost = stage(4, 'Lost', '#EF4444', 0, 'lost');
export const stageRefs = [stageNew, stageProposal, stageWon, stageLost];

const ASHA = { id: baseSession.user.id, name: 'Asha Verma' };

const base: DealResponse = {
  id: 'd1111111-1111-4111-8111-111111111111',
  title: '40 seats for Acme',
  pipeline: { id: PIPELINE_ID, name: 'Sales' },
  stage: stageNew,
  status: 'open',
  value: '12500.00',
  currency: 'USD',
  owner: ASHA,
  contact: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aarav Sharma',
    phone: '+919812345678',
    email: 'aarav@example.test',
  },
  company: { id: 'c1111111-1111-4111-8111-111111111111', name: 'Acme Ltd' },
  expectedCloseDate: '2099-12-31',
  source: 'manual',
  lostReason: null,
  lostReasonId: null,
  notes: null,
  wonAt: null,
  lostAt: null,
  rowVersion: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z',
};

export const acmeDeal: DealResponse = base;

/** Past its expected close day and with no owner or customer. */
export const lateDeal: DealResponse = {
  ...base,
  id: 'd2222222-2222-4222-8222-222222222222',
  title: 'Renewal for Globex',
  value: '800.00',
  owner: null,
  contact: null,
  company: null,
  expectedCloseDate: '2020-01-15',
  rowVersion: 1,
};

export const wonDeal: DealResponse = {
  ...base,
  id: 'd3333333-3333-4333-8333-333333333333',
  title: 'Onboarding for Initech',
  stage: stageWon,
  status: 'won',
  wonAt: '2026-10-08T10:00:00.000Z',
  rowVersion: 7,
};

export const lostDeal: DealResponse = {
  ...base,
  id: 'd4444444-4444-4444-8444-444444444444',
  title: 'Pilot for Umbrella',
  stage: stageLost,
  status: 'lost',
  lostReason: 'Price too high',
  lostAt: '2026-10-09T10:00:00.000Z',
  rowVersion: 4,
};

export const dealPage = (data: DealResponse[], next: string | null = null) => ({
  data,
  page: { nextCursor: next, hasMore: next !== null, limit: 25 },
});

const usd = (amount: string) => ({ byCurrency: [{ currency: 'USD', amount }] });
const none = { byCurrency: [] };

const column = (
  ref: DealStageRef,
  index: number,
  count: number,
  total: string,
  weighted: string,
): BoardStageResponse => ({
  stage: { ...ref, sortOrder: index },
  count,
  total: count > 0 ? usd(total) : none,
  weighted: ref.kind === 'open' && count > 0 ? usd(weighted) : none,
  deals: [],
  page: { nextCursor: null, hasMore: false, limit: 1 },
});

export const board: BoardResponse = {
  pipeline: { id: PIPELINE_ID, name: 'Sales', currency: 'USD', isDefault: true },
  stages: [
    column(stageNew, 0, 2, '13300.00', '1330.00'),
    column(stageProposal, 1, 0, '0', '0'),
    column(stageWon, 2, 1, '12500.00', '0'),
    column(stageLost, 3, 1, '12500.00', '0'),
  ],
  kpis: {
    openCount: 2,
    openValue: usd('13300.00'),
    forecast: usd('1330.00'),
    wonThisMonthCount: 1,
    wonThisMonthValue: usd('12500.00'),
    winRate: 50,
  },
};

export const lostReasons: LostReasonResponse[] = [
  {
    id: 'e1111111-1111-4111-8111-111111111111',
    name: 'Budget cut',
    sortOrder: 0,
    isActive: true,
    dealCount: 0,
    rowVersion: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  },
];

export const settingsOptional = { lostReasonRequired: false, rowVersion: 1 };
export const settingsRequired = { lostReasonRequired: true, rowVersion: 1 };

const activity = (n: number, overrides: Partial<DealActivityResponse>): DealActivityResponse => ({
  id: `f${n}111111-1111-4111-8111-111111111111`,
  dealId: acmeDeal.id,
  type: 'note',
  body: null,
  dueAt: null,
  doneAt: null,
  done: false,
  assignee: null,
  author: ASHA,
  stageChange: null,
  rowVersion: 1,
  createdAt: '2026-10-05T09:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
  ...overrides,
});

export const noteEntry = activity(1, { body: 'Sent the quote for 40 seats.' });
export const taskEntry = activity(2, {
  type: 'task',
  body: 'Follow up on the quote',
  dueAt: '2020-02-01T09:00:00.000Z',
  assignee: ASHA,
});
export const doneTaskEntry = activity(3, {
  type: 'task',
  body: 'Book the demo',
  done: true,
  doneAt: '2026-10-06T09:00:00.000Z',
  dueAt: '2026-10-07T09:00:00.000Z',
});
export const stageEntry = activity(4, {
  type: 'stage_change',
  stageChange: {
    from: { id: stageNew.id, name: 'New Lead' },
    to: { id: stageProposal.id, name: 'Proposal' },
  },
});
export const placedEntry = activity(5, {
  type: 'stage_change',
  stageChange: { from: null, to: { id: stageNew.id, name: 'New Lead' } },
});

export const activityPage = (data: DealActivityResponse[], next: string | null = null) => ({
  data,
  page: { nextCursor: next, hasMore: next !== null, limit: 30 },
});

export const team: AssigneeResponse[] = [
  { id: baseSession.user.id, fullName: 'Asha Verma', email: 'asha@example.test', canAssign: true },
  {
    id: '66666666-6666-4666-8666-666666666666',
    fullName: 'Dev Patel',
    email: 'dev@example.test',
    canAssign: true,
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    fullName: 'Out Of Scope',
    email: 'out@example.test',
    canAssign: false,
  },
];

export const contactChoices: ContactSelectItem[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aarav Sharma',
    email: 'aarav@example.test',
    phone: '+919812345678',
  },
];

const allDealPermissions = {
  'record.deals.read': 'all',
  'record.deals.create': 'all',
  'record.deals.update': 'all',
  'record.deals.delete': 'all',
  'record.pipelines.read': 'all',
  'record.contacts.read': 'all',
} as const;

/** A session that may read, add, change and delete deals, read pipelines and read contacts. */
export const sessionDealsFull: SessionResponse = {
  ...baseSession,
  permissions: { ...allDealPermissions },
};

/** May read deals and nothing else. */
export const sessionDealsReadOnly: SessionResponse = {
  ...baseSession,
  permissions: { 'record.deals.read': 'all' },
};

/** May read and change deals, but may not read pipelines or contacts (no lost-reason catalogue, no team list). */
export const sessionDealsUpdateOnly: SessionResponse = {
  ...baseSession,
  permissions: { 'record.deals.read': 'all', 'record.deals.update': 'all' },
};

export const sessionNoDeals: SessionResponse = {
  ...baseSession,
  permissions: { 'dash.dashboard.read': 'all' },
};
