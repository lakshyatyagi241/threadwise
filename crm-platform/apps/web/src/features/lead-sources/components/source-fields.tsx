'use client';

import { useTranslations } from 'next-intl';
import { LEAD_OWNER_MODES, LEAD_RAW_RETENTION_MAX_DAYS, type LeadOwnerMode } from '@crm/contracts';
import { Alert, Button, Field, Input, MultiSelect, PasswordInput, Select, Switch } from '@crm/ui';
import { useLifecycleStages, useMembers, usePipelines } from '../api';
import {
  DEAL_TITLE_TOKENS,
  NAME_MAX,
  PATHS_LIST_ID,
  PATH_MAX,
  PLATFORM_MAX,
  SECRET_MAX,
  SECRET_MIN,
  keepSecret,
  withOwnerMode,
  type PathTarget,
  type Problems,
  type SourceDraft,
} from '../lib/draft';
import type { LeadFieldIssue } from '../lib/errors';
import { SpeedToLeadSection } from './speed-to-lead-section';

/**
 * The inputs of a source's basics (name, platform label, secret, external id, retention) and of what happens to a lead (defaults).
 * Shared by the create wizard and the detail page. A problem is shown under its own input, from the client's own checks first and
 * then from the server's field errors. Secrets are write only: nothing here renders a stored one.
 */

export type SetDraft = (fn: (d: SourceDraft) => SourceDraft) => void;

export interface FieldsProps {
  draft: SourceDraft;
  set: SetDraft;
  problems: Problems;
  server: Record<string, LeadFieldIssue>;
  disabled?: boolean;
}

/** `path -> sentence` for the problems the client found and the server's field errors. */
export function useFieldError(problems: Problems, server: Record<string, LeadFieldIssue>) {
  const t = useTranslations('lead-sources');
  return (path: string): string | undefined => {
    const p = problems[path];
    if (p) return t(`problems.${p.key}`, p.values);
    const s = server[path];
    if (s) return t(`errors.${s.key}`, s.values);
    return undefined;
  };
}

export function BasicsFields({
  draft,
  set,
  problems,
  server,
  disabled,
  hasSecret,
  onFocusTarget,
  connector,
}: FieldsProps & {
  /** A connector source (a Marketplace install): no shared secret, no sender id path, the portal supplies both. */
  connector?: boolean;
  /** The stored source has a shared secret (edit mode). `undefined` while creating. */
  hasSecret?: boolean;
  /** The external id path takes a path chip like any mapping input. */
  onFocusTarget?: (target: PathTarget) => void;
}) {
  const t = useTranslations('lead-sources.form');
  const error = useFieldError(problems, server);
  const editing = hasSecret !== undefined;

  return (
    <div className="space-y-4">
      <Field label={t('name')} htmlFor="ls-name" hint={t('nameHint')} error={error('name')}>
        <Input
          id="ls-name"
          value={draft.name}
          maxLength={NAME_MAX + 20}
          disabled={disabled}
          invalid={Boolean(error('name'))}
          autoComplete="off"
          onChange={(e) => set((d) => ({ ...d, name: e.target.value }))}
        />
      </Field>

      <Field
        label={t('platform')}
        htmlFor="ls-platform"
        hint={t('platformHint', { max: PLATFORM_MAX })}
        error={error('defaults.platform')}
      >
        <Input
          id="ls-platform"
          value={draft.platform}
          disabled={disabled}
          placeholder={t('platformPlaceholder')}
          invalid={Boolean(error('defaults.platform'))}
          autoComplete="off"
          onChange={(e) => set((d) => ({ ...d, platform: e.target.value }))}
        />
      </Field>

      {!connector && (
        <SecretField
          draft={draft}
          set={set}
          error={error('secret')}
          disabled={disabled}
          hasSecret={editing ? hasSecret : false}
        />
      )}

      {!connector && (
        <Field
          label={t('externalIdPath')}
          htmlFor="ls-external-id"
          hint={t('externalIdPathHint', { max: PATH_MAX })}
          error={error('externalIdPath')}
        >
          <Input
            id="ls-external-id"
            dir="ltr"
            list={PATHS_LIST_ID}
            onFocus={() => onFocusTarget?.({ kind: 'externalId' })}
            value={draft.externalIdPath}
            disabled={disabled}
            placeholder="lead.id"
            invalid={Boolean(error('externalIdPath'))}
            autoComplete="off"
            onChange={(e) => set((d) => ({ ...d, externalIdPath: e.target.value }))}
          />
        </Field>
      )}

      <Field
        label={t('retention')}
        htmlFor="ls-retention"
        hint={t('retentionHint', { max: LEAD_RAW_RETENTION_MAX_DAYS })}
        error={error('rawRetentionDays')}
        className="max-w-xs"
      >
        <Input
          id="ls-retention"
          type="number"
          inputMode="numeric"
          min={1}
          max={LEAD_RAW_RETENTION_MAX_DAYS}
          value={draft.retentionDays}
          disabled={disabled}
          invalid={Boolean(error('rawRetentionDays'))}
          onChange={(e) => set((d) => ({ ...d, retentionDays: e.target.value }))}
        />
      </Field>
    </div>
  );
}

/**
 * The shared secret of a source: write only. A stored one is shown as "set" and can be replaced or removed; its value is never
 * on the page. A string sets it, removing sends null, doing nothing keeps it.
 */
function SecretField({
  draft,
  set,
  error,
  disabled,
  hasSecret,
}: {
  draft: SourceDraft;
  set: SetDraft;
  error?: string;
  disabled?: boolean;
  hasSecret: boolean;
}) {
  const t = useTranslations('lead-sources.form.secret');
  const edit = draft.secret;
  const setSecret = (secret: SourceDraft['secret']) => set((d) => ({ ...d, secret }));

  let status: string;
  if (edit.mode === 'clear') status = t('willRemove');
  else if (edit.mode === 'set' && hasSecret) status = t('willReplace');
  else if (edit.mode === 'set') status = t('willSet');
  else status = hasSecret ? t('isSet') : t('notSet');

  const showInput = edit.mode === 'set' || (!hasSecret && edit.mode === 'keep');
  return (
    <div className="space-y-1.5 text-sm">
      <div className="font-medium" id="ls-secret-label">
        {t('label')}
      </div>
      <p className="text-xs text-muted-foreground" role="status" data-testid="secret-status">
        {status}
      </p>
      {showInput ? (
        <Field
          label={<span className="sr-only">{t('newValue')}</span>}
          htmlFor="ls-secret"
          hint={t('hint', { min: SECRET_MIN, max: SECRET_MAX })}
          error={error}
        >
          <PasswordInput
            id="ls-secret"
            value={edit.mode === 'set' ? edit.value : ''}
            disabled={disabled}
            autoComplete="new-password"
            invalid={Boolean(error)}
            showLabel={t('show')}
            hideLabel={t('hide')}
            onChange={(e) =>
              setSecret(
                e.target.value === '' ? keepSecret() : { mode: 'set', value: e.target.value },
              )
            }
          />
        </Field>
      ) : null}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          {hasSecret && edit.mode === 'keep' && (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSecret({ mode: 'set', value: '' })}
              >
                {t('replace')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setSecret({ mode: 'clear', value: '' })}
              >
                {t('remove')}
              </Button>
            </>
          )}
          {(edit.mode === 'clear' || (edit.mode === 'set' && hasSecret)) && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setSecret(keepSecret())}
            >
              {t('keep')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- what happens to a lead ---------------------------------------------------------------------------------------------------

export function DefaultsFields({ draft, set, problems, server, disabled }: FieldsProps) {
  const t = useTranslations('lead-sources.form');
  const error = useFieldError(problems, server);
  const members = useMembers();
  const pipelines = usePipelines();
  const stages = useLifecycleStages();

  const memberOptions = (members.data ?? []).map((m) => ({
    value: m.id,
    label: `${m.name} (${m.email})`,
  }));
  const pickerFailed = members.isError;
  const pipeline = pipelines.data?.find((p) => p.id === draft.pipelineId);

  return (
    <div className="space-y-6">
      {pickerFailed && <Alert tone="warning">{t('membersFailed')}</Alert>}

      <section aria-labelledby="ls-contact-h" className="space-y-4">
        <h3 id="ls-contact-h" className="text-sm font-semibold">
          {t('sections.contact')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('countryCode')}
            htmlFor="ls-country"
            hint={t('countryCodeHint')}
            error={error('defaults.countryCode')}
          >
            <Input
              id="ls-country"
              dir="ltr"
              inputMode="tel"
              value={draft.countryCode}
              disabled={disabled}
              placeholder="91"
              invalid={Boolean(error('defaults.countryCode'))}
              onChange={(e) => set((d) => ({ ...d, countryCode: e.target.value }))}
            />
          </Field>
          <Field
            label={t('lifecycleStage')}
            htmlFor="ls-stage"
            hint={t('lifecycleStageHint')}
            error={error('defaults.lifecycleStage')}
          >
            {stages.isError ? (
              <Input
                id="ls-stage"
                dir="ltr"
                value={draft.lifecycleStage}
                disabled={disabled}
                invalid={Boolean(error('defaults.lifecycleStage'))}
                onChange={(e) => set((d) => ({ ...d, lifecycleStage: e.target.value }))}
              />
            ) : (
              <Select
                id="ls-stage"
                value={draft.lifecycleStage}
                disabled={disabled || stages.isPending}
                invalid={Boolean(error('defaults.lifecycleStage'))}
                onChange={(e) => set((d) => ({ ...d, lifecycleStage: e.target.value }))}
              >
                <option value="">{t('lifecycleDefault')}</option>
                {(stages.data ?? []).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
                {draft.lifecycleStage !== '' &&
                  !(stages.data ?? []).some((s) => s.value === draft.lifecycleStage) && (
                    <option value={draft.lifecycleStage}>{draft.lifecycleStage}</option>
                  )}
              </Select>
            )}
          </Field>
          <Field
            label={t('tag')}
            htmlFor="ls-tag"
            hint={t('tagHint')}
            error={error('defaults.tag')}
            className="sm:col-span-2"
          >
            <Input
              id="ls-tag"
              value={draft.tag}
              disabled={disabled}
              invalid={Boolean(error('defaults.tag'))}
              onChange={(e) => set((d) => ({ ...d, tag: e.target.value }))}
            />
          </Field>
        </div>
      </section>

      <section aria-labelledby="ls-owner-h" className="space-y-4">
        <h3 id="ls-owner-h" className="text-sm font-semibold">
          {t('sections.owner')}
        </h3>
        <Field label={t('ownerMode')} htmlFor="ls-owner-mode" hint={t('ownerModeHint')}>
          <Select
            id="ls-owner-mode"
            value={draft.ownerMode}
            disabled={disabled}
            onChange={(e) => set((d) => withOwnerMode(d, e.target.value as LeadOwnerMode))}
          >
            {LEAD_OWNER_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`ownerModes.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        {draft.ownerMode === 'fixed' && (
          <Field
            label={t('ownerFixed')}
            htmlFor="ls-owner-one"
            error={error('defaults.owner.userIds')}
          >
            <Select
              id="ls-owner-one"
              value={draft.ownerUserIds[0] ?? ''}
              disabled={disabled || members.isPending}
              invalid={Boolean(error('defaults.owner.userIds'))}
              onChange={(e) =>
                set((d) => ({ ...d, ownerUserIds: e.target.value ? [e.target.value] : [] }))
              }
            >
              <option value="">{t('ownerChoose')}</option>
              {memberOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {draft.ownerUserIds[0] &&
                !memberOptions.some((o) => o.value === draft.ownerUserIds[0]) && (
                  <option value={draft.ownerUserIds[0]}>{t('unknownMember')}</option>
                )}
            </Select>
          </Field>
        )}
        {draft.ownerMode === 'round_robin' && (
          <Field
            label={t('ownerRoundRobin')}
            htmlFor="ls-owner-many"
            hint={t('ownerRoundRobinHint')}
            error={error('defaults.owner.userIds')}
          >
            <MultiSelect
              id="ls-owner-many"
              label={t('ownerRoundRobin')}
              options={memberOptions}
              value={draft.ownerUserIds}
              disabled={disabled}
              placeholder={t('pickMembers')}
              emptyLabel={t('noMembers')}
              removeLabel={(name) => t('removeMember', { name })}
              onChange={(ownerUserIds) => set((d) => ({ ...d, ownerUserIds }))}
            />
          </Field>
        )}
      </section>

      <section aria-labelledby="ls-deal-h" className="space-y-4">
        <h3 id="ls-deal-h" className="text-sm font-semibold">
          {t('sections.deal')}
        </h3>
        <div className="flex items-start gap-3">
          <Switch
            id="ls-deal-on"
            checked={draft.dealEnabled}
            disabled={disabled}
            label={t('dealEnabled')}
            onCheckedChange={(dealEnabled) => set((d) => ({ ...d, dealEnabled }))}
          />
          <label htmlFor="ls-deal-on" className="text-sm">
            <span className="block font-medium">{t('dealEnabled')}</span>
            <span className="block text-xs text-muted-foreground">{t('dealEnabledHint')}</span>
          </label>
        </div>
        {draft.dealEnabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            {pipelines.isError && (
              <Alert tone="warning" className="sm:col-span-2">
                {t('pipelinesFailed')}
              </Alert>
            )}
            <Field
              label={t('pipeline')}
              htmlFor="ls-pipeline"
              error={error('defaults.deal.pipelineId')}
            >
              <Select
                id="ls-pipeline"
                value={draft.pipelineId}
                disabled={disabled || pipelines.isPending || pipelines.isError}
                invalid={Boolean(error('defaults.deal.pipelineId'))}
                onChange={(e) => set((d) => ({ ...d, pipelineId: e.target.value, stageId: '' }))}
              >
                <option value="">{t('pipelineDefault')}</option>
                {(pipelines.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('dealStage')}
              htmlFor="ls-deal-stage"
              hint={draft.pipelineId === '' ? t('dealStageNeedsPipeline') : undefined}
              error={error('defaults.deal.stageId')}
            >
              <Select
                id="ls-deal-stage"
                value={draft.stageId}
                disabled={disabled || draft.pipelineId === '' || !pipeline}
                invalid={Boolean(error('defaults.deal.stageId'))}
                onChange={(e) => set((d) => ({ ...d, stageId: e.target.value }))}
              >
                <option value="">{t('dealStageFirst')}</option>
                {(pipeline?.stages ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('dealTitle')}
              htmlFor="ls-deal-title"
              hint={t('dealTitleHint', { tokens: DEAL_TITLE_TOKENS.join(', ') })}
              error={error('defaults.deal.title')}
              className="sm:col-span-2"
            >
              <Input
                id="ls-deal-title"
                value={draft.dealTitle}
                disabled={disabled}
                invalid={Boolean(error('defaults.deal.title'))}
                onChange={(e) => set((d) => ({ ...d, dealTitle: e.target.value }))}
              />
            </Field>
          </div>
        )}
      </section>

      <section aria-labelledby="ls-notify-h" className="space-y-4">
        <h3 id="ls-notify-h" className="text-sm font-semibold">
          {t('sections.notify')}
        </h3>
        <div className="flex items-start gap-3">
          <Switch
            id="ls-notify-owner"
            checked={draft.notifyOwner}
            disabled={disabled}
            label={t('notifyOwner')}
            onCheckedChange={(notifyOwner) => set((d) => ({ ...d, notifyOwner }))}
          />
          <label htmlFor="ls-notify-owner" className="text-sm">
            <span className="block font-medium">{t('notifyOwner')}</span>
            <span className="block text-xs text-muted-foreground">{t('notifyOwnerHint')}</span>
          </label>
        </div>
        <Field
          label={t('notifyUsers')}
          htmlFor="ls-notify-users"
          hint={t('notifyUsersHint')}
          error={error('defaults.notify.userIds')}
        >
          <MultiSelect
            id="ls-notify-users"
            label={t('notifyUsers')}
            options={memberOptions}
            value={draft.notifyUserIds}
            disabled={disabled}
            placeholder={t('pickMembers')}
            emptyLabel={t('noMembers')}
            removeLabel={(name) => t('removeMember', { name })}
            onChange={(notifyUserIds) => set((d) => ({ ...d, notifyUserIds }))}
          />
        </Field>
      </section>

      <SpeedToLeadSection draft={draft} set={set} error={error} disabled={disabled} />
    </div>
  );
}
