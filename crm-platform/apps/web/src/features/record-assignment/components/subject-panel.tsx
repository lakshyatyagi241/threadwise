'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, Tabs, useToast } from '@crm/ui';
import type { AssignmentRule, AssignmentSubject } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { summarize, useSummaryContext, usePeople, useTeams } from '@/features/segments';
import { RA_KEYS, assignmentApi, useAssignmentRules } from '../api/assignment';
import { sortRules } from '../lib/reorder';
import { groupFromRules } from '../lib/tree';
import { CatalogGate, type CatalogState } from './catalog-gate';
import type { PoolOption } from './pool-picker';
import { RuleEditor } from './rule-editor';
import { RuleList } from './rule-list';
import { RunLog } from './run-log';
import { TestBox } from './test-box';
import { useRa } from './use-ra';

type Editing = { mode: 'new' } | { mode: 'edit'; id: string };

function PanelBody({
  subject,
  canManage,
  catalog,
}: {
  subject: AssignmentSubject;
  canManage: boolean;
  catalog: CatalogState;
}) {
  const { t } = useRa();
  const qc = useQueryClient();
  const { toast } = useToast();
  const rulesQ = useAssignmentRules();
  const people = usePeople();
  const teams = useTeams();
  const summaryCtx = useSummaryContext(catalog.catalog);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toDelete, setToDelete] = useState<AssignmentRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');

  const rules = useMemo(
    () => sortRules((rulesQ.data?.data ?? []).filter((r) => r.subject === subject)),
    [rulesQ.data, subject],
  );
  const peopleOptions = useMemo<PoolOption[]>(
    () => (people.data ?? []).map((p) => ({ value: p.id, label: p.fullName })),
    [people.data],
  );
  const teamOptions = useMemo<PoolOption[]>(
    () =>
      (teams.data ?? [])
        .filter((x) => x.receivesRecords !== false)
        .map((x) => ({ value: x.id, label: x.name })),
    [teams.data],
  );
  const nameOfPerson = (id: string) =>
    peopleOptions.find((p) => p.value === id)?.label ?? t('list.unknownPerson');
  const nameOfTeam = (id: string) =>
    teamOptions.find((x) => x.value === id)?.label ?? t('list.unknownTeam');
  const summaryOf = (r: AssignmentRule) =>
    r.isFallback || !r.rules
      ? t('list.noConditions')
      : summarize(groupFromRules(r.rules), summaryCtx);

  const reload = () => qc.invalidateQueries({ queryKey: RA_KEYS.rules });
  const work = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await job();
      if (done) toast(done);
    } catch (e) {
      toast(
        e instanceof ApiError && e.isRowVersionConflict ? t('toast.conflict') : t('toast.failed'),
        'danger',
      );
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const editingRule =
    editing?.mode === 'edit' ? (rules.find((r) => r.id === editing.id) ?? null) : null;

  const rulesView = (
    <div className="space-y-4">
      {!canManage && <Alert tone="info">{t('list.readOnly')}</Alert>}
      {editing && (editing.mode === 'new' || editingRule) ? (
        <RuleEditor
          key={editingRule ? `${editingRule.id}:${editingRule.rowVersion}` : 'new'}
          subject={subject}
          rule={editingRule}
          catalog={catalog}
          people={peopleOptions}
          teams={teamOptions}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            toast(t(m === 'created' ? 'toast.created' : 'toast.saved'));
            void reload();
          }}
          onConflict={() => {
            toast(t('toast.conflict'), 'danger');
            void reload();
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t(`list.title.${subject}`)}</h3>
            {canManage && rules.length > 0 && (
              <Button onClick={() => setEditing({ mode: 'new' })} data-testid="ra-create">
                {t('list.create')}
              </Button>
            )}
          </div>
          {rulesQ.isPending ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('list.loading')}
            </p>
          ) : rulesQ.isError ? (
            <Alert tone="danger">
              <p>{t('list.loadFailed')}</p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void rulesQ.refetch()}
              >
                {t('list.retry')}
              </Button>
            </Alert>
          ) : rules.length === 0 ? (
            <EmptyState
              title={t('list.empty.title')}
              message={t(`list.empty.${subject}`)}
              actions={
                canManage ? (
                  <Button onClick={() => setEditing({ mode: 'new' })} data-testid="ra-create">
                    {t('list.empty.create')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <RuleList
              rules={rules}
              canManage={canManage}
              busy={busy}
              summaryOf={summaryOf}
              nameOfPerson={nameOfPerson}
              nameOfTeam={nameOfTeam}
              onToggle={(r) =>
                void work(
                  () => assignmentApi.setActive(r.id, !r.isActive),
                  t(r.isActive ? 'toast.paused' : 'toast.activated'),
                )
              }
              onReorder={(ids, movedId) =>
                void work(async () => {
                  await assignmentApi.reorder({ subject, ids });
                  const moved = rules.find((r) => r.id === movedId);
                  setAnnounce(
                    t('list.moved', { name: moved?.name ?? '', place: ids.indexOf(movedId) + 1 }),
                  );
                }, t('toast.reordered'))
              }
              onEdit={(r) => setEditing({ mode: 'edit', id: r.id })}
              onClone={(r) => void work(() => assignmentApi.clone(r.id), t('toast.cloned'))}
              onDelete={setToDelete}
            />
          )}
          <p role="status" aria-live="polite" className="sr-only">
            {announce}
          </p>
          <TestBox subject={subject} />
        </>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title={t('delete.title')}
        message={t('delete.message', { name: toDelete?.name ?? '' })}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const r = toDelete;
          setToDelete(null);
          if (r) void work(() => assignmentApi.remove(r.id), t('toast.deleted'));
        }}
        onClose={() => setToDelete(null)}
      />
    </div>
  );

  return (
    <Tabs
      items={[
        { id: 'rules', label: t('views.rules'), content: rulesView },
        { id: 'log', label: t('views.log'), content: <RunLog subject={subject} rules={rules} /> },
      ]}
    />
  );
}

/** One module's rules, test box and run log. Loads that module's fields only when its tab is open. */
export function SubjectPanel({
  subject,
  canManage,
}: {
  subject: AssignmentSubject;
  canManage: boolean;
}) {
  return (
    <CatalogGate subject={subject}>
      {(catalog) => <PanelBody subject={subject} canManage={canManage} catalog={catalog} />}
    </CatalogGate>
  );
}
