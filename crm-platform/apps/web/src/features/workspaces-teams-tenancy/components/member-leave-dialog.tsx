'use client';

import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  useToast,
} from '@crm/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import {
  MEMBER_LEAVE_REASON_MAX,
  OWNER_REASSIGN_UNDO_DAYS,
  type MemberLeave,
  type OwnerReassignBatch,
} from '@crm/contracts';
import { useAllMembers, useRefreshWorkspace, useTeams } from '../api/hooks';
import { LEAVE_KEYS, leaveApi, useBatches, useLeaveOverview } from '../api/leave';
import { formatDay, returnDay, validateLeave, type LeaveDraft } from '../lib/leave';
import { ErrorNote } from './parts';
import { useQueryClient } from '@tanstack/react-query';

const blank = (today: string): LeaveDraft => ({
  startsOn: today,
  endsOn: '',
  openEnded: false,
  reason: '',
});

/**
 * "Leave and delegate" for one member (BL-112): the leave now and coming, a form to add one, the delegate, and for people who may
 * manage this member the "Reassign contacts and deals" action with its history and undo. Dates are the workspace's calendar days; the
 * server (not this form) is the authority on every rule. Mounted only while open, so each opening starts fresh.
 */
export function MemberLeaveDialog({
  memberId,
  memberName,
  open,
  onClose,
  focusReassign = false,
}: {
  memberId: string | null;
  memberName: string;
  open: boolean;
  onClose: () => void;
  /** Opened from the "went on leave" notice: scroll to the reassign part. */
  focusReassign?: boolean;
}) {
  const t = useTranslations('workspaces-teams-tenancy.leave');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={t('eyebrow')}
      title={memberName}
      closeLabel={tc('close')}
    >
      {open && memberId && (
        <LeaveBody memberId={memberId} focusReassign={focusReassign} onClose={onClose} />
      )}
    </Modal>
  );
}

function LeaveBody({
  memberId,
  focusReassign,
  onClose,
}: {
  memberId: string;
  focusReassign: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.leave');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const locale = useLocale();
  const { toast } = useToast();
  const qc = useQueryClient();
  const refreshWorkspace = useRefreshWorkspace();
  const q = useLeaveOverview(memberId);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState<MemberLeave | null>(null);

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: LEAVE_KEYS.overview(memberId) });
    await qc.invalidateQueries({ queryKey: LEAVE_KEYS.list });
    await qc.invalidateQueries({ queryKey: LEAVE_KEYS.batches(memberId) });
    await refreshWorkspace();
  };
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast(done);
      await reload();
    } catch (e) {
      setError(e);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) {
    return (
      <div className="flex justify-center p-8" role="status" aria-label={tc('loading')}>
        <Spinner />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-3">
        <ErrorNote error={q.error} />
        <Button variant="secondary" onClick={() => void q.refetch()}>
          {tc('retry')}
        </Button>
      </div>
    );
  }
  const o = q.data;
  const day = (d: string) => formatDay(d, locale, true);
  const range = (l: MemberLeave) =>
    l.endsOn
      ? t('range', { from: day(l.startsOn), to: day(l.endsOn) })
      : t('rangeOpen', { from: day(l.startsOn) });

  return (
    <div className="space-y-5" data-testid="leave-dialog">
      <p className="text-xs text-muted-foreground">{t('calendarNote', { timezone: o.timezone })}</p>

      <section aria-labelledby="leave-now" className="space-y-2">
        <h3 id="leave-now" className="text-sm font-semibold">
          {t('nowTitle')}
        </h3>
        {o.current ? (
          <LeaveRow
            leave={o.current}
            range={range(o.current)}
            onEnd={() => setConfirmEnd(o.current)}
            canEdit={o.can.manage}
            busy={busy}
            endLabel={t('endNow')}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('notAway')}</p>
        )}
        {o.upcoming.length > 0 && (
          <>
            <h3 className="pt-1 text-sm font-semibold">{t('upcomingTitle')}</h3>
            <ul className="space-y-2">
              {o.upcoming.map((l) => (
                <li key={l.id}>
                  <LeaveRow
                    leave={l}
                    range={range(l)}
                    onEnd={() => setConfirmEnd(l)}
                    canEdit={o.can.manage}
                    busy={busy}
                    endLabel={t('cancelLeave')}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {o.can.manage ? (
        <AddLeave
          today={o.today}
          busy={busy}
          onAdd={(input) => void run(() => leaveApi.create(memberId, input), t('added'))}
        />
      ) : (
        <Alert tone="info">{t('readOnly')}</Alert>
      )}

      <DelegateSection
        memberId={memberId}
        current={o.delegate}
        canManage={o.can.manage}
        busy={busy}
        onSet={(id) =>
          void run(
            () => leaveApi.setDelegate(memberId, id),
            id ? t('delegateSaved') : t('delegateRemoved'),
          )
        }
      />

      {o.can.manage && o.workload && (
        <ReassignSection
          memberId={memberId}
          memberName={o.memberName}
          workload={o.workload}
          currentLeave={o.current ?? o.upcoming[0] ?? null}
          hasDelegate={Boolean(o.delegate)}
          autoFocus={focusReassign}
          onDone={() => void reload()}
        />
      )}

      {error !== null && <ErrorNote error={error} />}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          {tc('close')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmEnd !== null}
        title={confirmEnd?.status === 'active' ? t('endTitle') : t('cancelTitle')}
        message={confirmEnd?.status === 'active' ? t('endMessage') : t('cancelMessage')}
        confirmLabel={confirmEnd?.status === 'active' ? t('endNow') : t('cancelLeave')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const l = confirmEnd;
          setConfirmEnd(null);
          if (l) void run(() => leaveApi.end(l.id), t('ended'));
        }}
        onClose={() => setConfirmEnd(null)}
      />
    </div>
  );
}

function LeaveRow({
  leave,
  range,
  onEnd,
  canEdit,
  busy,
  endLabel,
}: {
  leave: MemberLeave;
  range: string;
  onEnd: () => void;
  canEdit: boolean;
  busy: boolean;
  endLabel: string;
}) {
  const t = useTranslations('workspaces-teams-tenancy.leave');
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
      data-testid={`leave-${leave.id}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{range}</div>
        {leave.reason && (
          <div className="text-xs text-muted-foreground">
            {t('reasonShown', { reason: leave.reason })}
          </div>
        )}
      </div>
      {canEdit && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={onEnd}>
          {endLabel}
        </Button>
      )}
    </div>
  );
}

function AddLeave({
  today,
  busy,
  onAdd,
}: {
  today: string;
  busy: boolean;
  onAdd: (input: { startsOn: string; endsOn: string | null; reason: string | null }) => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.leave');
  const ids = useId();
  const [draft, setDraft] = useState<LeaveDraft>(blank(today));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<LeaveDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setProblem(null);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validateLeave(draft, today);
    if (!r.ok) {
      setProblem(r.problem);
      return;
    }
    onAdd(r.input);
    setDraft(blank(today));
  };
  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-3 rounded-md border border-border p-3"
      data-testid="leave-form"
    >
      <h3 className="text-sm font-semibold">{t('addTitle')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('firstDay')}
          htmlFor={`${ids}-from`}
          error={
            problem === 'startRequired'
              ? t('problems.startRequired')
              : problem === 'startPast'
                ? t('problems.startPast')
                : undefined
          }
        >
          <Input
            id={`${ids}-from`}
            type="date"
            min={today}
            value={draft.startsOn}
            onChange={(e) => set({ startsOn: e.target.value })}
            required
          />
        </Field>
        <Field
          label={t('lastDay')}
          htmlFor={`${ids}-to`}
          error={
            problem === 'endRequired'
              ? t('problems.endRequired')
              : problem === 'endBeforeStart'
                ? t('problems.endBeforeStart')
                : undefined
          }
        >
          <Input
            id={`${ids}-to`}
            type="date"
            min={draft.startsOn || today}
            value={draft.endsOn}
            disabled={draft.openEnded}
            onChange={(e) => set({ endsOn: e.target.value })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.openEnded}
          onChange={(e) => set({ openEnded: e.target.checked })}
        />
        {t('openEnded')}
      </label>
      <Field label={t('reason')} htmlFor={`${ids}-reason`} hint={t('reasonHint')}>
        <Input
          id={`${ids}-reason`}
          value={draft.reason}
          maxLength={MEMBER_LEAVE_REASON_MAX}
          onChange={(e) => set({ reason: e.target.value })}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {t('addSubmit')}
        </Button>
      </div>
    </form>
  );
}

function DelegateSection({
  memberId,
  current,
  canManage,
  busy,
  onSet,
}: {
  memberId: string;
  current: { id: string; name: string; onLeaveNow: boolean } | null;
  canManage: boolean;
  busy: boolean;
  onSet: (id: string | null) => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.leave');
  const ids = useId();
  const members = useAllMembers(canManage);
  const options = (members.data?.pages.flatMap((p) => p.data) ?? []).filter(
    (m) => m.id !== memberId && m.status === 'active',
  );
  return (
    <section aria-labelledby={`${ids}-d`} className="space-y-2">
      <h3 id={`${ids}-d`} className="text-sm font-semibold">
        {t('delegateTitle')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('delegateHelp')}</p>
      {canManage ? (
        <Select
          aria-label={t('delegateTitle')}
          value={current?.id ?? ''}
          disabled={busy || members.isPending}
          onChange={(e) => onSet(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">{t('noDelegate')}</option>
          {current && !options.some((o) => o.id === current.id) && (
            <option value={current.id}>{current.name}</option>
          )}
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-sm">{current ? current.name : t('noDelegate')}</p>
      )}
      {current?.onLeaveNow && (
        <Alert tone="warning">{t('delegateAway', { name: current.name })}</Alert>
      )}
    </section>
  );
}

type TargetKind = 'user' | 'delegate' | 'team';

function ReassignSection({
  memberId,
  memberName,
  workload,
  currentLeave,
  hasDelegate,
  autoFocus,
  onDone,
}: {
  memberId: string;
  memberName: string;
  workload: { ownedContacts: number; openConversations: number };
  currentLeave: MemberLeave | null;
  hasDelegate: boolean;
  autoFocus: boolean;
  onDone: () => void;
}) {
  const tr = useTranslations('workspaces-teams-tenancy.reassign');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const locale = useLocale();
  const { toast } = useToast();
  const ids = useId();
  const members = useAllMembers(true);
  const teams = useTeams();
  const batches = useBatches(memberId, true);
  const [kind, setKind] = useState<TargetKind>(hasDelegate ? 'delegate' : 'user');
  const [userId, setUserId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [includeDeals, setIncludeDeals] = useState(true);
  const [planReturn, setPlanReturn] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ contacts: number; openDeals: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const [undo, setUndo] = useState<OwnerReassignBatch | null>(null);

  const back = returnDay(currentLeave);
  const people = (members.data?.pages.flatMap((p) => p.data) ?? []).filter(
    (m) => m.id !== memberId && m.status === 'active',
  );
  // Work goes to teams that take records (Teams v2): one switched off for records is not offered.
  const teamList = (teams.data?.pages.flatMap((p) => p.data) ?? []).filter(
    (team) => team.receivesRecords,
  );
  const ready =
    kind === 'delegate' || (kind === 'user' && userId !== '') || (kind === 'team' && teamId !== '');

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await leaveApi.previewReassign(memberId));
      setConfirm(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const doReassign = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    try {
      const res = await leaveApi.reassign({
        fromUserId: memberId,
        target: kind === 'user' ? { kind, userId } : kind === 'team' ? { kind, teamId } : { kind },
        includeDeals,
        restoreOn: planReturn && back ? back : null,
        reason: reason.trim() === '' ? null : reason.trim(),
      });
      toast(tr('done', { contacts: res.movedContacts, deals: res.movedDeals }));
      onDone();
      await batches.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const doUndo = async () => {
    const b = undo;
    setUndo(null);
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      const res = await leaveApi.restore(b.id);
      toast(
        tr('restored', {
          count: res.restoredContacts + res.restoredDeals,
          skipped: res.notRestored,
        }),
      );
      onDone();
      await batches.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={`${ids}-r`}
      className="space-y-3 rounded-md border border-border p-3"
      data-testid="reassign-section"
      ref={(el) => {
        if (el && autoFocus) el.scrollIntoView?.({ block: 'center' });
      }}
    >
      <h3 id={`${ids}-r`} className="text-sm font-semibold">
        {tr('title')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {tr('holds', {
          name: memberName,
          contacts: workload.ownedContacts,
          chats: workload.openConversations,
        })}
      </p>
      <Field label={tr('target')} htmlFor={`${ids}-kind`}>
        <Select
          id={`${ids}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as TargetKind)}
        >
          <option value="user">{tr('kindUser')}</option>
          <option value="delegate" disabled={!hasDelegate}>
            {tr('kindDelegate')}
          </option>
          <option value="team">{tr('kindTeam')}</option>
        </Select>
      </Field>
      {kind === 'user' && (
        <Field label={tr('person')} htmlFor={`${ids}-user`}>
          <Select id={`${ids}-user`} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{tr('choose')}</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {kind === 'team' && (
        <Field label={tr('team')} htmlFor={`${ids}-team`} hint={tr('teamHint')}>
          <Select id={`${ids}-team`} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">{tr('choose')}</option>
            {teamList.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeDeals}
          onChange={(e) => setIncludeDeals(e.target.checked)}
        />
        {tr('includeDeals')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={planReturn}
          disabled={!back}
          onChange={(e) => setPlanReturn(e.target.checked)}
        />
        {back ? tr('returnOn', { date: formatDay(back, locale, true) }) : tr('returnUnavailable')}
      </label>
      <p className="text-xs text-muted-foreground">
        {tr('returnHelp', { days: OWNER_REASSIGN_UNDO_DAYS })}
      </p>
      <Field label={tr('reason')} htmlFor={`${ids}-why`}>
        <Input
          id={`${ids}-why`}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {error !== null && <ErrorNote error={error} />}
      <div className="flex justify-end">
        <Button disabled={busy || !ready} onClick={() => void doPreview()}>
          {busy && <Spinner />}
          {tr('submit')}
        </Button>
      </div>

      <h4 className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tr('history')}
      </h4>
      {batches.isPending ? (
        <Spinner />
      ) : (batches.data?.data.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('historyEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {batches.data!.data.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
              data-testid={`batch-${b.id}`}
            >
              <span>
                {tr(`status.${b.status}`)}:{' '}
                {tr('summary', {
                  contacts: b.movedContacts,
                  deals: b.movedDeals,
                  target: b.target.userName ?? b.target.teamName ?? tr('kindDelegate'),
                })}
                {b.restoreOn && b.status === 'applied'
                  ? ` · ${tr('returnsOn', { date: formatDay(b.restoreOn, locale, true) })}`
                  : ''}
                {b.status === 'restored'
                  ? ` · ${tr('restoredSummary', { restored: b.restoredContacts + b.restoredDeals, skipped: b.notRestored })}`
                  : ''}
                {b.remaining > 0 ? ` · ${tr('remaining', { count: b.remaining })}` : ''}
              </span>
              {b.canRestore && (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setUndo(b)}>
                  {tr('undo')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirm}
        title={tr('confirmTitle')}
        message={tr('confirmMessage', {
          contacts: preview?.contacts ?? 0,
          deals: includeDeals ? (preview?.openDeals ?? 0) : 0,
          name: memberName,
        })}
        confirmLabel={tr('confirm')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={() => void doReassign()}
        onClose={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={undo !== null}
        title={tr('undoTitle')}
        message={tr('undoMessage')}
        confirmLabel={tr('undo')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={() => void doUndo()}
        onClose={() => setUndo(null)}
      />
    </section>
  );
}
