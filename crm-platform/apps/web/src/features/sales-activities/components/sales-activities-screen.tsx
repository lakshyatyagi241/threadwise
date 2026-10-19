'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { activityCapabilities, type ActivityType } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useActivityTypes } from '../api/activity-types';
import { useActivityLabels } from '../lib/labels';
import { ActivityDrawer } from './activity-drawer';
import { ActivityIcon } from './activity-icon';
import { CreateActivityDialog } from './create-activity-dialog';

/** A line that says what the activity's switches are now, so the list shows the setup without opening each one. */
function useSummary() {
  const t = useTranslations('sales-activities.list');
  return (a: ActivityType): string[] => {
    const cap = activityCapabilities(a.behavesAs);
    const out: string[] = [];
    if (cap.allowComplete) out.push(a.allowComplete ? t('chip.completable') : t('chip.notCompletable'));
    if (cap.showInCalendar && a.showInCalendar) out.push(t('chip.calendar'));
    if (cap.taskTypes) out.push(t('chip.taskTypes', { count: a.taskTypes.length }));
    if (cap.outcomes && a.outcomesEnabled) out.push(t('chip.outcomes', { count: a.outcomes.length }));
    return out;
  };
}

/**
 * `/sales-activities` (Settings > Data > Sales Activities): the activities the team logs (Task, Meeting, Phone, Email, Reminder, SMS,
 * Chat and any the business adds), each with an "Edit activity" drawer for its switches, task types and outcomes. Reading needs
 * `crm.activity_types.read`, changing `crm.activity_types.manage`. The same lists feed the pickers on tasks, meetings and logged calls.
 */
export function SalesActivitiesScreen() {
  const t = useTranslations('sales-activities.list');
  const labels = useActivityLabels();
  const summary = useSummary();
  const canManage = useCan('crm.activity_types.manage');
  const q = useActivityTypes();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const editing = q.data?.find((a) => a.id === editingId);

  return (
    <section className="mx-auto max-w-4xl space-y-6" data-testid="sales-activities">
      <header className="space-y-2">
        <Link href="/settings/data" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-semibold">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('intro')}</p>
          </div>
          {canManage && (
            <Button variant="brand" onClick={() => setCreating(true)}>
              {t('create')}
            </Button>
          )}
        </div>
      </header>

      {q.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      )}
      {q.isError && (
        <Alert tone="danger">
          <p>{t('loadFailed')}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      )}

      {q.isSuccess && (
        <ul aria-label={t('listLabel')} className="divide-y divide-border rounded-lg border border-border">
          {q.data.map((a) => {
            const hasEditor = a.behavesAs !== 'other';
            const name = labels.activity(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <ActivityIcon name={a.icon} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span dir="auto" className="break-words">
                      {name}
                    </span>
                    <Badge>{a.isDefault ? t('default') : t('custom')}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {hasEditor ? summary(a).join(' · ') : t('noEditor')}
                  </p>
                </div>
                {hasEditor && (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('editNamed', { name })}
                    onClick={() => setEditingId(a.id)}
                  >
                    {t('edit')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ActivityDrawer
          activity={editing}
          canManage={canManage}
          onClose={() => setEditingId(null)}
          onRemoved={() => setEditingId(null)}
        />
      )}
      {creating && (
        <CreateActivityDialog
          onClose={() => setCreating(false)}
          onCreated={(a) => {
            setCreating(false);
            setEditingId(a.id);
          }}
        />
      )}
    </section>
  );
}
