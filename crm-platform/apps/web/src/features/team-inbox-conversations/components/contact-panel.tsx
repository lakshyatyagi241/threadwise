'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge, Button, Select, Spinner, Tabs, Textarea, cn } from '@crm/ui';
import {
  NOTE_BODY_MAX,
  type ConversationEvent,
  type ConversationNote,
  type InboxConversationDetail,
} from '@crm/contracts';
import { LinkedAppointments } from '@/features/appointments';
import { LinkedTasks } from '@/features/tasks';
import { useAssignees, useTimeline } from '../api/hooks';
import { eventLabel } from '../lib/timeline';
import { fullStamp, listTime } from '../lib/time';
import { CheckCircleIcon, ExternalIcon, NoteIcon, TrashIcon, UserPlusIcon } from './icons';
import { Avatar, ChannelTag, useErrorText } from './parts';

export interface ContactPanelProps {
  detail: InboxConversationDetail;
  meId: string;
  can: { assign: boolean; assignSelf: boolean; resolve: boolean; note: boolean };
  presence: ReadonlyMap<string, string>;
  /** Oldest first. */
  notes: ConversationNote[];
  notesLoading: boolean;
  notesError: boolean;
  nowMs: number;
  assigning: boolean;
  resolving: boolean;
  onAssign: (change: { userId?: string | null; teamId?: string | null }) => void;
  onToggleResolved: () => void;
  onAddNote: (body: string) => Promise<boolean>;
  onDeleteNote: (id: string) => void;
  canDeleteNote: (note: ConversationNote) => boolean;
  onOpenConversation: (id: string) => void;
}

/**
 * The right pane: who the customer is (the contact summary, linked to their record), who has the conversation, their other
 * conversations, and tabs for the internal notes and the timeline. The tasks and bookings of that contact are the same panels
 * the contact page shows.
 */
export function ContactPanel(props: ContactPanelProps) {
  const t = useTranslations('team-inbox-conversations.panel');
  const { detail } = props;
  const contactId = detail.contactSummary?.id ?? detail.contact?.id ?? null;

  return (
    <div className="space-y-4 p-4" data-testid="inbox-contact-panel">
      <ContactSummary detail={detail} contactId={contactId} />

      <AssigneeSection {...props} />

      <section aria-label={t('tabsLabel')}>
        <Tabs
          defaultValue="notes"
          items={[
            {
              id: 'notes',
              label:
                props.notes.length > 0 ? `${t('notes.tab')} (${props.notes.length})` : t('notes.tab'),
              content: <NotesTab {...props} />,
            },
            {
              id: 'timeline',
              label: t('timeline.tab'),
              content: <TimelineTab conversationId={detail.id} />,
            },
          ]}
        />
      </section>

      <PastConversations
        items={detail.pastConversations}
        nowMs={props.nowMs}
        onOpen={props.onOpenConversation}
      />

      {contactId && (
        <div className="space-y-3" data-testid="inbox-contact-links">
          <LinkedTasks kind="contact" id={contactId} compact />
          <LinkedAppointments contactId={contactId} />
        </div>
      )}
    </div>
  );
}

function ContactSummary({
  detail,
  contactId,
}: {
  detail: InboxConversationDetail;
  contactId: string | null;
}) {
  const t = useTranslations('team-inbox-conversations.panel');
  const locale = useLocale();
  const c = detail.contactSummary;
  const name = c?.name ?? detail.contact?.name ?? detail.title;

  return (
    <section aria-label={t('contact')} className="flex flex-col items-center gap-2 text-center">
      <Avatar id={detail.id} name={name} size="lg" />
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold" data-testid="inbox-contact-name">
          {name}
        </h3>
        <p dir="ltr" className="font-mono text-xs text-muted-foreground">
          {c?.phone ?? detail.peerKey}
        </p>
      </div>

      {contactId ? (
        <Link
          href={`/contacts/${contactId}`}
          data-testid="inbox-open-contact"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('openContact')}
          <ExternalIcon width={12} height={12} />
        </Link>
      ) : (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          {detail.needsContact ? t('needsContact') : t('noContact')}
        </p>
      )}

      {c && (
        <dl className="w-full space-y-1.5 text-start text-xs">
          {c.email && <Row label={t('email')} value={c.email} ltr />}
          {c.lifecycleStage && <Row label={t('stage')} value={c.lifecycleStage} />}
          {c.status && <Row label={t('status')} value={c.status} />}
          {c.ownerName && <Row label={t('owner')} value={c.ownerName} />}
          {c.source && <Row label={t('source')} value={c.source} />}
          <Row label={t('since')} value={fullStamp(c.createdAt, locale)} />
          {c.isUnsubscribed && (
            <p className="pt-1">
              <Badge tone="warning">{t('optedOut')}</Badge>
            </p>
          )}
        </dl>
      )}
    </section>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd dir={ltr ? 'ltr' : undefined} className="min-w-0 break-words text-end font-medium">
        {value}
      </dd>
    </div>
  );
}

function AssigneeSection(props: ContactPanelProps) {
  const t = useTranslations('team-inbox-conversations.panel');
  const { detail, can } = props;
  // Anyone who may assign loads the staff list; a person who may only claim needs no list.
  const assignees = useAssignees(can.assign);
  const users = assignees.data?.users ?? [];
  const teams = assignees.data?.teams ?? [];
  const current = detail.assignment.user;
  const currentTeam = detail.assignment.team;
  const resolved = detail.status === 'resolved' || detail.status === 'closed';
  const availability =
    (current && props.presence.get(current.id)) ??
    users.find((u) => u.id === current?.id)?.availability;

  return (
    <section aria-label={t('assignee.title')} className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('assignee.title')}
      </h3>
      <p className="flex items-center gap-2 text-sm" data-testid="inbox-assignee">
        {current ? (
          <>
            <Avatar id={current.id} name={current.name ?? '?'} size="sm" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {current.name ?? t('assignee.unknown')}
            </span>
            {availability && (
              <span
                role="img"
                aria-label={t(`presence.${availability}`)}
                title={t(`presence.${availability}`)}
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  availability === 'online'
                    ? 'bg-success'
                    : availability === 'busy'
                      ? 'bg-danger'
                      : availability === 'away'
                        ? 'bg-warning'
                        : 'bg-muted-foreground/40',
                )}
              />
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{t('assignee.none')}</span>
        )}
      </p>
      {currentTeam && (
        <p className="text-xs text-muted-foreground">{t('assignee.team', { name: currentTeam.name })}</p>
      )}

      {can.assign && (
        <div className="space-y-2">
          <div>
            <label htmlFor="inbox-assignee-select" className="sr-only">
              {t('assignee.pick')}
            </label>
            <Select
              id="inbox-assignee-select"
              data-testid="inbox-assignee-select"
              disabled={props.assigning || assignees.isPending}
              value={current?.id ?? ''}
              onChange={(e) => props.onAssign({ userId: e.target.value || null })}
              className="h-9 text-sm"
            >
              <option value="">{t('assignee.unassigned')}</option>
              {current && !users.some((u) => u.id === current.id) && (
                <option value={current.id}>{current.name ?? t('assignee.unknown')}</option>
              )}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                  {u.isMe ? ` (${t('assignee.you')})` : ''} · {t('assignee.open', { count: u.openConversations })}
                </option>
              ))}
            </Select>
            {assignees.isError && (
              <p role="alert" className="mt-1 text-xs text-danger">
                {t('assignee.loadFailed')}
              </p>
            )}
          </div>
          {teams.length > 0 && (
            <div>
              <label htmlFor="inbox-team-select" className="sr-only">
                {t('assignee.pickTeam')}
              </label>
              <Select
                id="inbox-team-select"
                data-testid="inbox-team-select"
                disabled={props.assigning}
                value={currentTeam?.id ?? ''}
                onChange={(e) => props.onAssign({ teamId: e.target.value || null })}
                className="h-9 text-sm"
              >
                <option value="">{t('assignee.noTeam')}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {current?.id !== props.meId && (can.assignSelf || can.assign) && (
          <Button
            size="sm"
            variant="secondary"
            data-testid="inbox-panel-assign-me"
            disabled={props.assigning}
            onClick={() => props.onAssign({ userId: props.meId })}
          >
            <UserPlusIcon width={14} height={14} />
            {t('assignee.assignToMe')}
          </Button>
        )}
        {current && can.assign && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="inbox-panel-unassign"
            disabled={props.assigning}
            onClick={() => props.onAssign({ userId: null })}
          >
            {t('assignee.unassign')}
          </Button>
        )}
        {can.resolve && (
          <Button
            size="sm"
            variant={resolved ? 'secondary' : 'primary'}
            data-testid="inbox-panel-resolve"
            disabled={props.resolving}
            onClick={props.onToggleResolved}
            className="ms-auto"
          >
            {props.resolving ? <Spinner /> : <CheckCircleIcon width={14} height={14} />}
            {resolved ? t('reopen') : t('resolve')}
          </Button>
        )}
      </div>
    </section>
  );
}

function NotesTab(props: ContactPanelProps) {
  const t = useTranslations('team-inbox-conversations.panel.notes');
  const errorText = useErrorText();
  const locale = useLocale();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = text.trim();

  async function add() {
    if (!trimmed || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await props.onAddNote(trimmed);
    setBusy(false);
    if (ok) setText('');
    else setFailed(true);
  }

  return (
    <div className="space-y-3">
      {props.can.note && (
        <div className="space-y-2">
          <label htmlFor="inbox-note-input" className="sr-only">
            {t('label')}
          </label>
          <Textarea
            id="inbox-note-input"
            data-testid="inbox-note-input"
            rows={3}
            value={text}
            maxLength={NOTE_BODY_MAX}
            placeholder={t('placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void add();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{t('hint')}</p>
            <Button
              size="sm"
              data-testid="inbox-note-add"
              disabled={!trimmed || busy}
              onClick={() => void add()}
            >
              {busy && <Spinner />}
              {t('add')}
            </Button>
          </div>
          {failed && (
            <p role="alert" className="text-xs text-danger">
              {t('addFailed')}
            </p>
          )}
        </div>
      )}

      {props.notesLoading && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      )}
      {props.notesError && (
        <p role="alert" className="text-xs text-danger">
          {errorText('NETWORK')}
        </p>
      )}
      {!props.notesLoading && !props.notesError && props.notes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}
      <ul className="space-y-2">
        {props.notes
          .slice()
          .reverse()
          .map((n) => (
            <li
              key={n.id}
              data-testid="inbox-panel-note"
              className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-sm"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <NoteIcon width={11} height={11} className="text-warning" />
                <span className="font-medium text-foreground">
                  {n.author.name ?? t('unknownAuthor')}
                </span>
                <span>· {fullStamp(n.createdAt, locale)}</span>
                {props.canDeleteNote(n) && (
                  <button
                    type="button"
                    aria-label={t('delete')}
                    title={t('delete')}
                    onClick={() => props.onDeleteNote(n.id)}
                    className="ms-auto rounded p-0.5 hover:text-danger focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <TrashIcon width={12} height={12} />
                  </button>
                )}
              </div>
              <p dir="auto" className="whitespace-pre-wrap break-words">{n.body}</p>
            </li>
          ))}
      </ul>
    </div>
  );
}

function TimelineTab({ conversationId }: { conversationId: string }) {
  const t = useTranslations('team-inbox-conversations.panel.timeline');
  const locale = useLocale();
  const q = useTimeline(conversationId, true);
  const events: ConversationEvent[] = q.data?.data ?? [];
  // Newest first, whatever order the server answers in.
  const sorted = events.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  if (q.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> {t('loading')}
      </p>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-xs text-danger">
          {t('failed')}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (sorted.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <ol className="relative ms-1 space-y-3 border-s-2 border-border ps-4" data-testid="inbox-timeline">
      {sorted.map((e) => {
        const label = eventLabel(e);
        const actor = e.actor.name ?? t(`actors.${e.actor.kind}`);
        return (
          <li key={e.id} className="relative text-sm">
            <span
              aria-hidden="true"
              className="absolute -start-[1.4rem] top-1.5 size-2 rounded-full bg-primary"
            />
            <p>
              {label.known
                ? t(`events.${label.key}`, { actor })
                : t('events.unknown', { what: label.text, actor })}
            </p>
            <p className="text-[11px] text-muted-foreground">{fullStamp(e.createdAt, locale)}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** The customer's other conversations (Reference's "past conversations"): a click opens that thread here. */
function PastConversations({
  items,
  nowMs,
  onOpen,
}: {
  items: InboxConversationDetail['pastConversations'];
  nowMs: number;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('team-inbox-conversations.panel.past');
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <section aria-label={t('title')} className="space-y-2" data-testid="inbox-past">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('title')}
      </h3>
      <ul className="space-y-1">
        {items.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p.id)}
              className="flex w-full items-start gap-2 rounded-md border border-border p-2 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChannelTag kind={p.channel.kind} name={p.channel.name} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.preview ?? t('noMessages')}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t(`status.${p.status}`)} · {listTime(p.lastMessageAt, nowMs, locale)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
