'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Badge, MenuItem, MenuSeparator, cn } from '@crm/ui';
import type { TaskResponse } from '@crm/contracts';
import { type ColumnId } from '../lib/columns';
import { formatDateTime } from '../lib/format';
import type { CheckState } from '../lib/selection';
import {
  frozenEdge,
  isScrolledSideways,
  SELECT_W,
  STICKY_SELECT,
  STICKY_SELECT_HEAD,
  STICKY_TITLE,
  STICKY_TITLE_HEAD,
  tableMinWidth,
  WIDTH,
} from '../lib/sticky';
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  ContactIcon,
  DealIcon,
  EyeIcon,
  FlagIcon,
  PencilIcon,
  TrashIcon,
  UserIcon,
} from './icons';
import { Avatar, CompleteCheck, DueText, PriorityChip, RecordPill } from './parts';
import { RowMenu } from './row-menu';

export interface RowHandlers {
  selected: ReadonlySet<string>;
  /** The row the keyboard is on. */
  activeId: string | null;
  canUpdate: boolean;
  canDelete: boolean;
  now: Date;
  zone: string | undefined;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleComplete: (task: TaskResponse) => void;
  onEdit: (task: TaskResponse) => void;
  onDelete: (task: TaskResponse) => void;
}

function HeaderIcon({ id }: { id: ColumnId }) {
  const cls = 'size-3.5 shrink-0 opacity-70';
  switch (id) {
    case 'title':
      return <CheckIcon className={cls} />;
    case 'priority':
      return <FlagIcon className={cls} />;
    case 'due':
      return <CalendarIcon className={cls} />;
    case 'assignee':
      return <UserIcon className={cls} />;
    case 'contact':
      return <ContactIcon className={cls} />;
    case 'deal':
      return <DealIcon className={cls} />;
    case 'created':
    case 'completed':
      return <ClockIcon className={cls} />;
  }
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

/** The "..." menu of one task: open, edit, complete or reopen, delete. */
export function TaskRowMenu({ task, h }: { task: TaskResponse; h: RowHandlers }) {
  const t = useTranslations('tasks.row');
  return (
    <RowMenu label={t('moreFor', { title: task.title })}>
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <MenuItem onSelect={run(() => h.onOpen(task.id))}>
              <EyeIcon /> {t('open')}
            </MenuItem>
            {h.canUpdate && (
              <MenuItem onSelect={run(() => h.onEdit(task))}>
                <PencilIcon /> {t('edit')}
              </MenuItem>
            )}
            {h.canUpdate && (
              <MenuItem onSelect={run(() => h.onToggleComplete(task))}>
                <CheckIcon /> {task.status === 'done' ? t('reopen') : t('complete')}
              </MenuItem>
            )}
            {h.canDelete && (
              <Fragment>
                <MenuSeparator />
                <MenuItem danger onSelect={run(() => h.onDelete(task))}>
                  <TrashIcon /> {t('delete')}
                </MenuItem>
              </Fragment>
            )}
          </>
        );
      }}
    </RowMenu>
  );
}

function TitleCell({ task, h }: { task: TaskResponse; h: RowHandlers }) {
  const t = useTranslations('tasks.row');
  const done = task.status === 'done';
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CompleteCheck
        done={done}
        title={task.title}
        disabled={!h.canUpdate}
        onToggle={() => h.onToggleComplete(task)}
      />
      <button
        type="button"
        onClick={() => h.onOpen(task.id)}
        title={task.title}
        dir="auto"
        className={cn(
          'min-w-0 flex-1 truncate text-start font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary',
          done && 'text-muted-foreground line-through',
        )}
      >
        {task.title}
      </button>
      {task.kind === 'follow_up' && <Badge>{t('followUpBadge')}</Badge>}
      <TaskRowMenu task={task} h={h} />
    </div>
  );
}

function Cell({
  id,
  task,
  h,
  locale,
}: {
  id: ColumnId;
  task: TaskResponse;
  h: RowHandlers;
  locale: string;
}) {
  const t = useTranslations('tasks.row');
  switch (id) {
    case 'title':
      return <TitleCell task={task} h={h} />;
    case 'priority':
      return <PriorityChip priority={task.priority} />;
    case 'due':
      return <DueText task={task} now={h.now} zone={h.zone} />;
    case 'assignee':
      return task.assignee ? (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Avatar name={task.assignee.name} />
          <span className="truncate" title={task.assignee.name}>
            {task.assignee.name}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">{t('unassigned')}</span>
      );
    case 'contact':
      return task.contact ? (
        <RecordPill kind="contact" id={task.contact.id} label={task.contact.name} />
      ) : (
        <Dash />
      );
    case 'deal':
      return task.deal ? (
        <RecordPill kind="deal" id={task.deal.id} label={task.deal.title} />
      ) : (
        <Dash />
      );
    case 'created':
      return (
        <span className="block truncate tabular-nums text-muted-foreground">
          {formatDateTime(task.createdAt, locale, h.zone) || '-'}
        </span>
      );
    case 'completed':
      return (
        <span className="block truncate tabular-nums text-muted-foreground">
          {formatDateTime(task.doneAt, locale, h.zone) || '-'}
        </span>
      );
  }
}

export function TasksTable({
  tasks,
  columns,
  headerState,
  onToggleAll,
  ...h
}: {
  tasks: readonly TaskResponse[];
  columns: readonly ColumnId[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
} & RowHandlers) {
  const t = useTranslations('tasks.table');
  const locale = useLocale();
  // The shadow along the frozen edge shows only once something has scrolled underneath it.
  const [scrolled, setScrolled] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Keep the keyboard's row in view.
  useEffect(() => {
    if (!h.activeId) return;
    box.current
      ?.querySelector<HTMLElement>(`[data-row-id="${h.activeId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [h.activeId]);

  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <div
      ref={box}
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      // `relative`: the scroller must be the containing block of the rows' visually hidden (absolutely positioned) labels, or they
      // keep their place in the wide table and push the page itself sideways on a phone.
      className="thin-scrollbar relative h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: tableMinWidth(columns) }}
      >
        <colgroup>
          <col style={{ width: SELECT_W }} />
          {columns.map((c) => (
            <col
              key={c}
              className={c === 'title' ? 'w-[260px] sm:w-[360px]' : undefined}
              style={c === 'title' ? undefined : { width: WIDTH[c] }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={cn(th, 'py-3 ps-4 pe-2', STICKY_SELECT_HEAD)}>
              <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
            </th>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(th, c === 'title' && `${STICKY_TITLE_HEAD} ${frozenEdge(scrolled)}`)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <HeaderIcon id={c} />
                  <span className="truncate">{t(`columns.${c}`)}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const isSel = h.selected.has(task.id);
            return (
              <tr
                key={task.id}
                data-row-id={task.id}
                data-selected={isSel}
                data-active={h.activeId === task.id}
                className={cn(
                  'group h-14 align-middle transition-colors hover:bg-muted data-[active=true]:bg-muted',
                  isSel && 'bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))]',
                )}
              >
                <td className={cn('border-b border-border ps-4 pe-2', STICKY_SELECT)}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => h.onToggleSelect(task.id)}
                    aria-label={t('selectRow', { title: task.title })}
                    className="size-4 cursor-pointer accent-[var(--brand)]"
                  />
                </td>
                {columns.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      'max-w-0 border-b border-border px-3 py-2',
                      c === 'title' && `${STICKY_TITLE} ${frozenEdge(scrolled)}`,
                    )}
                  >
                    <Cell id={c} task={task} h={h} locale={locale} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
