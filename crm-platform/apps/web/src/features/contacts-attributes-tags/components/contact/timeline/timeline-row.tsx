'use client';

import Link from 'next/link';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { TaskCompleteCheck } from '@/features/tasks';
import { useStatusOptions } from '../../../api/attributes';
import { useOwnerNames } from '../../../api/owners';
import type { ContactRow } from '../../../api/schemas';
import { historyValueText } from '../../../lib/contact-data';
import { titleCaseKey } from '../../../lib/contact-model';
import { stageChoices } from '../../../lib/option-sets';
import type { EntryData, TimelineEntry, TimelineKind } from '../../../lib/timeline';
import {
  CalendarIcon,
  ChatIcon,
  ChevronDownIcon,
  CircleDotIcon,
  HistoryIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon,
  ShieldIcon,
  WhatsAppIcon,
} from '../../icons';
import { fieldLabel } from '../field-history';

type Translate = ReturnType<typeof useTranslations>;

const TONE: Record<TimelineKind, string> = {
  message: 'bg-success/10 text-success',
  email: 'bg-primary/10 text-primary',
  call: 'bg-brand/10 text-brand',
  note: 'bg-warning/10 text-warning',
  task: 'bg-muted text-muted-foreground',
  meeting: 'bg-primary/10 text-primary',
  change: 'bg-muted text-muted-foreground',
  consent: 'bg-success/10 text-success',
  other: 'bg-muted text-muted-foreground',
};

function KindIcon({ entry }: { entry: TimelineEntry }) {
  const cls = 'size-4';
  switch (entry.kind) {
    case 'message':
      return entry.data.type === 'message' && entry.data.channel.startsWith('whatsapp') ? (
        <WhatsAppIcon className={cls} />
      ) : (
        <ChatIcon className={cls} />
      );
    case 'email':
      return <MailIcon className={cls} />;
    case 'call':
      return <PhoneIcon className={cls} />;
    case 'note':
      return <NoteIcon className={cls} />;
    case 'meeting':
      return <CalendarIcon className={cls} />;
    case 'change':
      return <HistoryIcon className={cls} />;
    case 'consent':
      return <ShieldIcon className={cls} />;
    default:
      return <CircleDotIcon className={cls} />;
  }
}

/** The first line of a text, cut to `max` characters. */
const firstLine = (text: string, max = 110): string => {
  const line = (text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const channelName = (channel: string): string => {
  if (channel.startsWith('whatsapp')) return 'WhatsApp';
  if (channel === 'sms') return 'SMS';
  return titleCaseKey(channel);
};

/** "4 min", "45 sec" or null. */
function lengthText(t: Translate, seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  if (seconds < 60) return t('entry.call.seconds', { seconds });
  return t('entry.call.minutes', { minutes: Math.round(seconds / 60) });
}

/** The words of an outcome: this framework's (`no_answer`) and the WhatsApp log's (`no-answer`, `completed`) read the same. */
function outcomeText(t: Translate, outcome: string | null): string | null {
  switch (outcome) {
    case 'connected':
    case 'completed':
      return t('entry.call.outcome.connected');
    case 'no_answer':
    case 'no-answer':
      return t('entry.call.outcome.noAnswer');
    case 'busy':
      return t('entry.call.outcome.busy');
    case 'left_voicemail':
      return t('entry.call.outcome.voicemail');
    case 'wrong_number':
      return t('entry.call.outcome.wrongNumber');
    case 'declined':
      return t('entry.call.outcome.declined');
    case 'failed':
      return t('entry.call.outcome.failed');
    case 'in-progress':
      return t('entry.call.outcome.inProgress');
    default:
      return null;
  }
}

function sourceText(t: Translate, source: string): string {
  switch (source) {
    case 'whatsapp':
      return t('entry.call.source.whatsapp');
    case 'telephony':
      return t('entry.call.source.telephony');
    case 'mobile_app':
      return t('entry.call.source.mobile_app');
    case 'web_click_to_call':
      return t('entry.call.source.web_click_to_call');
    default:
      return t('entry.call.source.manual');
  }
}

interface Described {
  summary: string;
  /** A quieter second line (a call's notes, a note's rest, what the message said). */
  sub?: string | null;
  /** More than the two lines say; makes the row expandable. */
  detail?: ReactNode;
  /** The summary is a link. */
  href?: string;
  badge?: string | null;
}

/**
 * One entry of the timeline: an icon by kind (a task is a tick you can press), a one-line summary, the time and who, and a
 * detail that opens on a click when there is more to read. Compact on purpose: the compose box and the filters are the busy part
 * of the page, this is the history.
 */
export function TimelineRow({
  entry,
  contact,
  onChanged,
}: {
  entry: TimelineEntry;
  contact: Pick<ContactRow, 'id'>;
  /** After a task was ticked here (the contact's counters refresh). */
  onChanged?: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.timeline');
  const th = useTranslations('contacts-attributes-tags.contact.history');
  const format = useFormatter();
  const timeZone = useTimeZone();
  const { nameOf } = useOwnerNames();
  const status = useStatusOptions();
  const stages = useMemo(() => stageChoices(status.data), [status.data]);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const stageLabel = (v: unknown): string => {
    const value = historyValueText(v);
    return stages.find((s) => s.value === value)?.label ?? (value ? titleCaseKey(value) : '—');
  };

  const when = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      format.dateTime(d, { dateStyle: 'short', timeZone }) ===
      format.dateTime(now, { dateStyle: 'short', timeZone });
    if (sameDay) return format.dateTime(d, { hour: 'numeric', minute: '2-digit', timeZone });
    const sameYear =
      format.dateTime(d, { year: 'numeric', timeZone }) ===
      format.dateTime(now, { year: 'numeric', timeZone });
    return format.dateTime(d, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
      timeZone,
    });
  };
  const full = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone });

  const d: EntryData = entry.data;
  const described: Described = (() => {
    switch (d.type) {
      case 'note': {
        const rest = d.body.trim();
        const one = firstLine(rest);
        const more = rest.length > one.length || rest.includes('\n');
        return {
          summary: t('entry.note', { text: one }),
          detail: more ? (
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
              {rest}
            </p>
          ) : undefined,
          badge: d.edited ? t('entry.edited') : null,
        };
      }
      case 'task': {
        const due = d.dueAt ? when(d.dueAt) : null;
        return {
          summary: d.done ? t('entry.task.done', { title: d.title }) : d.title,
          sub: d.done
            ? null
            : d.overdue && due
              ? t('entry.task.overdue', { when: due })
              : due
                ? t('entry.task.due', { when: due })
                : t('entry.task.noDue'),
          href: `/tasks?tab=all&status=all&task=${d.taskId}`,
        };
      }
      case 'meeting': {
        const start = d.startsAt ? full(d.startsAt) : null;
        return {
          summary: d.upcoming
            ? t('entry.meeting.upcoming', { title: d.title })
            : d.status === 'cancelled' || d.status === 'declined'
              ? t('entry.meeting.notHeld', { title: d.title })
              : d.status === 'no_show'
                ? t('entry.meeting.noShow', { title: d.title })
                : t('entry.meeting.past', { title: d.title }),
          sub: [start, d.location].filter(Boolean).join(' · ') || null,
        };
      }
      case 'call': {
        const length = lengthText(t, d.durationSec);
        const outcome = outcomeText(t, d.outcome);
        const direction =
          d.direction === 'inbound'
            ? t('entry.call.inbound')
            : d.direction === 'outbound'
              ? t('entry.call.outbound')
              : t('entry.call.call');
        const summary =
          d.text ?? [direction, outcome, length].filter((x): x is string => !!x).join(' · ');
        const notes = d.notes?.trim() ?? '';
        const one = firstLine(notes);
        const more = notes.length > one.length;
        return {
          summary,
          sub: notes ? one : null,
          detail: more ? (
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
              {notes}
            </p>
          ) : undefined,
          badge: sourceText(t, d.source),
        };
      }
      case 'message':
        return {
          summary: t('entry.message.summary', { channel: channelName(d.channel) }),
          sub: d.preview ? firstLine(d.preview, 140) : null,
          href: `/inbox?c=${d.conversationId}`,
          badge: d.unread > 0 ? t('entry.message.unread', { count: d.unread }) : null,
        };
      case 'email': {
        const body = d.body?.trim() ?? '';
        return {
          summary:
            d.direction === 'sent'
              ? t('entry.email.sent', { title: d.title })
              : t('entry.email.received', { title: d.title }),
          sub: body ? firstLine(body, 140) : null,
          detail:
            body.length > 140 || body.includes('\n') ? (
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
                {body}
              </p>
            ) : undefined,
        };
      }
      case 'change': {
        const fields = d.fields;
        const stage = fields.find((f) => f.key === 'lifecycleStage');
        if (fields.length === 1 && stage) {
          return {
            summary: t('entry.change.stage', {
              from: stageLabel(stage.from),
              to: stageLabel(stage.to),
            }),
          };
        }
        if (fields.length === 1) {
          const f = fields[0]!;
          return {
            summary: t('entry.change.field', {
              field: fieldLabel(th, f.key),
              from: historyValueText(f.from) || '—',
              to: historyValueText(f.to) || '—',
            }),
          };
        }
        return {
          summary: stage
            ? t('entry.change.stageAndMore', {
                from: stageLabel(stage.from),
                to: stageLabel(stage.to),
                count: fields.length - 1,
              })
            : t('entry.change.several', { count: fields.length }),
          detail: (
            <ul className="space-y-1 text-sm">
              {fields.map((f) => (
                <li key={f.key} dir="auto">
                  <span className="font-medium">{fieldLabel(th, f.key)}</span>{' '}
                  <span className="text-muted-foreground">
                    {f.key === 'lifecycleStage'
                      ? stageLabel(f.from)
                      : historyValueText(f.from) || '—'}
                    {' → '}
                    {f.key === 'lifecycleStage' ? stageLabel(f.to) : historyValueText(f.to) || '—'}
                  </span>
                </li>
              ))}
            </ul>
          ),
        };
      }
      case 'consent':
        return {
          summary:
            d.action === 'granted'
              ? t('entry.consent.granted', { channel: channelName(d.channel) })
              : t('entry.consent.withdrawn', { channel: channelName(d.channel) }),
          sub: d.purpose === 'utility' ? t('entry.consent.service') : t('entry.consent.marketing'),
        };
      case 'other': {
        const body = d.body?.trim() ?? '';
        return {
          summary: d.title,
          sub: body ? firstLine(body, 140) : null,
          detail:
            body.length > 140 || body.includes('\n') ? (
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
                {body}
              </p>
            ) : undefined,
        };
      }
    }
  })();

  // A call the activity feed wrote already says who took it ("..., by Priya").
  const who =
    d.type === 'call' && d.text
      ? null
      : (entry.actorName ??
        (entry.actorId ? nameOf(entry.actorId) : undefined) ??
        (d.type === 'change' && d.actorType === 'system' ? t('entry.system') : null));
  const stamp = d.type === 'task' && !d.done ? null : when(entry.at);
  const expandable = described.detail !== undefined;

  const summary = (
    <span
      dir="auto"
      className={cn(
        'min-w-0 truncate text-sm',
        d.type === 'task' && d.done && 'text-muted-foreground line-through',
      )}
    >
      {described.summary}
    </span>
  );

  return (
    <li className="group/row relative flex items-start gap-3 py-2">
      {d.type === 'task' ? (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center">
          <TaskCompleteCheck
            task={d.task}
            source={{ kind: 'contact', id: contact.id }}
            onChanged={onChanged}
          />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
            TONE[entry.kind],
          )}
        >
          <KindIcon entry={entry} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {expandable ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={() => setOpen((o) => !o)}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {summary}
              <ChevronDownIcon
                className={cn(
                  'size-3.5 shrink-0 self-center text-muted-foreground transition',
                  open && 'rotate-180',
                )}
              />
            </button>
          ) : described.href ? (
            <Link
              href={described.href}
              className={cn(
                'min-w-0 flex-1 truncate rounded text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary',
                d.type === 'task' && d.done && 'text-muted-foreground line-through',
              )}
              dir="auto"
            >
              {described.summary}
            </Link>
          ) : (
            <span className="flex min-w-0 flex-1">{summary}</span>
          )}
          {described.badge && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
              {described.badge}
            </span>
          )}
          {stamp && (
            <time
              dateTime={entry.at}
              title={full(entry.at)}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {stamp}
            </time>
          )}
        </div>
        {(described.sub || who) && (
          <p
            dir="auto"
            className={cn(
              'mt-0.5 truncate text-xs text-muted-foreground',
              d.type === 'task' && d.overdue && !d.done && 'text-danger',
            )}
          >
            {described.sub}
            {described.sub && who ? ' · ' : ''}
            {who ? t('entry.by', { name: who }) : null}
          </p>
        )}
        {expandable && open && (
          <div
            id={detailId}
            className="mt-1.5 rounded-md border border-border bg-muted/30 px-3 py-2"
          >
            {described.detail}
          </div>
        )}
      </div>
    </li>
  );
}
