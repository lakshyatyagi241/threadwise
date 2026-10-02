'use client';

import { Button, ConfirmDialog, Field, Input, Modal, Select, Spinner, cn, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { WSP_ASSIGNMENT_STRATEGIES, WSP_TEAM_NAME_MAX, type WspTeam } from '@crm/contracts';
import { useAllMembers, useRefreshWorkspace } from '../api/hooks';
import { wspApi } from '../api/service';
import { errorKind } from '../lib/errors';
import {
  emptyTeamForm,
  formFromTeam,
  nameProblem,
  sameColor,
  swatchesFor,
  toCreateInput,
  toUpdateInput,
  toggle,
  type TeamForm,
} from '../lib/team-form';
import { PRESENCE_DOT } from '../lib/roles';
import { Avatar, useErrorText } from './parts';

/** A device (channel line) a team can be limited to. */
export interface TeamDevice {
  id: string;
  label: string;
  phone: string;
}

/** The device picker only exists when the workspace has more than one device (WaDesk); one device means "all of them". */
export const showsDevicePicker = (devices: readonly TeamDevice[]): boolean => devices.length > 1;

/**
 * Create team / Edit team (WD-WSP-022): name, colour swatch, assignment strategy, member checkboxes with presence and,
 * for workspaces with several devices, the device limit (empty = every device). Editing adds Delete with a confirm.
 */
export function TeamDialog({
  open,
  team,
  devices,
  canDelete,
  onClose,
}: {
  open: boolean;
  /** The team being edited; null creates one. */
  team: WspTeam | null;
  devices: readonly TeamDevice[];
  canDelete: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.teamDialog');
  const tt = useTranslations('workspaces-teams-tenancy.teams');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const { toast } = useToast();
  const errorText = useErrorText();
  const refresh = useRefreshWorkspace();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!team) return;
    setDeleting(true);
    try {
      await wspApi.deleteTeam(team.id);
      toast(tt('deleted'));
      setConfirmDelete(false);
      onClose();
      await refresh();
    } catch (err) {
      toast(tt('deleteFailed', { reason: errorText(err) }), 'danger');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        eyebrow={t('eyebrow')}
        title={t(team ? 'editTitle' : 'createTitle')}
        closeLabel={tc('close')}
      >
        {/* Mounted only while open, so every opening starts from the team (or a blank form). */}
        {open && (
          <TeamForm
            team={team}
            devices={devices}
            onClose={onClose}
            onDelete={canDelete && team ? () => setConfirmDelete(true) : undefined}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={open && confirmDelete}
        title={tt('deleteTitle')}
        message={tt('deleteMessage', { name: team?.name ?? '' })}
        confirmLabel={tt('deleteConfirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

function TeamForm({
  team,
  devices,
  onClose,
  onDelete,
}: {
  team: WspTeam | null;
  devices: readonly TeamDevice[];
  onClose: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.teamDialog');
  const tt = useTranslations('workspaces-teams-tenancy.teams');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const tp = useTranslations('workspaces-teams-tenancy.members.presence');
  const { toast } = useToast();
  const errorText = useErrorText();
  const refresh = useRefreshWorkspace();
  const ids = useId();
  const members = useAllMembers(true);

  const [form, setForm] = useState<TeamForm>(team ? formFromTeam(team) : emptyTeamForm());
  const [nameError, setNameError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const devicesShown = showsDevicePicker(devices);

  const patch = (p: Partial<TeamForm>) => setForm((f) => ({ ...f, ...p }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = nameProblem(form.name);
    if (problem) {
      setNameError(
        problem === 'required' ? t('nameRequired') : t('nameTooLong', { max: WSP_TEAM_NAME_MAX }),
      );
      document.getElementById(`${ids}-name`)?.focus();
      return;
    }
    setBusy(true);
    try {
      if (team) await wspApi.updateTeam(team.id, toUpdateInput(form, team, devicesShown));
      else await wspApi.createTeam(toCreateInput(form));
      toast(tt(team ? 'updated' : 'created'));
      onClose();
      await refresh();
    } catch (err) {
      if (errorKind(err) === 'teamNameTaken') setNameError(errorText(err));
      toast(tt(team ? 'updateFailed' : 'createFailed', { reason: errorText(err) }), 'danger');
      // A stale team: refetch so the list behind the dialog shows the newest one.
      if (errorKind(err) === 'conflict') await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <Field label={t('name')} htmlFor={`${ids}-name`} error={nameError}>
        <Input
          id={`${ids}-name`}
          name="name"
          value={form.name}
          onChange={(e) => {
            patch({ name: e.target.value });
            setNameError(undefined);
          }}
          placeholder={t('namePlaceholder')}
          maxLength={WSP_TEAM_NAME_MAX}
          autoComplete="off"
          autoFocus
          required
          invalid={Boolean(nameError)}
        />
      </Field>

      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1.5 font-medium">{t('color')}</legend>
        <div className="flex flex-wrap items-center gap-2" data-testid="team-colors">
          {swatchesFor(form.color).map((c) => {
            const selected = sameColor(c, form.color);
            return (
              <button
                key={c}
                type="button"
                aria-label={t('colorOption', { color: c })}
                aria-pressed={selected}
                onClick={() => patch({ color: c })}
                style={{ background: c }}
                className={cn(
                  'size-7 rounded-full',
                  selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
              />
            );
          })}
        </div>
      </fieldset>

      <Field label={t('strategy')} htmlFor={`${ids}-strategy`}>
        <Select
          id={`${ids}-strategy`}
          value={form.assignmentStrategy}
          onChange={(e) =>
            patch({ assignmentStrategy: e.target.value as TeamForm['assignmentStrategy'] })
          }
        >
          {WSP_ASSIGNMENT_STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {t(`strategyOptions.${s}`)}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1.5 font-medium">{t('members')}</legend>
        <div
          className="max-h-[180px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2"
          data-testid="team-members"
        >
          {members.isError ? (
            <p className="py-4 text-center text-xs text-danger">{t('membersFailed')}</p>
          ) : members.isPending || members.hasNextPage ? (
            <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Spinner /> {t('membersLoading')}
            </p>
          ) : members.items.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t(team ? 'membersNoneEdit' : 'membersNoneCreate')}
            </p>
          ) : (
            members.items.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  name="memberIds"
                  value={m.id}
                  checked={form.memberIds.includes(m.id)}
                  onChange={() => patch({ memberIds: toggle(form.memberIds, m.id) })}
                  className="size-4 shrink-0 rounded border-border accent-[var(--primary)]"
                />
                <Avatar name={m.fullName} className="size-6 text-[9px]" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{m.fullName}</span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', PRESENCE_DOT[m.presence])}
                  />
                  {tp(m.presence)}
                </span>
              </label>
            ))
          )}
        </div>
      </fieldset>

      {devicesShown && (
        <fieldset className="space-y-1.5 text-sm">
          <legend className="mb-1.5 font-medium">
            {t('devices')}{' '}
            <span className="font-normal text-muted-foreground">{t('devicesHint')}</span>
          </legend>
          <div
            className="max-h-[140px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2"
            data-testid="team-devices"
          >
            {devices.map((d) => (
              <label
                key={d.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  name="deviceIds"
                  value={d.id}
                  checked={form.deviceIds.includes(d.id)}
                  onChange={() => patch({ deviceIds: toggle(form.deviceIds, d.id) })}
                  className="size-4 shrink-0 rounded border-border accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{d.label}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{d.phone}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <Button
            variant="secondary"
            className="border-danger/40 text-danger hover:bg-danger/10"
            onClick={onDelete}
            disabled={busy}
            data-testid="delete-team"
          >
            {tt('delete')}
          </Button>
        )}
        <Button variant="secondary" className="ms-auto" onClick={onClose} disabled={busy}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={busy} data-testid="save-team">
          {busy && <Spinner />}
          {busy ? t(team ? 'saving' : 'creating') : t(team ? 'save' : 'create')}
        </Button>
      </div>
    </form>
  );
}
