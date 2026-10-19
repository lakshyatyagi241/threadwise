'use client';

import { useState } from 'react';
import { useFormatter } from 'next-intl';
import { Badge, Menu, MenuItem, Switch, cn } from '@crm/ui';
import type { AssignmentRule } from '@crm/contracts';
import { reorderIds, ruleGroup } from '../lib/reorder';
import { useRa } from './use-ra';

export interface RuleListProps {
  /** The rules of ONE module in display order (`sortRules`). */
  rules: readonly AssignmentRule[];
  canManage: boolean;
  busy: boolean;
  /** The conditions of a rule as one sentence. */
  summaryOf: (rule: AssignmentRule) => string;
  nameOfPerson: (id: string) => string;
  nameOfTeam: (id: string) => string;
  onToggle: (rule: AssignmentRule) => void;
  onReorder: (ids: string[], movedId: string) => void;
  onEdit: (rule: AssignmentRule) => void;
  onClone: (rule: AssignmentRule) => void;
  onDelete: (rule: AssignmentRule) => void;
}

const GRID =
  'md:grid md:grid-cols-[4.5rem_minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_auto_minmax(0,1fr)_auto] md:items-center md:gap-3';

function Grip({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('size-4', className)}
      fill="currentColor"
    >
      <circle cx="5" cy="3" r="1.3" />
      <circle cx="11" cy="3" r="1.3" />
      <circle cx="5" cy="8" r="1.3" />
      <circle cx="11" cy="8" r="1.3" />
      <circle cx="5" cy="13" r="1.3" />
      <circle cx="11" cy="13" r="1.3" />
    </svg>
  );
}

const arrowBtn =
  'inline-flex size-8 items-center justify-center rounded-md border border-border text-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

/**
 * The priority table of one module. A rule's number is its priority among the active rules (1 runs first); fallbacks run after every
 * other rule and paused rules are not prioritised. Rows drag by their handle, and every row has move up / move down buttons for the
 * keyboard; a rule only moves inside its own group.
 */
export function RuleList({
  rules,
  canManage,
  busy,
  summaryOf,
  nameOfPerson,
  nameOfTeam,
  onToggle,
  onReorder,
  onEdit,
  onClone,
  onDelete,
}: RuleListProps) {
  const { t } = useRa();
  const format = useFormatter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const drop = (targetId: string) => {
    const moved = dragging;
    setDragging(null);
    setOver(null);
    if (!moved) return;
    const ids = reorderIds(rules, moved, { overId: targetId });
    if (ids) onReorder(ids, moved);
  };

  return (
    <div data-testid="ra-rules">
      <div
        aria-hidden="true"
        className={cn(
          GRID,
          'hidden border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground',
        )}
      >
        <span>{t('list.col.priority')}</span>
        <span>{t('list.col.rule')}</span>
        <span>{t('list.col.assignTo')}</span>
        <span>{t('list.col.method')}</span>
        <span>{t('list.col.active')}</span>
        <span>{t('list.col.used')}</span>
        <span />
      </div>
      <ol className="space-y-2 md:space-y-0 md:divide-y md:divide-border">
        {rules.map((r) => {
          const group = ruleGroup(r);
          const canUp = reorderIds(rules, r.id, { step: -1 }) !== null;
          const canDown = reorderIds(rules, r.id, { step: 1 }) !== null;
          const who = [
            ...r.userIds.map(nameOfPerson),
            ...r.teamIds.map((id) => t('list.teamName', { name: nameOfTeam(id) })),
          ];
          const shown = who.slice(0, 3);
          return (
            <li
              key={r.id}
              data-testid={`ra-rule-${r.id}`}
              draggable={canManage && !busy}
              onDragStart={(e) => {
                setDragging(r.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', r.id);
              }}
              onDragOver={(e) => {
                if (!dragging || dragging === r.id) return;
                if (reorderIds(rules, dragging, { overId: r.id }) === null) return;
                e.preventDefault();
                setOver(r.id);
              }}
              onDragLeave={() => setOver((cur) => (cur === r.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                drop(r.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                GRID,
                'space-y-2 rounded-md border border-border p-3 md:space-y-0 md:rounded-none md:border-0',
                group === 'paused' && 'bg-muted/40',
                dragging === r.id && 'opacity-40',
                over === r.id && 'bg-primary/5 shadow-[inset_0_2px_0_0_var(--primary)]',
              )}
            >
              <div className="flex items-center gap-2">
                {canManage && (
                  <span
                    aria-label={t('list.dragHandle', { name: r.name })}
                    role="img"
                    className="cursor-grab text-muted-foreground"
                  >
                    <Grip />
                  </span>
                )}
                <span
                  className="grid size-7 place-items-center rounded-full bg-muted text-xs font-semibold"
                  title={r.priority === null ? t('list.notPrioritised') : undefined}
                >
                  {r.priority ?? '–'}
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="min-w-0 break-words" dir="auto">
                    {r.name}
                  </span>
                  {r.isFallback && (
                    <Badge title={t('list.fallbackHint')} tone="neutral">
                      {t('list.fallback')}
                    </Badge>
                  )}
                  {!r.isActive && <Badge tone="warning">{t('list.notPrioritised')}</Badge>}
                  {r.brokenConditions > 0 && (
                    <Badge tone="warning" title={t('list.brokenHint')}>
                      {t('list.brokenConditions', { count: r.brokenConditions })}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {summaryOf(r)}
                </p>
                {r.isFallback && (
                  <p className="text-xs text-muted-foreground">{t('list.fallbackHint')}</p>
                )}
              </div>

              <div className="min-w-0 text-sm" dir="auto">
                <span className="text-xs text-muted-foreground md:sr-only">
                  {t('list.col.assignTo')}:{' '}
                </span>
                {who.length === 0 ? (
                  t('list.nobody')
                ) : (
                  <>
                    {shown.join(', ')}
                    {who.length > shown.length ? ` +${who.length - shown.length}` : ''}
                  </>
                )}
              </div>

              <div className="text-sm">
                <span className="text-xs text-muted-foreground md:sr-only">
                  {t('list.col.method')}:{' '}
                </span>
                {t(`strategy.${r.strategy}`)}
                {r.skipOffline && (
                  <span className="block text-xs text-muted-foreground">
                    {t('list.skipsOffline')}
                  </span>
                )}
                {r.reassignOnUpdate && (
                  <span className="block text-xs text-muted-foreground">{t('list.reassigns')}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={r.isActive}
                  disabled={!canManage || busy}
                  onCheckedChange={() => onToggle(r)}
                  label={t('list.activeFor', { name: r.name })}
                />
                <span className="text-xs text-muted-foreground md:sr-only">
                  {t('list.col.active')}
                </span>
              </div>

              <div className="text-xs text-muted-foreground">
                <p>{t('list.usedCount', { count: r.firedCount })}</p>
                {r.lastFiredAt && <p>{t('list.lastUsed', { when: when(r.lastFiredAt) })}</p>}
                <p>
                  {t('list.modifiedBy', {
                    name: r.lastModifiedBy?.name ?? t('list.unknownPerson'),
                    when: when(r.updatedAt),
                  })}
                </p>
              </div>

              <div className="flex items-center justify-end gap-1">
                {canManage && (
                  <>
                    <button
                      type="button"
                      className={arrowBtn}
                      disabled={busy || !canUp}
                      aria-label={t('list.moveUp', { name: r.name })}
                      onClick={() => {
                        const ids = reorderIds(rules, r.id, { step: -1 });
                        if (ids) onReorder(ids, r.id);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={arrowBtn}
                      disabled={busy || !canDown}
                      aria-label={t('list.moveDown', { name: r.name })}
                      onClick={() => {
                        const ids = reorderIds(rules, r.id, { step: 1 });
                        if (ids) onReorder(ids, r.id);
                      }}
                    >
                      ↓
                    </button>
                    <Menu
                      label={t('list.actions', { name: r.name })}
                      align="end"
                      placement="fixed"
                      disabled={busy}
                      triggerClassName="size-8 px-0"
                      triggerProps={{ 'aria-label': t('list.actions', { name: r.name }) }}
                      trigger={<span aria-hidden="true">⋯</span>}
                    >
                      <MenuItem onSelect={() => onEdit(r)}>{t('list.edit')}</MenuItem>
                      <MenuItem onSelect={() => onClone(r)}>{t('list.clone')}</MenuItem>
                      <MenuItem danger onSelect={() => onDelete(r)}>
                        {t('list.delete')}
                      </MenuItem>
                    </Menu>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
