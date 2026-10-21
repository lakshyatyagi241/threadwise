import type {
  AssigneeResponse,
  ContactSelectItem,
  SessionResponse,
  TaskPageResponse,
  TaskResponse,
} from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the tasks endpoints, for tests. Fake names only. */

const base: TaskResponse = {
  id: '51111111-1111-4111-8111-111111111111',
  kind: 'task',
  title: 'Call Aarav about the quote',
  notes: 'Ask whether the quote for 40 seats is approved.',
  priority: 'medium',
  status: 'open',
  dueAt: '2026-10-20T10:00:00.000Z',
  doneAt: null,
  remindedAt: null,
  outcome: null,
  taskType: null,
  bucket: 'upcoming',
  overdue: false,
  assignee: { id: baseSession.user.id, name: 'Asha Verma' },
  createdBy: { id: baseSession.user.id, name: 'Asha Verma' },
  contact: { id: '11111111-1111-4111-8111-111111111111', name: 'Aarav Sharma' },
  deal: null,
  company: null,
  source: 'manual',
  rowVersion: 2,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-05T08:00:00.000Z',
};

export const callAarav: TaskResponse = base;

/** Past due and urgent: the due line is red and carries an Overdue pill. */
export const overdueTask: TaskResponse = {
  ...base,
  id: '52222222-2222-4222-8222-222222222222',
  title: 'Send the contract',
  notes: null,
  priority: 'high',
  dueAt: '2026-10-01T09:30:00.000Z',
  bucket: 'overdue',
  overdue: true,
  rowVersion: 5,
};

export const doneTask: TaskResponse = {
  ...base,
  id: '53333333-3333-4333-8333-333333333333',
  title: 'Book the demo',
  priority: 'low',
  status: 'done',
  doneAt: '2026-10-09T12:00:00.000Z',
  bucket: null,
  rowVersion: 7,
};

/** No due date, nobody to do it, and no contact. */
export const looseTask: TaskResponse = {
  ...base,
  id: '54444444-4444-4444-8444-444444444444',
  title: 'Tidy the pipeline',
  notes: null,
  dueAt: null,
  bucket: 'no_date',
  assignee: null,
  contact: null,
  rowVersion: 1,
};

export const tasks: TaskResponse[] = [callAarav, overdueTask, doneTask];

export const taskPage = (data: TaskResponse[], next: string | null = null): TaskPageResponse => ({
  data,
  page: { nextCursor: next, hasMore: next !== null, limit: 50 },
});

export const team: AssigneeResponse[] = [
  { id: baseSession.user.id, fullName: 'Asha Verma', email: 'asha@example.test', canAssign: true },
  {
    id: '66666666-6666-4666-8666-666666666666',
    fullName: 'Dev Patel',
    email: 'dev@example.test',
    canAssign: true,
  },
];

export const contactChoices: ContactSelectItem[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aarav Sharma',
    email: 'aarav@example.test',
    phone: '+919812345678',
  },
  { id: '22222222-2222-4222-8222-222222222222', name: null, email: null, phone: '+919800000002' },
];

const allTaskPermissions = {
  'record.tasks.read': 'all',
  'record.tasks.create': 'all',
  'record.tasks.update': 'all',
  'record.tasks.delete': 'all',
  'record.contacts.read': 'all',
} as const;

/** A session that may read, add, change and delete tasks, and read contacts (for the team and contact lists). */
export const sessionTasksFull: SessionResponse = {
  ...baseSession,
  permissions: { ...allTaskPermissions },
};

/** May read tasks and nothing else. */
export const sessionTasksReadOnly: SessionResponse = {
  ...baseSession,
  permissions: { 'record.tasks.read': 'all' },
};

/** May read and complete tasks but not add, edit or delete them, and may not read contacts. */
export const sessionTasksComplete: SessionResponse = {
  ...baseSession,
  permissions: { 'record.tasks.read': 'all', 'record.tasks.update': 'all' },
};

export const sessionNoTasks: SessionResponse = {
  ...baseSession,
  permissions: { 'dash.dashboard.read': 'all' },
};
