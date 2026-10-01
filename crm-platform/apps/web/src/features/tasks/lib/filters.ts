import type { TaskPriority } from '@crm/contracts';

/**
 * The Tasks hub's state, kept in the address so a view can be shared and the back button works. The tab picks the base query
 * (who and when); the toolbar narrows it. Everything here is pure.
 */
export const TABS = ['mine', 'all', 'overdue', 'today', 'upcoming', 'completed'] as const;
export type TaskTab = (typeof TABS)[number];
export type TasksView = 'list' | 'board';
/** The status filter of the "All tasks" tab; the other tabs fix it. */
export type StatusFilter = 'open' | 'done' | 'all';

export interface TaskFilters {
  tab: TaskTab;
  q: string;
  status: StatusFilter;
  priority: TaskPriority | '';
  /** A member id, `none` for unassigned, or empty for everyone. */
  assignee: string;
  /** Linked contact / deal (a uuid) or empty. */
  contact: string;
  deal: string;
  view: TasksView;
  /** The task whose drawer is open (`?task=`). */
  task: string;
}

export const DEFAULT_FILTERS: TaskFilters = {
  tab: 'mine',
  q: '',
  status: 'open',
  priority: '',
  assignee: '',
  contact: '',
  deal: '',
  view: 'list',
  task: '',
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const isTab = (v: string | null): v is TaskTab => (TABS as readonly (string | null)[]).includes(v);

/** Reads the state from the address; unknown or malformed values fall back to the defaults instead of failing. */
export function parseFilters(search: SearchLike): TaskFilters {
  const tab = search.get('tab');
  const status = search.get('status');
  const priority = search.get('priority') ?? '';
  const assignee = search.get('assignee') ?? '';
  const id = (v: string | null) => (v && UUID.test(v) ? v : '');
  return {
    tab: isTab(tab) ? tab : 'mine',
    q: (search.get('q') ?? '').slice(0, 100),
    status: status === 'done' || status === 'all' ? status : 'open',
    priority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as TaskPriority) : '',
    assignee: assignee === 'none' || UUID.test(assignee) ? assignee : '',
    contact: id(search.get('contact')),
    deal: id(search.get('deal')),
    view: search.get('view') === 'board' ? 'board' : 'list',
    task: id(search.get('task')),
  };
}

/** The `?query` for these filters; defaults are left out so the plain screen keeps a plain address. */
export function filtersToSearch(f: TaskFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'mine') p.set('tab', f.tab);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.tab === 'all' && f.status !== 'open') p.set('status', f.status);
  if (f.priority) p.set('priority', f.priority);
  if (f.assignee) p.set('assignee', f.assignee);
  if (f.contact) p.set('contact', f.contact);
  if (f.deal) p.set('deal', f.deal);
  if (f.view === 'board') p.set('view', 'board');
  if (f.task) p.set('task', f.task);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Anything the toolbar narrowed (the tab and the view do not count). */
export function hasActiveFilter(
  f: Pick<TaskFilters, 'q' | 'priority' | 'assignee' | 'contact' | 'deal'> & {
    status?: StatusFilter;
    tab?: TaskTab;
  },
): boolean {
  return (
    f.q.trim() !== '' ||
    f.priority !== '' ||
    f.assignee !== '' ||
    f.contact !== '' ||
    f.deal !== '' ||
    (f.tab === 'all' && f.status !== undefined && f.status !== 'open')
  );
}

export type QueryValues = Record<string, string | boolean | undefined>;

/** Narrowing filters shared by the list and the counts endpoints (empty values are dropped by the client). */
export function sharedQuery(f: TaskFilters): QueryValues {
  return {
    q: f.q.trim() || undefined,
    priority: f.priority || undefined,
    assigneeId: f.assignee && f.assignee !== 'none' ? f.assignee : undefined,
    unassigned: f.assignee === 'none' ? true : undefined,
    contactId: f.contact || undefined,
    dealId: f.deal || undefined,
  };
}

/**
 * The list query for the active tab. "My tasks" means assigned to the caller (the server decides who that is, WD-TASK D-04);
 * the bucket tabs show open tasks; Completed shows done ones, latest first. The assignee filter is ignored on "My tasks".
 */
export function listQuery(f: TaskFilters): QueryValues {
  const shared = sharedQuery(f);
  switch (f.tab) {
    case 'mine':
      return { ...shared, assigneeId: undefined, unassigned: undefined, mine: true, status: 'open' };
    case 'all':
      return { ...shared, status: f.status };
    case 'overdue':
    case 'today':
    case 'upcoming':
      return { ...shared, status: 'open', due: f.tab };
    case 'completed':
      return { ...shared, status: 'done', sort: 'completed' };
  }
}

/** Counts take the same narrowing filters but never the tab, so every badge answers for its own tab. */
export const countsQuery = (f: TaskFilters): QueryValues => sharedQuery(f);

export interface CountsLike {
  overdue: number;
  today: number;
  upcoming: number;
  open: number;
  done: number;
  mine: { open: number; overdue: number };
}

/** The count that belongs on a tab's badge, or undefined while it is unknown. */
export function tabCount(tab: TaskTab, counts: CountsLike | undefined): number | undefined {
  if (!counts) return undefined;
  switch (tab) {
    case 'mine':
      return counts.mine.open;
    case 'all':
      return counts.open;
    case 'overdue':
      return counts.overdue;
    case 'today':
      return counts.today;
    case 'upcoming':
      return counts.upcoming;
    case 'completed':
      return counts.done;
  }
}
