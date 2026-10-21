'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Fragment, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MenuItem, MenuSeparator, cn } from '@crm/ui';
import { CompanyLink } from '@/features/companies';
import { ScoreBadge, SparkleIcon } from '@/features/lead-scoring';
import {
  isAttrId,
  sortKeyOf,
  type ColumnDef,
  type ColumnGroup,
  type ColumnId,
} from '../lib/columns';
import type { OptIn } from '../lib/subscription';
import { formatDateTime } from '../lib/format';
import type { Choice } from '../lib/option-sets';
import {
  isMaskedPhone,
  menuActions,
  messageRoute,
  phoneDigits,
  quickActions,
  type ConnectedChannels,
} from '../lib/row-actions';
import type { AddTarget } from '../lib/sections';
import type { SendChannel } from '../lib/single-send';
import type { CheckState } from '../lib/selection';
import type { RowView } from '../lib/row-view';
import {
  frozenEdge,
  isScrolledSideways,
  SELECT_W,
  STICKY_NAME,
  STICKY_NAME_ALONE,
  STICKY_NAME_ALONE_HEAD,
  STICKY_NAME_HEAD,
  STICKY_SELECT,
  STICKY_SELECT_HEAD,
} from '../lib/sticky';
import { ContactAvatar, GroupChip, MoreChip, OutlineTag, TagChip } from './chips';
import {
  BuildingIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  FlagIcon,
  GlobeIcon,
  HashIcon,
  MailIcon,
  NoteIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  UsersPlusIcon,
  SmsIcon,
  WhatsAppIcon,
  XIcon,
} from './icons';
import { AddColumnPicker, ColumnHeaderMenu } from './column-menus';
import { RowMenu } from './row-menu';
import { StagePicker } from './stage-picker';
import { UncontactedMarker } from './lead-handling/uncontacted-marker';
import { FollowUpCell } from './lead-handling/next-follow-up';

export interface ListHandlers {
  selected: ReadonlySet<string>;
  canEdit: boolean;
  canDelete: boolean;
  stageLabel: (value: string) => string;
  /** The workspace's stages in order, for the stage cell's menu. */
  stageChoices?: readonly Choice[];
  /** Present when the person may edit contacts: the stage cell then opens the stage picker, which calls this. */
  onStageChange?: (id: string, stage: string, status?: string | null) => void;
  /** The statuses a stage offers under it in the picker, and its default one. */
  stageStatusesOf?: (stage: string) => readonly Choice[];
  stageDefaultStatusOf?: (stage: string) => string | null;
  /** Id of the contact whose stage is being saved. */
  stageBusyId?: string | null;
  /** What moving a contact holding `status` to `stage` does to its status ("Status becomes X"); null = nothing. */
  stageStatusHint?: (status: string, stage: string) => string | null;
  statusLabel: (value: string) => string;
  /** The owner's display name for the Owner column (text while loading, and for a person who has left). */
  ownerLabel?: (ownerId: string) => string;
  onToggle: (id: string) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Open the group picker for this one contact. */
  onAddToGroup: (id: string) => void;
  /** Open the tag picker for this one contact. */
  onTag: (id: string) => void;
  /** Opens the single-send drawer for one contact and channel. Without it the icons stay plain tel: / wa.me / mailto: links. */
  onSend?: (row: RowView, channel: SendChannel) => void;
  /** Tag chips become filter links when the API can filter by tag. */
  onFilterTag?: (tagId: string) => void;
  /**
   * Opens the quick view on a contact (the name link: no target) or on the section that holds an inline composer, with the cursor in
   * it (the quick add: note, task, meeting). Without it the name is a plain link to the details page.
   */
  onOpenQuick?: (id: string, target?: AddTarget) => void;
  /** Opens the chat (the inbox conversation) with a contact: what "Message" does when there is a connected WhatsApp number. */
  onChat?: (row: RowView) => void;
  /**
   * What the person may do from the row's hover actions; each icon is drawn only when its permission is held (the server checks
   * again). Left out, every action that has a handler is drawn, as before. `note` is the contact update (notes and meetings are
   * written under it) and `task` creating tasks; `meeting` defaults to `note`.
   */
  can?: {
    note?: boolean;
    task?: boolean;
    meeting?: boolean;
    call?: boolean;
    send?: boolean;
    chat?: boolean;
  };
  /** Copies a phone number or an email address (the screen writes it to the clipboard and says so); without it the menu has no copy items. */
  onCopy?: (value: string) => void;
  /** Which channels are connected (`undefined` = not known yet): "Message" is disabled, with the reason, when none can carry it. */
  connected?: ConnectedChannels;
}

/** How many chips a cell shows before collapsing the rest into "+N". */
const CHIPS_SHOWN = 2;

/** Column widths in px; the table is fixed-layout and scrolls sideways inside its card when they do not fit. */
const WIDTH: Record<string, number> = {
  name: 270,
  // wide enough for a full international number, an ordinary address and "Sales Qualified Lead" (the title still holds the whole text)
  phone: 190,
  attr: 150,
  email: 260,
  tags: 240,
  groups: 220,
  stage: 190,
  owner: 150,
  leadScore: 130,
  language: 130,
  memo: 220,
  dateOfBirth: 150,
  minor: 110,
  createdOn: 190,
  modifiedOn: 190,
  whatsapp: 140,
  sms: 130,
  emailOptIn: 130,
  company: 200,
  lastActivity: 190,
  source: 170,
  nextFollowUp: 190,
};
const widthOf = (id: ColumnId) => WIDTH[isAttrId(id) ? 'attr' : id] ?? 160;

export function tableMinWidth(columns: readonly ColumnDef[], selectable = true): number {
  return (selectable ? SELECT_W : 0) + columns.reduce((sum, c) => sum + widthOf(c.id), 0);
}

/** Leading icon of a column header, by the kind of data the column holds. */
function HeaderIcon({ id }: { id: ColumnId }) {
  const cls = 'size-3.5 shrink-0 opacity-70';
  if (isAttrId(id)) return <HashIcon className={cls} />;
  switch (id) {
    case 'name':
      return <UserIcon className={cls} />;
    case 'phone':
      return <PhoneIcon className={cls} />;
    case 'email':
      return <MailIcon className={cls} />;
    case 'tags':
      return <TagIcon className={cls} />;
    case 'groups':
      return <UsersIcon className={cls} />;
    case 'stage':
      return <FlagIcon className={cls} />;
    case 'status':
      return <FlagIcon className={cls} />;
    case 'owner':
      return <UserIcon className={cls} />;
    case 'leadScore':
      return <SparkleIcon className={cls} />;
    case 'language':
      return <GlobeIcon className={cls} />;
    case 'memo':
      return <NoteIcon className={cls} />;
    case 'dateOfBirth':
    case 'createdOn':
    case 'modifiedOn':
      return <CalendarIcon className={cls} />;
    case 'whatsapp':
      return <WhatsAppIcon className={cls} />;
    case 'sms':
      return <SmsIcon className={cls} />;
    case 'emailOptIn':
      return <MailIcon className={cls} />;
    case 'company':
      return <BuildingIcon className={cls} />;
    case 'lastActivity':
    case 'nextFollowUp':
      return <ClockIcon className={cls} />;
    case 'source':
      return <GlobeIcon className={cls} />;
    case 'minor':
      return <UserIcon className={cls} />;
  }
}

/** The "Minor" badge of the minor column (BL-190). */
function MinorCell() {
  const t = useTranslations('contacts-attributes-tags.list');
  return <OutlineTag value={t('minorBadge')} />;
}

/** The checkbox that selects every loaded row; `some` shows the mixed state. */
function HeaderCheckbox({
  state,
  onChange,
  label,
}: {
  state: CheckState;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer accent-[var(--brand)]"
    />
  );
}

const Dash = () => <span className="text-muted-foreground">-</span>;

const quickBtn =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-primary';
const quickOn = 'text-muted-foreground hover:bg-background hover:text-foreground';
const quickOff = 'cursor-not-allowed text-muted-foreground/40';

/**
 * A tooltip that shows on hover and keyboard focus. It is `fixed` and placed from the trigger's rectangle, so the list's scroll area
 * cannot clip it, and it is portalled to <body> so no row's stacking context (the sticky name cells) can paint over it. Wraps the trigger in a span because a disabled
 * button gets no mouse events. A press on the trigger hides it (a menu it opens would otherwise sit under the tip).
 */
function HoverTip({ text, children }: { text: string; children: ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setAt({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  return (
    <span
      className="inline-flex"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setAt(null)}
      // Only keyboard focus shows the tip: after a tap or a click the focus stays on the button and the tip would stay with it.
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) show(e.currentTarget);
      }}
      onBlur={() => setAt(null)}
      onPointerDown={() => setAt(null)}
    >
      {children}
      {at &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: at.x, top: at.y }}
            className="pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

/** One round icon button with a tooltip: disabled (with the reason as its tip) when there is nowhere to go. */
function QuickButton({
  enabled,
  label,
  tip,
  missing,
  color,
  onClick,
  children,
}: {
  enabled: boolean;
  label: string;
  /** The operation, shown on hover (Message, Call ...). */
  tip: string;
  missing: string;
  color?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverTip text={enabled ? tip : missing}>
      <button
        type="button"
        disabled={!enabled}
        aria-label={enabled ? label : missing}
        onClick={onClick}
        className={cn(quickBtn, enabled ? quickOn : quickOff, enabled && color)}
      >
        {children}
      </button>
    </HoverTip>
  );
}

/** Only people who hover with a pointer, on a screen wide enough for the strip, see the icons; everyone else has them in the "..." menu. */
const ICONS_ONLY = 'hidden sm:[@media(hover:hover)]:flex';
/** The menu items that repeat an icon of the strip: shown only where the strip is not. */
const WHERE_NO_ICONS = 'sm:[@media(hover:hover)]:hidden';

/**
 * What the person does most from the list, over the end of a contact's name while the row is hovered or has keyboard focus: Message
 * (the WhatsApp chat, or an email when there is no number or none is connected), Call, and a quick add (note, task or meeting, which
 * opens the quick view with that composer focused), then the "..." menu with everything else (open details, in a new tab, edit, email,
 * SMS, copy phone or email, add to group, tag, delete). The strip is laid over the cell (absolutely positioned, with a fade behind it),
 * so showing it never changes a row or a column. An icon is drawn only where the person has its permission, and is disabled with the
 * reason as its tooltip when the contact cannot be reached that way. On a touch screen and below 640 px only the "..." menu shows (and
 * stays visible), and it holds what the icons hold.
 */
function QuickActions({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  const ts = useTranslations('contacts-attributes-tags.singleSend');
  const [menuOpen, setMenuOpen] = useState(false);
  const links = quickActions(row);
  const name = row.name || t('unnamed');
  const items = menuActions({ edit: h.canEdit, delete: h.canDelete });
  const can = { note: true, task: true, call: true, send: true, chat: true, ...h.can };
  const canNote = Boolean(h.onOpenQuick) && h.canEdit && can.note;
  const canMeeting = Boolean(h.onOpenQuick) && h.canEdit && (can.meeting ?? can.note);
  const canTask = Boolean(h.onOpenQuick) && can.task;
  const canAdd = canNote || canTask || canMeeting;
  const send = h.onSend;
  const route = messageRoute(row, h.connected);
  const canMessage = (can.chat && Boolean(h.onChat)) || (can.send && Boolean(send));
  const message = () => {
    if (route.kind === 'chat') h.onChat?.(row);
    else if (route.kind === 'email') send?.(row, 'email');
  };
  const whyNoMessage = route.kind === 'blocked' ? t(`noMessage_${route.reason}`) : '';
  const phone = isMaskedPhone(row.phone) ? '' : phoneDigits(row.phone);
  const copy = h.onCopy;
  const quick = (target: AddTarget) => () => h.onOpenQuick?.(row.id, target);
  return (
    <div
      className={cn(
        'absolute inset-y-0 end-0 flex items-center gap-0.5 pe-1 ps-6 transition-opacity focus-within:opacity-100',
        // The fade: the name runs under it instead of being squeezed, so the cell never changes width.
        'bg-[linear-gradient(to_right,transparent,var(--row-bg,var(--background))_1.5rem)] rtl:bg-[linear-gradient(to_left,transparent,var(--row-bg,var(--background))_1.5rem)]',
        // Hover-capable screens show the strip on hover and focus; a narrow or touch screen keeps the "..." in view.
        '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 max-sm:!opacity-100',
        menuOpen && '!opacity-100',
      )}
    >
      <span className={cn(ICONS_ONLY, 'items-center gap-0.5')}>
        {canMessage && (
          <QuickButton
            enabled={route.kind !== 'blocked'}
            label={t('messageNamed', { name })}
            missing={whyNoMessage}
            tip={t('message')}
            onClick={message}
          >
            <ChatIcon className="size-3.5" />
          </QuickButton>
        )}
        {send && can.call && (
          <QuickButton
            enabled={Boolean(links.call)}
            label={t('callNamed', { name })}
            missing={t('noPhone')}
            tip={ts('title.call')}
            onClick={() => send(row, 'call')}
          >
            <PhoneIcon className="size-3.5" />
          </QuickButton>
        )}
        {canAdd && (
          <HoverTip text={t('quickAdd')}>
            <RowMenu
              label={t('quickAddNamed', { name })}
              icon={<PlusIcon className="size-3.5" />}
              titleAttr={false}
              className="size-6"
              onOpenChange={setMenuOpen}
            >
              {(close) => (
                <>
                  {canNote && (
                    <MenuItem
                      onSelect={() => {
                        close();
                        quick('note')();
                      }}
                    >
                      <NoteIcon /> {t('addNote')}
                    </MenuItem>
                  )}
                  {canTask && (
                    <MenuItem
                      onSelect={() => {
                        close();
                        quick('task')();
                      }}
                    >
                      <CheckIcon /> {t('addTask')}
                    </MenuItem>
                  )}
                  {canMeeting && (
                    <MenuItem
                      onSelect={() => {
                        close();
                        quick('meeting')();
                      }}
                    >
                      <CalendarIcon /> {t('addMeeting')}
                    </MenuItem>
                  )}
                </>
              )}
            </RowMenu>
          </HoverTip>
        )}
      </span>
      <HoverTip text={t('moreTip')}>
        <RowMenu
          label={t('moreFor', { name })}
          titleAttr={false}
          onOpenChange={setMenuOpen}
          className="size-6"
        >
          {(close) => {
            const run = (fn: () => void) => () => {
              close();
              fn();
            };
            return (
              <>
                {canMessage && (
                  <MenuItem
                    className={WHERE_NO_ICONS}
                    disabled={route.kind === 'blocked'}
                    onSelect={run(message)}
                  >
                    <ChatIcon />
                    <span className="min-w-0">
                      <span className="block">{t('message')}</span>
                      {route.kind === 'blocked' && (
                        <span className="block text-[11px] text-muted-foreground">
                          {whyNoMessage}
                        </span>
                      )}
                    </span>
                  </MenuItem>
                )}
                {send && can.call && (
                  <MenuItem
                    className={WHERE_NO_ICONS}
                    disabled={!links.call}
                    onSelect={run(() => send(row, 'call'))}
                  >
                    <PhoneIcon /> {ts('title.call')}
                  </MenuItem>
                )}
                {canNote && (
                  <MenuItem className={WHERE_NO_ICONS} onSelect={run(quick('note'))}>
                    <NoteIcon /> {t('addNote')}
                  </MenuItem>
                )}
                {canTask && (
                  <MenuItem className={WHERE_NO_ICONS} onSelect={run(quick('task'))}>
                    <CheckIcon /> {t('addTask')}
                  </MenuItem>
                )}
                {canMeeting && (
                  <MenuItem className={WHERE_NO_ICONS} onSelect={run(quick('meeting'))}>
                    <CalendarIcon /> {t('addMeeting')}
                  </MenuItem>
                )}
                {items.map((a) => {
                  switch (a) {
                    case 'view':
                      return (
                        <Fragment key={a}>
                          <MenuItem onSelect={run(() => h.onView(row.id))}>
                            <EyeIcon /> {t('view')}
                          </MenuItem>
                          <MenuItem
                            onSelect={run(() =>
                              window.open(`/contacts/${row.id}`, '_blank', 'noopener,noreferrer'),
                            )}
                          >
                            <ExternalLinkIcon /> {t('openNewTab')}
                          </MenuItem>
                        </Fragment>
                      );
                    case 'edit':
                      return (
                        <Fragment key={a}>
                          <MenuItem onSelect={run(() => h.onEdit(row.id))}>
                            <PencilIcon /> {t('edit')}
                          </MenuItem>
                          {send && can.send && (
                            <>
                              <MenuItem
                                disabled={!links.email}
                                onSelect={run(() => send(row, 'email'))}
                              >
                                <MailIcon /> {t('sendEmail')}
                              </MenuItem>
                              <MenuItem
                                disabled={!links.whatsapp}
                                onSelect={run(() => send(row, 'whatsapp'))}
                              >
                                <WhatsAppIcon /> {ts('title.whatsapp')}
                              </MenuItem>
                              <MenuItem
                                disabled={!links.call}
                                onSelect={run(() => send(row, 'sms'))}
                              >
                                <SmsIcon /> {t('sendSms')}
                              </MenuItem>
                            </>
                          )}
                        </Fragment>
                      );
                    case 'group':
                      return (
                        <MenuItem key={a} onSelect={run(() => h.onAddToGroup(row.id))}>
                          <UsersPlusIcon /> {t('addToGroup')}
                        </MenuItem>
                      );
                    case 'tag':
                      return (
                        <MenuItem key={a} onSelect={run(() => h.onTag(row.id))}>
                          <TagIcon /> {t('tag')}
                        </MenuItem>
                      );
                    case 'delete':
                      return (
                        <Fragment key={a}>
                          <MenuSeparator />
                          <MenuItem danger onSelect={run(() => h.onDelete(row.id))}>
                            <TrashIcon /> {t('delete')}
                          </MenuItem>
                        </Fragment>
                      );
                  }
                })}
                {copy && (phone || row.email.trim()) && <MenuSeparator />}
                {copy && phone && (
                  <MenuItem onSelect={run(() => copy(phone))}>
                    <PhoneIcon /> {t('copyPhone')}
                  </MenuItem>
                )}
                {copy && row.email.trim() && (
                  <MenuItem onSelect={run(() => copy(row.email.trim()))}>
                    <MailIcon /> {t('copyEmail')}
                  </MenuItem>
                )}
              </>
            );
          }}
        </RowMenu>
      </HoverTip>
    </div>
  );
}

/** The contact's status as a pill (its own column; the grid card shows it next to the stage). */
function StatusChip({ value }: { value: string }) {
  return (
    <span
      title={value}
      className="inline-flex max-w-full items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
    >
      <span className="truncate">{value}</span>
    </span>
  );
}

function StatusCell({
  row,
  h,
  showStatus = true,
}: {
  row: RowView;
  h: ListHandlers;
  showStatus?: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (!row.stage && !(showStatus && row.status) && !row.optedOut) return <Dash />;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {row.stage && (
        <StagePicker
          value={row.stage}
          status={row.status || null}
          stages={h.stageChoices ?? []}
          label={h.stageLabel(row.stage)}
          statusesOf={h.stageStatusesOf}
          defaultStatusOf={h.stageDefaultStatusOf}
          name={row.name || t('unnamed')}
          busy={h.stageBusyId === row.id}
          quietCaret
          readOnly={!h.onStageChange}
          onPick={(stage, status) => h.onStageChange?.(row.id, stage, status)}
          hint={
            h.stageStatusHint
              ? (stage) => h.stageStatusHint?.(row.status, stage) ?? null
              : undefined
          }
        />
      )}
      {showStatus && row.status && <StatusChip value={h.statusLabel(row.status)} />}
      {row.optedOut && (
        <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          {t('optedOut')}
        </span>
      )}
    </div>
  );
}

function TagsCell({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (row.tags.length === 0) return <Dash />;
  const shown = row.tags.slice(0, CHIPS_SHOWN);
  const rest = row.tags.slice(CHIPS_SHOWN);
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map((tag) =>
        h.onFilterTag ? (
          <button
            key={tag.id}
            type="button"
            title={t('filterByTag', { name: tag.name })}
            onClick={() => h.onFilterTag?.(tag.id)}
            className="min-w-0 rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <TagChip name={tag.name} color={tag.color} />
          </button>
        ) : (
          <TagChip key={tag.id} name={tag.name} color={tag.color} />
        ),
      )}
      {rest.length > 0 && (
        <MoreChip count={rest.length} title={rest.map((x) => x.name).join(', ')} />
      )}
    </div>
  );
}

function GroupsCell({ row }: { row: RowView }) {
  if (row.groups.length === 0) return <Dash />;
  // Group chips carry a name and a dot, so only one fits the column.
  const rest = row.groups.slice(1);
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {row.groups.slice(0, 1).map((g) => (
        <GroupChip key={g.id} name={g.name} color={g.color} />
      ))}
      {rest.length > 0 && (
        <MoreChip count={rest.length} title={rest.map((x) => x.name).join(', ')} />
      )}
    </div>
  );
}

/** Text that ends in an ellipsis, with the full value on hover; "-" when there is none. */
function Clip({
  value,
  ltr,
  mono,
  tip,
}: {
  value: string;
  ltr?: boolean;
  mono?: boolean;
  /** A longer text for the tooltip (the date's time) when the cell shows less. */
  tip?: string;
}) {
  if (!value) return <Dash />;
  return (
    <span
      title={tip ?? value}
      dir={ltr ? 'ltr' : undefined}
      className={cn('block truncate text-start', mono && 'tabular-nums')}
    >
      {value}
    </span>
  );
}

/** A rounded outlined pill with a small leading icon; the value truncates and the full text is the tooltip. */
function Pill({ value, icon }: { value: string; icon: ReactNode }) {
  if (!value) return <Dash />;
  return (
    <span
      title={value}
      dir="ltr"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs tabular-nums"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

/** Initials avatar and name; a contact nobody owns says so in muted text instead of leaving a dash. */
function OwnerCell({
  ownerId,
  label,
}: {
  ownerId: string | null;
  label: ListHandlers['ownerLabel'];
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (!ownerId) return <span className="text-muted-foreground">{t('unassigned')}</span>;
  const name = label?.(ownerId) ?? '';
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <ContactAvatar id={ownerId} name={name} className="opacity-70 saturate-50" />
      <span className="truncate" title={name || undefined}>
        {name}
      </span>
    </span>
  );
}

function NameCell({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <div className="relative flex min-w-0 items-center self-stretch">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <ContactAvatar id={row.id} name={row.name} className="hidden sm:inline-flex" />
        <Link
          href={`/contacts/${row.id}`}
          title={row.name || undefined}
          // A plain click opens the quick view; a modified click (new tab, new window) still goes to the details page.
          onClick={(e) => {
            if (!h.onOpenQuick || e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            h.onOpenQuick(row.id);
          }}
          className="min-w-0 truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary max-sm:max-w-[calc(100%-2rem)] [@media(hover:none)]:max-w-[calc(100%-2rem)]"
        >
          {row.name || t('unnamed')}
        </Link>
        <UncontactedMarker since={row.uncontactedSince} variant="dot" />
      </div>
      <QuickActions row={row} h={h} />
    </div>
  );
}

/**
 * A channel's opt-in as a quiet mark, not a word on every row: a green tick when the contact opted in, a faint grey dot when nothing is
 * recorded, a red cross when the contact opted out of marketing. The tooltip (and screen readers) say which, with the channel's name.
 */
function OptInChip({ value, channel }: { value: OptIn; channel: string }) {
  const t = useTranslations('contacts-attributes-tags.list');
  const yes = value === 'yes';
  return (
    <span
      title={value === 'out' ? t('optInOut') : `${channel}: ${yes ? t('yes') : t('no')}`}
      className="inline-flex items-center"
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-5 items-center justify-center rounded-full',
          yes && 'bg-success/15 text-success',
          value === 'no' && 'text-muted-foreground/50',
          value === 'out' && 'bg-danger/10 text-danger',
        )}
      >
        {yes ? (
          <CheckIcon className="size-3" />
        ) : value === 'out' ? (
          <XIcon className="size-3" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      <span className="sr-only">{yes ? t('yes') : t('no')}</span>
    </span>
  );
}

function Cell({
  column,
  row,
  h,
  locale,
  timeZone,
}: {
  column: ColumnDef;
  row: RowView;
  h: ListHandlers;
  locale: string;
  timeZone: string | undefined;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const id = column.id;
  if (isAttrId(id)) return <Clip value={row.custom[column.attributeKey ?? ''] ?? ''} />;
  switch (id) {
    case 'name':
      return <NameCell row={row} h={h} />;
    case 'phone':
      return <Pill value={row.phone} icon={<PhoneIcon className="size-3" />} />;
    case 'email':
      return <Pill value={row.email} icon={<MailIcon className="size-3" />} />;
    case 'tags':
      return <TagsCell row={row} h={h} />;
    case 'groups':
      return <GroupsCell row={row} />;
    case 'stage':
      return <StatusCell row={row} h={h} showStatus={false} />;
    case 'status':
      return row.status ? <StatusChip value={h.statusLabel(row.status)} /> : <Dash />;
    case 'owner':
      return <OwnerCell ownerId={row.ownerId} label={h.ownerLabel} />;
    case 'leadScore':
      return row.leadScore === null ? (
        <Dash />
      ) : (
        <ScoreBadge
          score={row.leadScore}
          source={row.leadScoreSource}
          scoredAt={row.leadScoredAt}
        />
      );
    case 'language':
      return row.language ? <OutlineTag value={row.language} /> : <Dash />;
    case 'memo':
      return <Clip value={row.memo} />;
    case 'dateOfBirth':
      return row.dateOfBirth ? (
        <Clip
          value={new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date(`${row.dateOfBirth}T00:00:00Z`),
          )}
          mono
        />
      ) : (
        <Dash />
      );
    case 'minor':
      return row.isMinor ? <MinorCell /> : <Dash />;
    case 'createdOn':
      return <Clip value={formatDateTime(row.createdAt, locale, timeZone)} mono />;
    case 'modifiedOn':
      return <Clip value={formatDateTime(row.updatedAt, locale, timeZone)} mono />;
    case 'whatsapp':
      return <OptInChip value={row.whatsappOptIn} channel={t('colWhatsapp')} />;
    case 'sms':
      return <OptInChip value={row.smsOptIn} channel={t('colSms')} />;
    case 'emailOptIn':
      return <OptInChip value={row.emailOptIn} channel={t('colEmailOptIn')} />;
    case 'company':
      return row.companyId ? (
        <CompanyLink id={row.companyId} className="block truncate" />
      ) : (
        <Dash />
      );
    case 'lastActivity':
      return row.lastActivityAt ? (
        <Clip value={formatDateTime(row.lastActivityAt, locale, timeZone)} mono />
      ) : (
        <Dash />
      );
    case 'source':
      return <Clip value={row.source} />;
    case 'nextFollowUp':
      return <FollowUpCell followUp={row.nextFollowUp} locale={locale} timeZone={timeZone} />;
  }
}

export interface TableSort {
  /** The API sort in force (`createdAt` when nothing was chosen). */
  key: string;
  order: 'asc' | 'desc';
}

function SortArrow({ order, active }: { order: 'asc' | 'desc'; active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn(
        'size-3 shrink-0 transition',
        active ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40',
      )}
    >
      <path d={order === 'asc' ? 'M8 3l4 5H4z' : 'M8 13L4 8h8z'} fill="currentColor" />
    </svg>
  );
}

/** Width in px of the "+" column that ends the header row. */
const ADD_W = 44;

/** What the header row needs to offer the "+" picker and the per-column menu. */
export interface ColumnTools {
  /** The columns not shown yet, grouped. */
  addable: ReadonlyArray<{ group: ColumnGroup; columns: ColumnDef[] }>;
  onAdd: (id: ColumnId) => void;
  onHide: (id: ColumnId) => void;
  /** Whether a column has a filter; the header menu then offers "Filter". */
  hasFilter: (id: ColumnId) => boolean;
  onFilter: (id: ColumnId) => void;
  /** Opens where a custom property is made; absent when the person may not manage them. */
  onAddField?: () => void;
}

export function ContactsTable({
  rows,
  columns,
  headerState,
  onToggleAll,
  selectable = true,
  sort,
  onSort,
  onSortTo,
  onMoveColumn,
  onNudgeColumn,
  columnTools,
  ...h
}: {
  rows: RowView[];
  columns: readonly ColumnDef[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
  /** False for a read-only listing (the members of a segment): no checkbox column, the name column is frozen alone. */
  selectable?: boolean;
  /** With `onSort`, column headers sort the list (not on a read-only listing or a column with many values). */
  sort?: TableSort;
  onSort?: (key: string) => void;
  /** The header menu's "Sort A to Z" / "Z to A": sort by a column in a given order. */
  onSortTo?: (key: string, order: 'asc' | 'desc') => void;
  /** With these, headers can be dragged (or moved with Alt + arrow keys) to rearrange the columns. */
  onMoveColumn?: (id: ColumnId, target: ColumnId) => void;
  onNudgeColumn?: (id: ColumnId, step: -1 | 1) => void;
  /** With this, the header row ends in the "+" column picker and every header gets its menu. */
  columnTools?: ColumnTools;
} & ListHandlers) {
  const t = useTranslations('contacts-attributes-tags.list');
  const [dragging, setDragging] = useState<ColumnId | null>(null);
  const [over, setOver] = useState<ColumnId | null>(null);
  const locale = useLocale();
  const timeZone = useTimeZone();
  // The shadow along the frozen edge shows only once something has scrolled underneath it.
  const [scrolled, setScrolled] = useState(false);
  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar relative h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: tableMinWidth(columns, selectable) + (columnTools ? ADD_W : 0) }}
      >
        <colgroup>
          {selectable && <col style={{ width: SELECT_W }} />}
          {columns.map((c) => (
            <col
              key={c.id}
              className={c.id === 'name' ? 'w-[200px] sm:w-[270px]' : undefined}
              style={c.id === 'name' ? undefined : { width: widthOf(c.id) }}
            />
          ))}
          {columnTools && <col style={{ width: ADD_W }} />}
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th className={cn(th, 'py-2.5 ps-4 pe-2', STICKY_SELECT_HEAD)}>
                <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
              </th>
            )}
            {columns.map((c) => {
              const label = 'key' in c.label ? t(c.label.key) : c.label.text;
              // A short heading where the full one would be cut off; the full label is the tooltip and the menu's name.
              const shown = c.short ? t(c.short.key) : label;
              const key = onSort ? sortKeyOf(c.id) : null;
              const active = key !== null && sort?.key === key;
              const movable = !!onMoveColumn && c.id !== 'name';
              const heading = (
                <span className="flex min-w-0 items-center gap-1.5">
                  <HeaderIcon id={c.id} />
                  <span className="truncate">{shown}</span>
                  {key !== null && (
                    <SortArrow order={active ? sort!.order : 'asc'} active={active} />
                  )}
                </span>
              );
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={
                    active ? (sort!.order === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  draggable={movable}
                  onDragStart={
                    movable
                      ? (e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', c.id);
                          setDragging(c.id);
                        }
                      : undefined
                  }
                  onDragOver={
                    dragging && c.id !== 'name' && c.id !== dragging
                      ? (e) => {
                          e.preventDefault();
                          setOver(c.id);
                        }
                      : undefined
                  }
                  onDrop={
                    dragging
                      ? (e) => {
                          e.preventDefault();
                          if (c.id !== 'name' && c.id !== dragging) onMoveColumn?.(dragging, c.id);
                          setDragging(null);
                          setOver(null);
                        }
                      : undefined
                  }
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn(
                    th,
                    'group/th',
                    movable && 'cursor-grab',
                    dragging === c.id && 'opacity-50',
                    over === c.id && 'bg-brand/10',
                    c.id === 'name' &&
                      `${selectable ? STICKY_NAME_HEAD : STICKY_NAME_ALONE_HEAD} ${frozenEdge(scrolled)}`,
                  )}
                >
                  <div className="flex items-center gap-1">
                    {key !== null ? (
                      <button
                        type="button"
                        onClick={() => onSort?.(key)}
                        onKeyDown={(e) => {
                          if (!movable || !e.altKey) return;
                          const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                          if (!step) return;
                          // In a right-to-left page the arrows point the other way round.
                          const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                          e.preventDefault();
                          onNudgeColumn?.(c.id, (rtl ? -step : step) as -1 | 1);
                        }}
                        title={t('sortBy', { column: label })}
                        className="flex min-w-0 flex-1 items-center rounded text-start uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {heading}
                      </button>
                    ) : (
                      <div className="min-w-0 flex-1" title={shown !== label ? label : undefined}>
                        {heading}
                      </div>
                    )}
                    {columnTools && (
                      <ColumnHeaderMenu
                        column={c}
                        label={label}
                        sort={key !== null ? { active: active ? sort!.order : null } : null}
                        onSort={
                          key !== null && onSortTo ? (order) => onSortTo(key, order) : undefined
                        }
                        onHide={() => columnTools.onHide(c.id)}
                        onFilter={
                          columnTools.hasFilter(c.id) ? () => columnTools.onFilter(c.id) : undefined
                        }
                      />
                    )}
                  </div>
                </th>
              );
            })}
            {columnTools && (
              <th
                scope="col"
                className={cn(th, 'sticky end-0 z-30 border-s border-border px-1 text-center')}
              >
                <AddColumnPicker
                  groups={columnTools.addable}
                  onAdd={columnTools.onAdd}
                  onAddField={columnTools.onAddField}
                />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSel = h.selected.has(row.id);
            return (
              <tr
                key={row.id}
                data-selected={isSel}
                className={cn(
                  'group h-12 align-middle transition-colors [--row-bg:var(--background)] hover:bg-muted hover:[--row-bg:var(--muted)]',
                  isSel &&
                    'bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))] [--row-bg:color-mix(in_srgb,var(--brand)_8%,var(--background))]',
                )}
              >
                {selectable && (
                  <td className={cn('border-b border-border ps-4 pe-2', STICKY_SELECT)}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => h.onToggle(row.id)}
                      aria-label={t('selectRow', { name: row.name || t('unnamed') })}
                      className="size-4 cursor-pointer accent-[var(--brand)]"
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'max-w-0 border-b border-border px-3 py-1.5',
                      c.id === 'name' &&
                        `${selectable ? STICKY_NAME : STICKY_NAME_ALONE} ${frozenEdge(scrolled)}`,
                    )}
                  >
                    <Cell column={c} row={row} h={h} locale={locale} timeZone={timeZone} />
                  </td>
                ))}
                {columnTools && (
                  <td
                    className="sticky end-0 z-10 border-b border-s border-border bg-[var(--row-bg,var(--background))]"
                    aria-hidden="true"
                  />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
