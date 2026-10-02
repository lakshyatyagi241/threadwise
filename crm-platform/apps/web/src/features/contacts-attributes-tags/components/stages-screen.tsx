'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { StatusOptionResponse } from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Spinner, Tabs, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useStatusOptions } from '../api/attributes';
import {
  createStatusOption,
  invalidateStatusOptions,
  reorderStatusOptions,
  updateStatusOption,
  useStatusUsage,
} from '../api/stages';
import { errorKind } from '../lib/errors';
import {
  groupOptions,
  moveItem,
  optionColor,
  sameOrder,
  STAGE_GROUP,
  STATUS_GROUP,
  stageSeeds,
  statusSeeds,
  type OptionGroup,
} from '../lib/stage-model';
import { ContactAvatar, StageBadge } from './chips';
import { ErrorLine } from './error-line';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  GripIcon,
  PencilIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
} from './icons';
import { StageDeleteDialog } from './stage-delete-dialog';
import { StageModal } from './stage-modal';

/** `/contact-stages`: the lifecycle stages and statuses a contact can have, in the order they are offered. */
export function StagesScreen() {
  const t = useTranslations('contacts-attributes-tags.stages');
  const [tab, setTab] = useState<OptionGroup>(STAGE_GROUP);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('eyebrow')}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Link
          href="/contact-properties"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {t('toProperties')} <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
        </Link>
      </div>

      <Tabs
        value={tab}
        onValueChange={(id) => setTab(id as OptionGroup)}
        items={[
          {
            id: STAGE_GROUP,
            label: t('tabs.stage'),
            content: <GroupManager group={STAGE_GROUP} />,
          },
          {
            id: STATUS_GROUP,
            label: t('tabs.status'),
            content: <GroupManager group={STATUS_GROUP} />,
          },
        ]}
      />
    </div>
  );
}

function GroupManager({ group }: { group: OptionGroup }) {
  const t = useTranslations('contacts-attributes-tags.stages');
  const tf = useTranslations('contacts-attributes-tags.form');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('record.contact-properties.create');
  const canUpdate = useCan('record.contact-properties.update');
  const canDelete = useCan('record.contact-properties.delete');
  const isStage = group === STAGE_GROUP;
  const kind = isStage ? 'stage' : 'status';

  const all = useStatusOptions();
  const saved = useMemo(() => groupOptions(all.data, group), [all.data, group]);
  const usage = useStatusUsage(group, saved.length > 0);

  /** Ids in the order just chosen, until the server's list catches up. */
  const [order, setOrder] = useState<string[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<StatusOptionResponse | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StatusOptionResponse | null>(null);
  const [seeding, setSeeding] = useState(false);

  const byId = new Map(saved.map((o) => [o.id, o]));
  const rows = order
    ? [
        ...order.map((id) => byId.get(id)).filter((o): o is StatusOptionResponse => Boolean(o)),
        ...saved.filter((o) => !order.includes(o.id)),
      ]
    : saved;
  const ids = rows.map((o) => o.id);

  async function fail(e: unknown) {
    const k = errorKind(e);
    toast(t(k === 'conflict' ? 'toast.conflict' : k === 'forbidden' ? 'toast.forbidden' : 'toast.failed'), 'danger');
    await invalidateStatusOptions(qc);
  }

  async function reorder(next: string[]) {
    if (sameOrder(next, ids)) return;
    setOrder(next);
    try {
      await reorderStatusOptions(group, next);
      await invalidateStatusOptions(qc);
    } catch (e) {
      await fail(e);
    } finally {
      setOrder(null);
    }
  }

  async function patch(
    o: StatusOptionResponse,
    change: { isDefault?: boolean; isActive?: boolean },
    done: string,
  ) {
    setBusyId(o.id);
    try {
      await updateStatusOption(o, change);
      await invalidateStatusOptions(qc);
      toast(done, 'success');
    } catch (e) {
      await fail(e);
    } finally {
      setBusyId(null);
    }
  }

  async function seed() {
    setSeeding(true);
    try {
      const seeds = isStage ? stageSeeds() : statusSeeds((v) => tf(`statuses.${v}`));
      for (const s of seeds) await createStatusOption(group, s);
      toast(t('seed.done'), 'success');
    } catch (e) {
      await fail(e);
    } finally {
      await invalidateStatusOptions(qc);
      setSeeding(false);
    }
  }

  const configured = saved.length > 0;
  // Until the workspace has its own list, the preview shows the platform options the pickers fall back to.
  const activeRows = configured
    ? rows.filter((o) => o.isActive)
    : (isStage ? stageSeeds() : statusSeeds((v) => tf(`statuses.${v}`))).map((s) => ({
        id: s.value,
        value: s.value,
        label: s.label,
        color: s.color,
      }));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0 space-y-4" aria-label={t(`${kind}.listLabel`)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">{t(`${kind}.help`)}</p>
          {canCreate && configured && (
            <Button className="shrink-0" onClick={() => setEditing('new')}>
              <PlusIcon /> {t(`${kind}.add`)}
            </Button>
          )}
        </div>

        {all.isPending ? (
          <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : all.isError ? (
          <ErrorLine error={all.error} onRetry={() => void all.refetch()} />
        ) : !configured ? (
          <EmptyState
            title={t(`${kind}.unconfiguredTitle`)}
            message={t(`${kind}.unconfigured`)}
            actions={
              <>
                {canCreate && (
                  <Button onClick={() => void seed()} disabled={seeding}>
                    {seeding && <Spinner />}
                    {t(`${kind}.seed`)}
                  </Button>
                )}
                {canCreate && (
                  <Button variant="secondary" onClick={() => setEditing('new')} disabled={seeding}>
                    <PlusIcon /> {t(`${kind}.startFresh`)}
                  </Button>
                )}
              </>
            }
          />
        ) : (
          <div className="rounded-md border border-border bg-background">
            <ul aria-label={t(`${kind}.listLabel`)} className="divide-y divide-border">
              {rows.map((o, i) => {
                const count = usage.data?.get(o.id);
                const busy = busyId === o.id;
                return (
                  <li
                    key={o.id}
                    draggable={canUpdate && !busy}
                    onDragStart={(e) => {
                      setDragging(o.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', o.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragging || dragging === o.id) return;
                      e.preventDefault();
                      setOver(o.id);
                    }}
                    onDragLeave={() => setOver((cur) => (cur === o.id ? null : cur))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = ids.indexOf(dragging ?? '');
                      setDragging(null);
                      setOver(null);
                      if (from >= 0) void reorder(moveItem(ids, from, i));
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cn(
                      'flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5',
                      dragging === o.id && 'opacity-40',
                      over === o.id && 'bg-primary/5 shadow-[inset_0_2px_0_0_var(--primary)]',
                      !o.isActive && 'bg-muted/40',
                    )}
                  >
                    {canUpdate && (
                      <span
                        aria-hidden="true"
                        title={t('row.drag')}
                        className="cursor-grab text-muted-foreground active:cursor-grabbing"
                      >
                        <GripIcon />
                      </span>
                    )}
                    <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 max-w-full" dir="auto">
                        <StageBadge stage={o.value} label={o.label} color={o.color} />
                      </span>
                      <code dir="ltr" className="font-mono text-xs text-muted-foreground">
                        {o.value}
                      </code>
                      {o.isDefault && isStage && <Badge tone="success">{t('row.default')}</Badge>}
                      {!o.isActive && <Badge>{t('row.hidden')}</Badge>}
                    </div>
                    <span className="w-28 shrink-0 text-xs text-muted-foreground">
                      {count === undefined ? '—' : t('row.contacts', { count })}
                    </span>
                    <div className="flex shrink-0 items-center">
                      {canUpdate && (
                        <>
                          <IconButton
                            label={t('row.moveUp', { name: o.label })}
                            disabled={i === 0}
                            onClick={() => void reorder(moveItem(ids, i, i - 1))}
                          >
                            <ArrowUpIcon className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={t('row.moveDown', { name: o.label })}
                            disabled={i === rows.length - 1}
                            onClick={() => void reorder(moveItem(ids, i, i + 1))}
                          >
                            <ArrowDownIcon className="size-3.5" />
                          </IconButton>
                          {isStage && (
                            <IconButton
                              label={t('row.makeDefault', { name: o.label })}
                              disabled={o.isDefault || !o.isActive || busy}
                              onClick={() => void patch(o, { isDefault: true }, t('toast.defaultSet', { name: o.label }))}
                            >
                              <StarIcon
                                className={cn('size-3.5', o.isDefault && 'fill-current text-warning')}
                              />
                            </IconButton>
                          )}
                          <IconButton
                            label={t('row.edit', { name: o.label })}
                            onClick={() => setEditing(o)}
                          >
                            <PencilIcon className="size-3.5" />
                          </IconButton>
                        </>
                      )}
                      {canDelete && (
                        <IconButton
                          label={t('row.delete', { name: o.label })}
                          danger
                          onClick={() => setDeleting(o)}
                        >
                          <TrashIcon className="size-3.5" />
                        </IconButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {canCreate && (
              <button
                type="button"
                onClick={() => setEditing('new')}
                className="flex w-full items-center justify-center gap-2 border-t border-dashed border-border px-4 py-3 text-sm font-medium text-primary hover:bg-muted/50"
              >
                <PlusIcon /> {t(`${kind}.add`)}
              </button>
            )}
          </div>
        )}

        {usage.isError && configured && (
          <Alert tone="warning">{t('usageFailed')}</Alert>
        )}
        {!canUpdate && configured && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
      </section>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="rounded-md border border-border bg-background p-4">
          <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('preview.title')}
          </div>
          {activeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('preview.empty')}</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-medium">{t('preview.picker')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {activeRows.map((o) => (
                    <StageBadge key={o.id} stage={o.value} label={o.label} color={o.color} />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium">{t('preview.table')}</div>
                <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                  <ContactAvatar id="preview" name={t('preview.sample')} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {t('preview.sample')}
                  </span>
                  <StageBadge
                    stage={activeRows[0]!.value}
                    label={activeRows[0]!.label}
                    color={optionColor(activeRows[0]!)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-xs leading-relaxed">
          <div className="mb-1 font-semibold">{t(`${kind}.how.title`)}</div>
          {t(`${kind}.how.body`)}
        </div>
      </aside>

      <StageModal
        open={editing !== null}
        group={group}
        option={editing === 'new' || editing === null ? undefined : editing}
        siblings={saved}
        onClose={() => setEditing(null)}
      />
      <StageDeleteDialog
        group={group}
        option={deleting}
        options={saved}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent',
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
