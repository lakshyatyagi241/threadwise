'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { contactActivityResponseSchema } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, EmptyState, Spinner, StatTile, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { AGENT_IGNORE } from '@/lib/agent-marks';
import { LinkedAppointments } from '@/features/appointments';
import { ContactAttributionCard } from '@/features/lead-sources';
import { CompanyLink } from '@/features/companies';
import { ChatInsightCard, ScoreCard } from '@/features/lead-scoring';
import { LinkedSalesDocs } from '@/features/sales-docs';
import { LinkedInvoices } from '@/features/invoicing';
import { LinkedTasks } from '@/features/tasks';
import { useCursorList } from '@/lib/api/use-cursor-list';
import {
  deleteContact,
  invalidateContacts,
  KEYS,
  updateContact,
  useContact,
} from '../api/contacts';
import { useStatusOptions } from '../api/attributes';
import { useContactFields, useFieldSections } from '../api/properties';
import { useContactTags } from '../api/tags';
import {
  displayName,
  EXTRA_KEYS,
  formatPhone,
  isOptedOut,
  RESERVED_CUSTOM_KEYS,
  titleCaseKey,
} from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import { detailGroups } from '../lib/property-model';
import { stageChoices, statusChoices } from '../lib/option-sets';
import { ContactAvatar, GroupChip, TagPill } from './chips';
import { StageMenu } from './stage-menu';
import { ContactFormModal } from './contact-form-modal';
import { ErrorLine } from './error-line';
import { LostReasonDialog, type LostPrompt } from './lost-reason';
import { isLostStage } from '../lib/stage-flow';
import { statusAfterMove, statusNotice } from '../lib/status-scope';
import { ChevronLeftIcon, PencilIcon, TrashIcon } from './icons';

/**
 * `/contacts/[id]` (TW-CON-018): the profile Reference could not render (its back link pointed at a route that did
 * not exist, so every contact answered 500). Header, KPIs, the activity timeline and every field of the contact.
 */
export function ContactDetail({ id }: { id: string }) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const canDelete = useCan('record.contacts.delete');
  const contact = useContact(id);
  const tags = useContactTags(id);
  const registry = useContactFields();
  const sections = useFieldSections();
  const statusOptions = useStatusOptions();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ts = useTranslations('contacts-attributes-tags.stageMenu');
  const tForm = useTranslations('contacts-attributes-tags.form');
  /** A status value as the workspace names it (its configured label, else the platform's). */
  const statusLabelOf = (v: string) =>
    statusChoices(statusOptions.data, (x) => tForm(`statuses.${x}`)).find((c) => c.value === v)
      ?.label ?? titleCaseKey(v);

  const [lostPrompt, setLostPrompt] = useState<LostPrompt | null>(null);

  const changeStage = useMutation({
    mutationFn: (v: {
      stage: string;
      rowVersion: number;
      /** The status the contact holds now, to tell what the stage move did to it. */
      statusBefore: string | null;
      reason?: { lostReason?: string | null; otherLostReason?: string | null };
    }) => updateContact(id, { lifecycleStage: v.stage, ...v.reason, rowVersion: v.rowVersion }),
    onSuccess: async (saved, v) => {
      setLostPrompt(null);
      await Promise.all([
        invalidateContacts(qc),
        qc.invalidateQueries({ queryKey: KEYS.contact(id) }),
      ]);
      const stageName =
        stageChoices(statusOptions.data).find((s) => s.value === saved.lifecycleStage)?.label ??
        saved.lifecycleStage ??
        '';
      // The API keeps the status valid for the stage: say what happened to it, from its answer.
      const notice = statusNotice(v.statusBefore, saved.status);
      toast(
        notice.kind === 'none'
          ? ts('changed', { stage: stageName })
          : notice.kind === 'cleared'
            ? ts('changedStatusCleared', { stage: stageName })
            : ts(notice.kind === 'reset' ? 'changedStatusReset' : 'changedStatusSet', {
                stage: stageName,
                status: statusLabelOf(notice.status),
              }),
        'success',
      );
    },
    onError: async (e) => {
      const kind = errorKind(e);
      toast(
        ts(kind === 'conflict' ? 'conflict' : kind === 'forbidden' ? 'forbidden' : 'failed'),
        'danger',
      );
      if (kind === 'conflict') await qc.invalidateQueries({ queryKey: KEYS.contact(id) });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: async () => {
      await invalidateContacts(qc);
      toast(t('deleted'), 'success');
      router.replace('/contacts');
    },
    onError: () => {
      setDeleting(false);
      toast(t('deleteFailed'), 'danger');
    },
  });

  const back = (
    <Link
      href="/contacts"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeftIcon className="size-3.5 rtl:rotate-180" /> {t('back')}
    </Link>
  );

  if (contact.isPending) {
    return (
      <section>
        {back}
        <div role="status" className="flex items-center gap-2 py-10 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      </section>
    );
  }
  if (contact.isError) {
    return (
      <section>
        {back}
        {errorKind(contact.error) === 'unavailable' ? (
          <EmptyState title={t('notFoundTitle')} message={t('notFound')} />
        ) : (
          <ErrorLine error={contact.error} onRetry={() => void contact.refetch()} />
        )}
      </section>
    );
  }

  const c = contact.data;
  const name = displayName(c) || t('unnamed');
  const phone = formatPhone(c.phone);
  const cf = c.customFields;
  const text = (key: string): string => (typeof cf[key] === 'string' ? cf[key] : '');
  const customGroups = detailGroups(
    registry.data ?? [],
    sections.data ?? [],
    cf,
    RESERVED_CUSTOM_KEYS,
    { yes: t('yes'), no: t('no') },
    titleCaseKey,
  );
  const memberGroups = c.groups ?? [];

  return (
    <section>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <ContactAvatar id={c.id} name={name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight" dir="auto">
              {name}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {phone && (
                <span dir="ltr" className="font-mono">
                  {phone}
                </span>
              )}
              {c.email && <span dir="ltr">{c.email}</span>}
              {c.companyId && <CompanyLink id={c.companyId} />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.lifecycleStage && (
                <StageMenu
                  value={c.lifecycleStage}
                  choices={stageChoices(statusOptions.data, c.lifecycleStage)}
                  name={name}
                  busy={changeStage.isPending}
                  statusHint={(stage) => {
                    const move = statusAfterMove(statusOptions.data, c.status, stage);
                    if (!move.changed) return null;
                    return move.status === null
                      ? ts('willClear')
                      : ts('willReset', { status: statusLabelOf(move.status) });
                  }}
                  onChange={
                    canUpdate
                      ? (stage) => {
                          const choices = stageChoices(
                            statusOptions.data,
                            c.lifecycleStage ?? undefined,
                          );
                          // A lost stage asks why first; nothing is saved until the dialog gives a reason.
                          if (isLostStage(choices, stage)) {
                            setLostPrompt({
                              contactId: c.id,
                              contactName: name,
                              stageValue: stage,
                              stageLabel: choices.find((x) => x.value === stage)?.label ?? stage,
                            });
                          } else
                            changeStage.mutate({
                              stage,
                              rowVersion: c.rowVersion,
                              statusBefore: c.status,
                            });
                        }
                      : undefined
                  }
                />
              )}
              {c.status && <Badge tone="success">{statusLabelOf(c.status)}</Badge>}
              {isOptedOut(c) && <Badge tone="warning">{t('optedOut')}</Badge>}
              {(tags.data ?? []).map((tag) => (
                <TagPill key={tag.id} name={tag.name} color={tag.color} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canUpdate && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <PencilIcon /> {t('edit')}
            </Button>
          )}
          {canDelete && (
            <Button
              variant="secondary"
              className="border-danger text-danger hover:bg-danger/10"
              onClick={() => setDeleting(true)}
            >
              <TrashIcon /> {t('delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <ScoreCard
          contactId={id}
          contact={c}
          className="col-span-2"
          onScored={() =>
            Promise.all([
              invalidateContacts(qc),
              qc.invalidateQueries({ queryKey: KEYS.contact(id) }),
            ])
          }
        />
        {/* Only present in a workspace that has the chat reading on; every other workspace sees the page as before. */}
        <ChatInsightCard
          contactId={id}
          className="col-span-2"
          onChanged={() =>
            Promise.all([
              invalidateContacts(qc),
              qc.invalidateQueries({ queryKey: KEYS.contact(id) }),
            ])
          }
        />
        <StatTile label={t('lastActivity')} value={<DateText value={c.lastActivityAt} />} />
        <StatTile label={t('created')} value={<DateText value={c.createdAt} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <LinkedTasks kind="contact" id={id} label={name} />
          <LinkedInvoices kind="contact" id={id} />
          <LinkedSalesDocs kind="contact" id={id} />
          <LinkedAppointments contactId={id} />
          <ContactAttributionCard contactId={id} />
          <Timeline id={id} />
        </div>
        <aside className="h-max space-y-4 rounded-md border border-border bg-background p-4">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('details')}
          </h2>
          <dl className="space-y-3 text-sm">
            <Detail label={t('language')}>{text(EXTRA_KEYS.language)}</Detail>
            <Detail label={t('source')}>{c.source ?? text(EXTRA_KEYS.source)}</Detail>
            <Detail label={t('address')}>{text(EXTRA_KEYS.address)}</Detail>
            <Detail label={t('memo')}>{text(EXTRA_KEYS.memo)}</Detail>
            <Detail label={t('groups')}>
              {memberGroups.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {memberGroups.map((g) => (
                    <GroupChip key={g.id} name={g.name} color={g.color} />
                  ))}
                </span>
              )}
            </Detail>
            <Detail label={t('consent')}>{isOptedOut(c) ? t('optedOutFull') : t('optedIn')}</Detail>
          </dl>
          {customGroups.map((g) => (
            <div key={g.title ?? 'other'} className="space-y-3 border-t border-border pt-3">
              {g.title && (
                <h3
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  dir="auto"
                >
                  {g.title}
                </h3>
              )}
              <dl className="space-y-3 text-sm">
                {g.rows.map((r) => (
                  <Detail key={r.key} label={r.label}>
                    {r.value}
                  </Detail>
                ))}
              </dl>
            </div>
          ))}
        </aside>
      </div>

      <ContactFormModal open={editing} contact={c} onClose={() => setEditing(false)} />
      <LostReasonDialog
        prompt={lostPrompt}
        busy={changeStage.isPending}
        onConfirm={(p, reason) =>
          changeStage.mutate({
            stage: p.stageValue,
            rowVersion: c.rowVersion,
            reason,
            statusBefore: c.status,
          })
        }
        onClose={() => setLostPrompt(null)}
      />
      <ConfirmDialog
        open={deleting}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name })}
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === '' || children === false || children == null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words" dir="auto">
        {empty ? <span className="text-muted-foreground">&mdash;</span> : children}
      </dd>
    </div>
  );
}

function DateText({ value }: { value: string | null }) {
  const format = useFormatter();
  if (!value) return <>&mdash;</>;
  return (
    <span className="text-xl">{format.dateTime(new Date(value), { dateStyle: 'medium' })}</span>
  );
}

function Timeline({ id }: { id: string }) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const format = useFormatter();
  const list = useCursorList(
    ['cat', 'activities', id],
    `/contacts/${id}/activities`,
    contactActivityResponseSchema,
  );
  return (
    <section
      className="rounded-md border border-border bg-background p-4 sm:p-5"
      aria-labelledby={`tl-${id}`}
    >
      <h2
        id={`tl-${id}`}
        className="mb-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('timeline')}
      </h2>
      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-6 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('noActivity')}</p>
      ) : (
        <ol
          {...AGENT_IGNORE}
          className="relative space-y-5 ps-6 before:absolute before:inset-y-1 before:start-[9px] before:w-px before:bg-border"
        >
          {list.items.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -start-6 top-1 size-[18px] rounded-full border border-border bg-background" />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold" dir="auto">
                  {a.title}
                </span>
                <time
                  dateTime={a.occurredAt}
                  className="shrink-0 font-mono text-[11px] text-muted-foreground"
                >
                  {format.dateTime(new Date(a.occurredAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </div>
              {a.body && (
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground" dir="auto">
                  {a.body}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {t('loadMore')}
        </Button>
      )}
    </section>
  );
}
