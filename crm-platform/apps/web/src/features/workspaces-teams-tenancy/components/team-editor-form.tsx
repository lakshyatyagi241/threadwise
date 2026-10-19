'use client';

import { Button, Field, Input, Select, Spinner, Switch, Textarea, cn, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { WSP_TEAM_MAX_DEPTH, WSP_TEAM_NAME_MAX, type WspMember, type WspTeam } from '@crm/contracts';
import { useAllMembers, useAllTeams, useRefreshWorkspace } from '../api/hooks';
import { wspApi } from '../api/service';
import { errorKind } from '../lib/errors';
import { PRESENCE_DOT } from '../lib/roles';
import {
  emptyTeamForm,
  formFromTeam,
  memberChanges,
  nameProblem,
  sameColor,
  swatchesFor,
  toCreateInput,
  toUpdateInput,
  withLead,
  withMemberRole,
  withMemberToggled,
  type TeamForm,
} from '../lib/team-form';
import { parentChoices } from '../lib/team-tree';
import { Avatar, useErrorText } from './parts';

/** A device (channel line) a team can be limited to. */
export interface TeamDevice {
  id: string;
  label: string;
  phone: string;
}

/** The device picker only exists when the workspace has more than one device (Reference); one device means "all of them". */
export const showsDevicePicker = (devices: readonly TeamDevice[]): boolean => devices.length > 1;

/**
 * The create / edit form of a team (Teams v2): name, colour, description, manager, parent, the two "can receive" switches, and the
 * members with a lead flag and a primary-team mark. Settings the team stores but nothing reads yet are listed at the bottom, read-only.
 * `onDelete` puts the Delete button in the footer; the confirmation lives with the dialog.
 */
export function TeamEditorForm({
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
  const teams = useAllTeams(true);

  const [form, setForm] = useState<TeamForm>(team ? formFromTeam(team) : emptyTeamForm());
  const [nameError, setNameError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const devicesShown = showsDevicePicker(devices);
  const patch = (p: Partial<TeamForm>) => setForm((f) => ({ ...f, ...p }));

  const people = useMemo(() => members.items.filter((m) => m.status !== 'inactive'), [members.items]);
  const parents = useMemo(
    () => parentChoices(teams.items, team, WSP_TEAM_MAX_DEPTH),
    [teams.items, team],
  );
  const savedById = useMemo(() => new Map((team?.members ?? []).map((m) => [m.id, m])), [team]);

  /** Primary as it will be after saving: the choice made here, else what the server has, else automatic for a one-team person. */
  function primaryOf(m: WspMember): { on: boolean; locked: boolean } {
    const others = m.teamIds.filter((id) => id !== team?.id);
    if (others.length === 0) return { on: true, locked: true };
    const choice = form.primaryChoice[m.id];
    return { on: choice ?? savedById.get(m.id)?.isPrimary ?? false, locked: false };
  }

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
      const saved = team
        ? await wspApi.updateTeam(team.id, toUpdateInput(form, team, devicesShown))
        : await wspApi.createTeam(toCreateInput(form));
      // Roles and primary marks are per person: one call each, only for what differs from the saved team.
      for (const change of memberChanges(form, saved)) {
        await wspApi.updateTeamMember(saved.id, change.userId, {
          ...(change.role !== undefined ? { role: change.role } : {}),
          ...(change.isPrimary !== undefined ? { isPrimary: change.isPrimary } : {}),
        });
      }
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

  const notUsed = unusedLines(team, tt);

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground" data-testid="team-hint">
        {t('hint')}
      </p>

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

      <Field label={t('description')} htmlFor={`${ids}-description`}>
        <Textarea
          id={`${ids}-description`}
          rows={2}
          maxLength={255}
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder={t('descriptionPlaceholder')}
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('lead')} htmlFor={`${ids}-lead`} hint={t('leadHint')}>
          <Select
            id={`${ids}-lead`}
            data-testid="team-lead"
            value={form.leadId ?? ''}
            onChange={(e) => setForm((f) => withLead(f, e.target.value || null))}
          >
            <option value="">{t('leadNone')}</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('parent')} htmlFor={`${ids}-parent`} hint={t('parentHint')}>
          <Select
            id={`${ids}-parent`}
            data-testid="team-parent"
            value={form.parentId ?? ''}
            onChange={(e) => patch({ parentId: e.target.value || null })}
          >
            <option value="">{t('parentNone')}</option>
            {parents.map((p) => (
              <option
                key={p.team.id}
                value={p.team.id}
                disabled={!p.allowed && p.team.id !== form.parentId}
              >
                {`${'— '.repeat(p.level)}${p.team.name}`}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="space-y-2 text-sm" data-testid="team-receive">
        <legend className="mb-1 font-medium">{t('receive')}</legend>
        <p className="text-xs text-muted-foreground">{t('receiveHint')}</p>
        <div className="flex items-center gap-3">
          <Switch
            checked={form.receivesConversations}
            onCheckedChange={(v) => patch({ receivesConversations: v })}
            label={t('receiveConversations')}
          />
          <span>{t('receiveConversations')}</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={form.receivesRecords}
            onCheckedChange={(v) => patch({ receivesRecords: v })}
            label={t('receiveRecords')}
          />
          <span>{t('receiveRecords')}</span>
        </div>
      </fieldset>

      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 font-medium">{t('members')}</legend>
        <p className="text-xs text-muted-foreground">{t('membersHint')}</p>
        <div
          className="max-h-[220px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2"
          data-testid="team-members"
        >
          {members.isError ? (
            <p className="py-4 text-center text-xs text-danger">{t('membersFailed')}</p>
          ) : members.isPending || members.hasNextPage ? (
            <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Spinner /> {t('membersLoading')}
            </p>
          ) : people.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t(team ? 'membersNoneEdit' : 'membersNoneCreate')}
            </p>
          ) : (
            people.map((m) => {
              const checked = form.memberIds.includes(m.id);
              const isManager = form.leadId === m.id;
              const lead = isManager || form.memberRoles[m.id] === 'lead';
              const primary = primaryOf(m);
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                  data-testid={`team-member-${m.fullName}`}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      name="memberIds"
                      value={m.id}
                      checked={checked}
                      onChange={() => setForm((f) => withMemberToggled(f, m.id))}
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
                  {checked && (
                    <>
                      <button
                        type="button"
                        aria-pressed={lead}
                        disabled={isManager}
                        title={isManager ? t('leadLocked') : t('leadToggle')}
                        onClick={() =>
                          setForm((f) => withMemberRole(f, m.id, lead ? 'member' : 'lead'))
                        }
                        data-testid={`team-lead-flag-${m.fullName}`}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10.5px] font-medium disabled:cursor-default',
                          lead
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-background',
                        )}
                      >
                        {t('leadFlag')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={primary.on}
                        disabled={primary.locked}
                        title={primary.locked ? t('primaryLocked') : t('primaryToggle')}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            primaryChoice: { ...f.primaryChoice, [m.id]: !primary.on },
                          }))
                        }
                        data-testid={`team-primary-flag-${m.fullName}`}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10.5px] font-medium disabled:cursor-default',
                          primary.on
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-background',
                        )}
                      >
                        {t('primaryFlag')}
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('primaryHint')}</p>
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
                  onChange={() =>
                    patch({
                      deviceIds: form.deviceIds.includes(d.id)
                        ? form.deviceIds.filter((x) => x !== d.id)
                        : [...form.deviceIds, d.id],
                    })
                  }
                  className="size-4 shrink-0 rounded border-border accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{d.label}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{d.phone}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {team && (
        <section
          className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
          data-testid="team-not-used"
        >
          <h3 className="mb-1 font-medium text-foreground">{tt('notUsed.title')}</h3>
          <p className="mb-1">{tt('notUsed.body')}</p>
          <ul className="list-disc space-y-0.5 ps-4">
            {notUsed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
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

/**
 * What the team stores that routing, hours and assignment do not read yet, as lines of text: always the strategy, and the rest only
 * when something is saved. Honest on purpose: a setting that does nothing is shown as such, never hidden.
 */
export function unusedLines(
  team: WspTeam | null,
  tt: (key: string, values?: Record<string, string | number>) => string,
): string[] {
  if (!team) return [];
  const lines = [tt('notUsed.strategy', { value: tt(`strategies.${team.assignmentStrategy}`) })];
  if (team.deviceIds.length > 0) lines.push(tt('notUsed.devices', { count: team.deviceIds.length }));
  if (team.unusedSettings.businessHours) lines.push(tt('notUsed.businessHours'));
  if (team.unusedSettings.timezone)
    lines.push(tt('notUsed.timezone', { value: team.unusedSettings.timezone }));
  if (team.unusedSettings.defaultAssignee) {
    lines.push(
      tt('notUsed.defaultAssignee', { name: team.unusedSettings.defaultAssignee.fullName }),
    );
  }
  return lines;
}
