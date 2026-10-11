'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_DELETE_AFTER_DAYS,
  type OrgLifecycleResponse,
} from '@crm/contracts';
import { Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  lifecycleKeys,
  restoreWorkspace,
  setLegalHold,
  setRetentionExempt,
  updateRetentionPolicy,
} from '../api';
import {
  MAX_REASON,
  MIN_ARCHIVE_DAYS,
  MIN_DELETE_DAYS,
  MIN_GAP_DAYS,
  checkExempt,
  checkPolicy,
  legalHoldBody,
  policyDraftFor,
  reasonBody,
  reasonError,
  type PolicyDraft,
  type TimingDraft,
} from '../lib/retention';
import { HubErrorLine } from './error-line';

export type RetentionAction = 'policy' | 'exempt' | 'restore' | 'legalHold';
export interface RetentionTarget {
  action: RetentionAction;
  row: OrgLifecycleResponse;
}

/** Shared frame of every retention write: title, body, reason, the server's error inline, Cancel and a confirm button. */
function Shell({
  title,
  message,
  confirmLabel,
  danger,
  canSubmit,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  canSubmit: boolean;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const tc = useTranslations('workspaces-hub.common');
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            data-testid="retention-confirm"
            disabled={pending || !canSubmit}
            onClick={onConfirm}
          >
            {pending && <Spinner />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{message}</p>
        {children}
        {error != null && <HubErrorLine error={error} />}
      </div>
    </Modal>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const id = useId();
  const err = value === '' ? null : reasonError(value);
  return (
    <Field
      label={t('reason')}
      htmlFor={id}
      hint={t('reasonHint')}
      error={err ? t(`errors.${err}`) : undefined}
    >
      <Textarea
        id={id}
        rows={3}
        maxLength={MAX_REASON}
        value={value}
        invalid={err !== null}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Runs one write, then refreshes the retention list and closes. */
function useWrite<T>(
  fn: (v: T) => Promise<unknown>,
  doneKey: string,
  name: string,
  onClose: () => void,
) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      toast.success(t(doneKey, { name }));
      await qc.invalidateQueries({ queryKey: lifecycleKeys.all });
      onClose();
    },
  });
}

function TimingField({
  label,
  hint,
  value,
  error,
  onChange,
}: {
  label: string;
  hint: string;
  value: TimingDraft;
  error?: string;
  onChange: (v: TimingDraft) => void;
}) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const modeId = useId();
  const daysId = useId();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-start gap-2">
        <Select
          id={modeId}
          aria-label={`${label}: ${t('mode')}`}
          className="w-auto"
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as TimingDraft['mode'] })}
        >
          <option value="default">{t('useDefault')}</option>
          <option value="custom">{t('custom')}</option>
        </Select>
        {value.mode === 'custom' && (
          <Input
            id={daysId}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="w-32"
            aria-label={`${label}: ${t('days')}`}
            aria-invalid={error ? true : undefined}
            value={value.days}
            onChange={(e) => onChange({ ...value, days: e.target.value })}
          />
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </fieldset>
  );
}

/** Per-workspace timings: archive and erase days, each with "use the platform default". */
export function PolicyDialog({ row, onClose }: { row: OrgLifecycleResponse; onClose: () => void }) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const [draft, setDraft] = useState<PolicyDraft>(() => policyDraftFor(row));
  const check = checkPolicy(row, draft);
  const run = useWrite(
    () => updateRetentionPolicy(row.id, check.body!),
    'policyDone',
    row.name,
    onClose,
  );
  const has = (e: string) => check.errors.includes(e as never);
  const archiveErr = (['archiveWhole', 'archiveMin', 'archiveMax'] as const).find(has);
  const eraseErr = (['eraseWhole', 'eraseMin', 'eraseMax'] as const).find(has);
  return (
    <Shell
      title={t('policyTitle', { name: row.name })}
      message={t('policyMessage')}
      confirmLabel={t('policyConfirm')}
      canSubmit={check.body !== null}
      pending={run.isPending}
      error={run.error}
      onConfirm={() => run.mutate(undefined)}
      onClose={onClose}
    >
      <TimingField
        label={t('archiveAfter')}
        hint={t('archiveHint', { default: DEFAULT_ARCHIVE_AFTER_DAYS, min: MIN_ARCHIVE_DAYS })}
        value={draft.archive}
        error={archiveErr ? t(`errors.${archiveErr}`) : undefined}
        onChange={(archive) => setDraft({ ...draft, archive })}
      />
      <TimingField
        label={t('eraseAfter')}
        hint={t('eraseHint', { default: DEFAULT_DELETE_AFTER_DAYS, min: MIN_DELETE_DAYS })}
        value={draft.erase}
        error={eraseErr ? t(`errors.${eraseErr}`) : undefined}
        onChange={(erase) => setDraft({ ...draft, erase })}
      />
      {has('gap') && (
        <p role="alert" className="text-xs text-danger">
          {t('errors.gap', { days: MIN_GAP_DAYS })}
        </p>
      )}
      {has('noChange') && <p className="text-xs text-muted-foreground">{t('errors.noChange')}</p>}
      <ReasonField value={draft.reason} onChange={(reason) => setDraft({ ...draft, reason })} />
    </Shell>
  );
}

/** Never delete: turn it on (reason, optional expiry) or clear it (reason). */
export function ExemptDialog({ row, onClose }: { row: OrgLifecycleResponse; onClose: () => void }) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const on = !row.retentionExempt;
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const untilId = useId();
  const check = checkExempt(on, reason, until);
  const run = useWrite(
    () => setRetentionExempt(row.id, check.body!),
    on ? 'exemptOnDone' : 'exemptOffDone',
    row.name,
    onClose,
  );
  return (
    <Shell
      title={t(on ? 'exemptOnTitle' : 'exemptOffTitle', { name: row.name })}
      message={t(on ? 'exemptOnMessage' : 'exemptOffMessage')}
      confirmLabel={t(on ? 'exemptOnConfirm' : 'exemptOffConfirm')}
      canSubmit={check.body !== null}
      pending={run.isPending}
      error={run.error}
      onConfirm={() => run.mutate(undefined)}
      onClose={onClose}
    >
      {on && (
        <Field
          label={t('until')}
          htmlFor={untilId}
          hint={t('untilHint')}
          error={check.until ? t('errors.untilPast') : undefined}
        >
          <Input
            id={untilId}
            type="date"
            value={until}
            invalid={check.until !== null}
            onChange={(e) => setUntil(e.target.value)}
          />
        </Field>
      )}
      <ReasonField value={reason} onChange={setReason} />
    </Shell>
  );
}

/** Restore an archived workspace: signs its people back in and restarts the inactivity clock. */
export function RestoreDialog({
  row,
  onClose,
}: {
  row: OrgLifecycleResponse;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const [reason, setReason] = useState('');
  const body = reasonBody(reason);
  const run = useWrite(
    () => restoreWorkspace(row.id, body.success ? body.data : { reason }),
    'restoreDone',
    row.name,
    onClose,
  );
  return (
    <Shell
      title={t('restoreTitle', { name: row.name })}
      message={t('restoreMessage')}
      confirmLabel={t('restoreConfirm')}
      canSubmit={body.success}
      pending={run.isPending}
      error={run.error}
      onConfirm={() => run.mutate(undefined)}
      onClose={onClose}
    >
      <ReasonField value={reason} onChange={setReason} />
    </Shell>
  );
}

/** Legal hold: blocks archive and erase until an operator with the legal-hold key lifts it. */
export function LegalHoldDialog({
  row,
  onClose,
}: {
  row: OrgLifecycleResponse;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-hub.retention.dialog');
  const on = !row.legalHold;
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const body = legalHoldBody(on, reason);
  const run = useWrite(
    () => setLegalHold(row.id, body.success ? body.data : { legalHold: on, reason }),
    on ? 'holdOnDone' : 'holdOffDone',
    row.name,
    onClose,
  );
  return (
    <Shell
      title={t(on ? 'holdOnTitle' : 'holdOffTitle', { name: row.name })}
      message={t(on ? 'holdOnMessage' : 'holdOffMessage')}
      confirmLabel={t(on ? 'holdOnConfirm' : 'holdOffConfirm')}
      danger={!on}
      canSubmit={body.success && sure}
      pending={run.isPending}
      error={run.error}
      onConfirm={() => run.mutate(undefined)}
      onClose={onClose}
    >
      <ReasonField value={reason} onChange={setReason} />
      <Checkbox
        label={t(on ? 'holdOnSure' : 'holdOffSure')}
        checked={sure}
        onChange={(e) => setSure(e.target.checked)}
      />
    </Shell>
  );
}

/** Mounts the dialog the target names; remounting per target resets the form. */
export function RetentionDialogs({
  target,
  onClose,
}: {
  target: RetentionTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  const key = `${target.action}:${target.row.id}`;
  const props = { row: target.row, onClose };
  switch (target.action) {
    case 'policy':
      return <PolicyDialog key={key} {...props} />;
    case 'exempt':
      return <ExemptDialog key={key} {...props} />;
    case 'restore':
      return <RestoreDialog key={key} {...props} />;
    case 'legalHold':
      return <LegalHoldDialog key={key} {...props} />;
  }
}
