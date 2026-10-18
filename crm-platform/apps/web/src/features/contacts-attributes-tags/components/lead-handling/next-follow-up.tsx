'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { FollowUpResult, NextFollowUp } from '@crm/contracts';
import { Badge, Button, Menu, MenuItem, Modal, Spinner, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { invalidateContacts, KEYS } from '../../api/contacts';
import {
  clearFollowUp,
  completeFollowUp,
  setFollowUp,
  snoozeFollowUp,
} from '../../api/lead-handling';
import { formatDateTime } from '../../lib/format';
import { isoToZonedLocal, zonedLocalToIso } from '../../lib/meeting-time';
import { CheckIcon } from '../icons';

/** Overdue: dated and before now. A "someday" follow-up has no date and is never overdue. */
export function isOverdue(f: NextFollowUp, now = Date.now()): boolean {
  return f.dueAt !== null && new Date(f.dueAt).getTime() < now;
}

/** Runs one follow-up call, then refreshes the contact everywhere it is shown. */
function useFollowUpActions(contactId: string) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.followUp');
  const { toast } = useToast();
  const qc = useQueryClient();
  const after = async (message: string) => {
    await Promise.all([invalidateContacts(qc), qc.invalidateQueries({ queryKey: KEYS.contact(contactId) })]);
    toast(message, 'success');
  };
  const failed = () => toast(t('failed'), 'danger');
  const set = useMutation({
    mutationFn: (dueAt: string | null) => setFollowUp(contactId, dueAt),
    onSuccess: (r: FollowUpResult) =>
      after(r.nextFollowUp?.dueAt ? t('savedFor') : t('savedSomeday')),
    onError: failed,
  });
  const snooze = useMutation({
    mutationFn: (preset: 'day' | 'three_days' | 'week') => snoozeFollowUp(contactId, preset),
    onSuccess: () => after(t('snoozed')),
    onError: failed,
  });
  const done = useMutation({
    mutationFn: () => completeFollowUp(contactId),
    onSuccess: () => after(t('doneMessage')),
    onError: failed,
  });
  const clear = useMutation({
    mutationFn: () => clearFollowUp(contactId),
    onSuccess: () => after(t('clearedMessage')),
    onError: failed,
  });
  return { set, snooze, done, clear, busy: set.isPending || snooze.isPending || done.isPending || clear.isPending };
}

/** The date-and-time editor of a follow-up: a wall clock in the workspace's zone, or "someday" (no date). */
export function FollowUpDialog({
  contactId,
  current,
  open,
  onClose,
}: {
  contactId: string;
  current: NextFollowUp | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.followUp');
  const { org } = useSession();
  const zone = org.timezone ?? undefined;
  const actions = useFollowUpActions(contactId);
  const [someday, setSomeday] = useState(current !== null && current.dueAt === null);
  const [local, setLocal] = useState(isoToZonedLocal(current?.dueAt ?? null, zone));
  const iso = someday ? null : zonedLocalToIso(local, zone);
  const valid = someday || iso !== null;
  return (
    <Modal open={open} onClose={onClose} title={t('dialogTitle')}>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={someday}
            onChange={(e) => setSomeday(e.target.checked)}
            className="accent-[var(--primary)]"
          />
          {t('someday')}
        </label>
        {!someday && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('dateTime')}</span>
            <input
              type="datetime-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            disabled={!valid || actions.busy}
            onClick={() =>
              actions.set.mutate(iso, { onSuccess: () => onClose() })
            }
          >
            {actions.busy && <Spinner />}
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The contact's next follow-up in the record header and the quick view (BL-291): when it is due (overdue in red, "Someday" for none),
 * with Done, Snooze (1 day, 3 days, next week) and Change date. Drawn only for a contact that has one: setting the first one is the
 * More menu's "Set follow-up", so a workspace that does not use follow-ups sees nothing new.
 */
export function NextFollowUpRow({ contactId, followUp }: { contactId: string; followUp: NextFollowUp | null }) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.followUp');
  const locale = useLocale();
  const { org } = useSession();
  const canUpdate = useCan('record.contacts.update');
  const actions = useFollowUpActions(contactId);
  const [editing, setEditing] = useState(false);
  if (!followUp) return null;
  const overdue = isOverdue(followUp);
  const when = followUp.dueAt ? formatDateTime(followUp.dueAt, locale, org.timezone ?? undefined) : t('somedayLabel');
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t('title')}</span>
      <span className={overdue ? 'font-medium text-danger' : 'font-medium'}>{when}</span>
      {overdue && <Badge tone="danger">{t('overdue')}</Badge>}
      {canUpdate && (
        <span className="ms-auto flex items-center gap-1">
          <Button size="sm" variant="secondary" disabled={actions.busy} onClick={() => actions.done.mutate()}>
            <CheckIcon className="size-3.5" /> {t('done')}
          </Button>
          <Menu label={t('snooze')} trigger={<span>{t('snooze')}</span>}>
            <MenuItem onSelect={() => actions.snooze.mutate('day')}>{t('snoozeDay')}</MenuItem>
            <MenuItem onSelect={() => actions.snooze.mutate('three_days')}>{t('snoozeThreeDays')}</MenuItem>
            <MenuItem onSelect={() => actions.snooze.mutate('week')}>{t('snoozeWeek')}</MenuItem>
          </Menu>
          <Button size="sm" variant="secondary" disabled={actions.busy} onClick={() => setEditing(true)}>
            {t('change')}
          </Button>
        </span>
      )}
      {editing && (
        <FollowUpDialog contactId={contactId} current={followUp} open onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/** The "Next follow-up" column of the contacts list: the date (overdue in red), "Someday", or a dash. */
export function FollowUpCell({
  followUp,
  locale,
  timeZone,
}: {
  followUp: { id: string; dueAt: string | null } | null;
  locale: string;
  timeZone: string | undefined;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.followUp');
  if (!followUp) return <span className="text-muted-foreground">-</span>;
  if (followUp.dueAt === null) return <span className="text-muted-foreground">{t('somedayLabel')}</span>;
  const overdue = new Date(followUp.dueAt).getTime() < Date.now();
  const text = formatDateTime(followUp.dueAt, locale, timeZone);
  return (
    <span className={overdue ? 'font-medium text-danger' : undefined} title={overdue ? t('overdue') : undefined}>
      {text}
    </span>
  );
}
