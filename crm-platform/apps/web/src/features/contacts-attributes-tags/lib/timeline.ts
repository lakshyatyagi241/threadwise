import type {
  CallLogRow,
  ContactActivityResponse,
  ContactMeetingResponse,
  ContactNoteResponse,
  ConsentEvent,
  ConversationSummary,
  FieldHistoryEntry,
  TaskResponse,
} from '@crm/contracts';

/**
 * The activity timeline of a contact, made from the things the contact already has: the activity feed (e-mail, forms, orders, logged
 * calls), notes, tasks, meetings, WhatsApp calls, conversations, field changes and consent changes. Each source keeps its own cursor,
 * so this file does the part no endpoint does: one time-ordered list, the filter pills, the search and the day groups. It is
 * pure (no React, no network, no translation): an entry says WHAT happened as data and the screen words it in the person's language.
 */

// --- kinds and filters --------------------------------------------------------------------------------------------------

export const TIMELINE_KINDS = [
  'message',
  'email',
  'call',
  'note',
  'task',
  'meeting',
  'change',
  'consent',
  'other',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_FILTERS = [
  'all',
  'messages',
  'calls',
  'notes',
  'tasks',
  'meetings',
  'changes',
] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

/** The kinds a pill shows; `null` is every kind. */
export function kindsOf(filter: TimelineFilter): ReadonlySet<TimelineKind> | null {
  switch (filter) {
    case 'all':
      return null;
    case 'messages':
      return new Set<TimelineKind>(['message', 'email']);
    case 'calls':
      return new Set<TimelineKind>(['call']);
    case 'notes':
      return new Set<TimelineKind>(['note']);
    case 'tasks':
      return new Set<TimelineKind>(['task']);
    case 'meetings':
      return new Set<TimelineKind>(['meeting']);
    case 'changes':
      return new Set<TimelineKind>(['change', 'consent']);
  }
}

export const TIMELINE_SOURCES = [
  'activities',
  'notes',
  'tasksOpen',
  'tasksDone',
  'meetings',
  'conversations',
  'whatsappCalls',
  'fieldHistory',
  'consent',
] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

const SOURCES_OF: Record<TimelineFilter, readonly TimelineSource[]> = {
  all: TIMELINE_SOURCES,
  messages: ['activities', 'conversations'],
  calls: ['activities', 'whatsappCalls'],
  notes: ['notes'],
  tasks: ['tasksOpen', 'tasksDone'],
  meetings: ['meetings'],
  changes: ['fieldHistory', 'consent'],
};

/** The sources a pill needs; the others are not asked for at all (a pill is also the page's lazy loading). */
export function sourcesFor(filter: TimelineFilter): ReadonlySet<TimelineSource> {
  return new Set(SOURCES_OF[filter]);
}

// --- entries ------------------------------------------------------------------------------------------------------------

/** Where a call came from: the WhatsApp log, or one of the sources of the call logging framework (the activity type's tail). */
export type CallSource = 'whatsapp' | 'manual' | 'telephony' | 'mobile_app' | 'web_click_to_call';

export type EntryData =
  | { type: 'note'; body: string; edited: boolean }
  | {
      type: 'task';
      taskId: string;
      title: string;
      done: boolean;
      /** Open and past due. */
      overdue: boolean;
      dueAt: string | null;
      priority: string;
      assigneeName: string | null;
      /** The task as the list holds it: the tick on the timeline completes this one in place. */
      task: TaskResponse;
    }
  | {
      type: 'meeting';
      meetingId: string;
      title: string;
      startsAt: string | null;
      endsAt: string | null;
      location: string | null;
      upcoming: boolean;
    }
  | {
      type: 'call';
      source: CallSource;
      direction: 'inbound' | 'outbound' | null;
      /** `connected`, `no_answer` ... or the WhatsApp log's own words (`completed`, `no-answer`, `failed`, `declined`). */
      outcome: string | null;
      durationSec: number | null;
      /** The server's own line, for a call the activity feed wrote (it is English today). */
      text: string | null;
      notes: string | null;
      handlerName: string | null;
    }
  | {
      type: 'message';
      conversationId: string;
      channel: string;
      preview: string | null;
      unread: number;
    }
  | { type: 'email'; direction: 'received' | 'sent'; title: string; body: string | null }
  | {
      type: 'change';
      /** Several fields saved together read as one line. */
      fields: Array<{ key: string; from: unknown; to: unknown }>;
      actorType: string;
    }
  | {
      type: 'consent';
      channel: string;
      purpose: string;
      action: string;
      source: string;
      note: string | null;
    }
  | { type: 'other'; activityType: string; title: string; body: string | null };

export interface TimelineEntry {
  /** Unique over the whole timeline (`kind:` + the source's id). */
  id: string;
  kind: TimelineKind;
  /** The instant the entry is placed at. */
  at: string;
  /** The person who did it, as a user id (the screen turns it into a name) ... */
  actorId: string | null;
  /** ... or a name the source already gave. */
  actorName: string | null;
  /** Open tasks and upcoming meetings: they sit above the dated groups as "Up next". */
  upNext: boolean;
  /** For "Up next": the instant it is due or starts. */
  when: string | null;
  data: EntryData;
}

const ms = (iso: string) => Date.parse(iso);

export function fromActivity(a: ContactActivityResponse): TimelineEntry {
  const base = {
    at: a.occurredAt,
    actorId: a.actorId,
    actorName: null,
    upNext: false,
    when: null,
  };
  if (a.activityType === 'email_received' || a.activityType === 'email_sent') {
    return {
      ...base,
      id: `email:${a.id}`,
      kind: 'email',
      data: {
        type: 'email',
        direction: a.activityType === 'email_sent' ? 'sent' : 'received',
        title: a.title,
        body: a.body,
      },
    };
  }
  if (a.activityType.startsWith('call_')) {
    const source = a.activityType.slice('call_'.length);
    return {
      ...base,
      id: `call:a:${a.id}`,
      kind: 'call',
      data: {
        type: 'call',
        source: (['manual', 'telephony', 'mobile_app', 'web_click_to_call'] as const).includes(
          source as never,
        )
          ? (source as CallSource)
          : 'manual',
        direction: /^inbound\b/i.test(a.title)
          ? 'inbound'
          : /^outbound\b/i.test(a.title)
            ? 'outbound'
            : null,
        outcome: null,
        durationSec: null,
        text: a.title,
        notes: a.body,
        handlerName: null,
      },
    };
  }
  return {
    ...base,
    id: `other:${a.id}`,
    kind: 'other',
    data: { type: 'other', activityType: a.activityType, title: a.title, body: a.body },
  };
}

export function fromNote(n: ContactNoteResponse): TimelineEntry {
  return {
    id: `note:${n.id}`,
    kind: 'note',
    at: n.createdAt,
    actorId: n.createdBy,
    actorName: null,
    upNext: false,
    when: null,
    data: { type: 'note', body: n.body, edited: n.updatedAt !== n.createdAt },
  };
}

/** An open task waits "Up next" (due soonest first, undated last); a done one sits where it was finished. */
export function fromTask(t: TaskResponse): TimelineEntry {
  const done = t.status === 'done';
  return {
    id: `task:${t.id}`,
    kind: 'task',
    at: done ? (t.doneAt ?? t.updatedAt) : t.createdAt,
    actorId: t.assignee?.id ?? t.createdBy?.id ?? null,
    actorName: t.assignee?.name ?? t.createdBy?.name ?? null,
    upNext: !done,
    when: t.dueAt,
    data: {
      type: 'task',
      taskId: t.id,
      title: t.title,
      done,
      overdue: t.overdue,
      dueAt: t.dueAt,
      priority: t.priority,
      assigneeName: t.assignee?.name ?? null,
      task: t,
    },
  };
}

/** A meeting still to come waits "Up next"; one that happened sits at its start (no start: when it was logged). */
export function fromMeeting(m: ContactMeetingResponse, now: Date): TimelineEntry {
  const upcoming = m.startsAt !== null && ms(m.startsAt) > now.getTime();
  return {
    id: `meeting:${m.id}`,
    kind: 'meeting',
    at: m.startsAt ?? m.createdAt,
    actorId: m.createdBy,
    actorName: null,
    upNext: upcoming,
    when: m.startsAt,
    data: {
      type: 'meeting',
      meetingId: m.id,
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      location: m.location,
      upcoming,
    },
  };
}

export function fromWhatsappCall(c: CallLogRow): TimelineEntry {
  return {
    id: `call:w:${c.id}`,
    kind: 'call',
    at: c.startedAt ?? new Date(0).toISOString(),
    actorId: c.handlerId,
    actorName: c.handlerName,
    upNext: false,
    when: null,
    data: {
      type: 'call',
      source: 'whatsapp',
      direction: c.direction,
      outcome: c.status,
      durationSec: c.durationSec,
      text: null,
      notes: null,
      handlerName: c.handlerName,
    },
  };
}

/** One line per conversation, at its last message, linking to the thread. */
export function fromConversation(c: ConversationSummary): TimelineEntry {
  return {
    id: `message:${c.id}`,
    kind: 'message',
    at: c.lastMessageAt ?? c.updatedAt,
    actorId: null,
    actorName: null,
    upNext: false,
    when: null,
    data: {
      type: 'message',
      conversationId: c.id,
      channel: c.channel.kind,
      preview: c.preview,
      unread: c.unreadCount,
    },
  };
}

/** Field edits made together (the same moment, the same person) read as one line; the stage and the status stand out in the line. */
export function fromFieldHistory(entries: readonly FieldHistoryEntry[]): TimelineEntry[] {
  const groups = new Map<string, FieldHistoryEntry[]>();
  for (const e of entries) {
    const key = `${e.changedAt}|${e.changedByUserId ?? e.actorType}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    id: `change:${key}`,
    kind: 'change' as const,
    at: list[0]!.changedAt,
    actorId: list[0]!.changedByUserId,
    actorName: null,
    upNext: false,
    when: null,
    data: {
      type: 'change' as const,
      actorType: list[0]!.actorType,
      fields: list.map((e) => ({ key: e.fieldKey, from: e.oldValue, to: e.newValue })),
    },
  }));
}

export function fromConsentEvent(e: ConsentEvent): TimelineEntry {
  return {
    id: `consent:${e.id}`,
    kind: 'consent',
    at: e.occurredAt,
    actorId: e.actor?.id ?? null,
    actorName: e.actor?.name ?? null,
    upNext: false,
    when: null,
    data: {
      type: 'consent',
      channel: e.channel,
      purpose: e.purpose,
      action: e.action,
      source: e.source,
      note: e.note,
    },
  };
}

// --- merging ------------------------------------------------------------------------------------------------------------

export interface FeedSource {
  id: TimelineSource;
  entries: readonly TimelineEntry[];
  /** There are older pages of this source that are not loaded yet. */
  hasMore: boolean;
}

export interface Feed {
  /** Open tasks and meetings still to come, soonest first. */
  upNext: TimelineEntry[];
  /** Newest first, only what is sure to be in its right place (see `mergeFeed`). */
  dated: TimelineEntry[];
  /** Some source still has older pages: "Load more" has something to fetch. */
  canLoadMore: boolean;
  /** The sources to fetch the next page of: the ones the visible part stops at. */
  next: TimelineSource[];
}

/**
 * One list from many cursor-paged sources. A source that still has older pages may hold an entry older than the oldest it has loaded
 * and no newer, so a loaded entry is only sure to be in its right place when it is not older than the newest of those "oldest loaded"
 * instants (the horizon). Entries older than the horizon wait until the sources that limit it have been read further, which is what
 * "Load more" does (`next`); once nothing has older pages everything shows.
 */
export function mergeFeed(sources: readonly FeedSource[]): Feed {
  const upNext: TimelineEntry[] = [];
  const dated: TimelineEntry[] = [];
  for (const s of sources) {
    for (const e of s.entries) (e.upNext ? upNext : dated).push(e);
  }
  upNext.sort((a, b) => {
    if (a.when && b.when) return ms(a.when) - ms(b.when);
    if (a.when) return -1;
    if (b.when) return 1;
    return ms(b.at) - ms(a.at);
  });
  dated.sort((a, b) => ms(b.at) - ms(a.at) || (a.id < b.id ? -1 : 1));

  // Each source with older pages: the oldest instant it has loaded (its entries that are placed on the timeline, not "Up next").
  const limits = sources
    .filter((s) => s.hasMore)
    .map((s) => {
      const times = s.entries.filter((e) => !e.upNext).map((e) => ms(e.at));
      return { id: s.id, oldest: times.length > 0 ? Math.min(...times) : Number.POSITIVE_INFINITY };
    });
  if (limits.length === 0) return { upNext, dated, canLoadMore: false, next: [] };

  const horizon = Math.max(...limits.map((l) => l.oldest));
  return {
    upNext,
    dated: dated.filter((e) => ms(e.at) >= horizon),
    canLoadMore: true,
    next: limits.filter((l) => l.oldest === horizon).map((l) => l.id),
  };
}

// --- filter and search --------------------------------------------------------------------------------------------------

/** The words an entry can be found by: what a person typed or what the line says. Lower case. */
export function searchText(e: TimelineEntry): string {
  const d = e.data;
  const parts: Array<string | null | undefined> = [e.actorName];
  switch (d.type) {
    case 'note':
      parts.push(d.body);
      break;
    case 'task':
      parts.push(d.title, d.assigneeName);
      break;
    case 'meeting':
      parts.push(d.title, d.location);
      break;
    case 'call':
      parts.push(d.text, d.notes, d.handlerName);
      break;
    case 'message':
      parts.push(d.preview, d.channel);
      break;
    case 'email':
      parts.push(d.title, d.body);
      break;
    case 'change':
      for (const f of d.fields) parts.push(f.key, text(f.from), text(f.to));
      break;
    case 'consent':
      parts.push(d.channel, d.action, d.note);
      break;
    case 'other':
      parts.push(d.title, d.body);
      break;
  }
  return parts
    .filter((p): p is string => !!p)
    .join(' ')
    .toLowerCase();
}

function text(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}

/** The entries a pill and a search box leave: every word typed has to be in the entry. */
export function visibleEntries(
  entries: readonly TimelineEntry[],
  filter: TimelineFilter,
  query: string,
): TimelineEntry[] {
  const kinds = kindsOf(filter);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (kinds && !kinds.has(e.kind)) return false;
    if (words.length === 0) return true;
    const hay = searchText(e);
    return words.every((w) => hay.includes(w));
  });
}

// --- day groups ---------------------------------------------------------------------------------------------------------

export const DAY_GROUPS = ['today', 'yesterday', 'thisWeek', 'earlier'] as const;
export type DayGroup = (typeof DAY_GROUPS)[number];

/** A calendar day (`YYYY-MM-DD`) of an instant on the clock of `timeZone`. */
function dayKey(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const dayNumber = (key: string): number => Date.parse(`${key}T00:00:00Z`) / 86_400_000;

/**
 * Today, Yesterday, This week (the rest of the current Monday-to-Sunday week) or Earlier, on the clock of `timeZone`. An instant in
 * the future (a meeting later on) reads as Today: "Up next" is where the things to come are shown.
 */
export function dayGroupOf(iso: string, now: Date, timeZone?: string): DayGroup {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'earlier';
  const today = dayNumber(dayKey(now, timeZone));
  const day = dayNumber(dayKey(d, timeZone));
  const age = today - day;
  if (age <= 0) return 'today';
  if (age === 1) return 'yesterday';
  // 1970-01-01 was a Thursday: (n + 3) % 7 is 0 on a Monday.
  const sinceMonday = (today + 3) % 7;
  return age <= sinceMonday ? 'thisWeek' : 'earlier';
}

export interface DayBucket {
  group: DayGroup;
  entries: TimelineEntry[];
}

/** The entries (already newest first) in their day groups, empty groups left out. */
export function groupByDay(
  entries: readonly TimelineEntry[],
  now: Date,
  timeZone?: string,
): DayBucket[] {
  const buckets = new Map<DayGroup, TimelineEntry[]>();
  for (const e of entries) {
    const g = dayGroupOf(e.at, now, timeZone);
    const list = buckets.get(g);
    if (list) list.push(e);
    else buckets.set(g, [e]);
  }
  return DAY_GROUPS.filter((g) => buckets.has(g)).map((group) => ({
    group,
    entries: buckets.get(group)!,
  }));
}
