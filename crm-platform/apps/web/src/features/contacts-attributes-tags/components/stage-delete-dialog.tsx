'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { StatusOptionResponse } from '@crm/contracts';
import { Alert, Button, Field, Modal, Select, Spinner, useToast } from '@crm/ui';
import { invalidateContacts } from '../api/contacts';
import { deleteStatusOption, invalidateStatusOptions, useStatusUsage } from '../api/stages';
import { deleteNeeds, moveTargets, STAGE_GROUP, type OptionGroup } from '../lib/stage-model';
import { ErrorLine } from './error-line';

/**
 * Delete a stage or status. When no contact holds it, a plain confirmation; when some do, the count and a choice of
 * where they go (they are moved in the same step the option is deleted); when it is the only option, a refusal.
 */
export function StageDeleteDialog({
  group,
  option,
  options,
  scopedStatuses = 0,
  onClose,
}: {
  group: OptionGroup;
  /** The option to delete; null = closed. */
  option: StatusOptionResponse | null;
  /** Every option of the group. */
  options: readonly StatusOptionResponse[];
  /** Deleting a stage: how many statuses are limited to it (they stay, and become available in every stage). */
  scopedStatuses?: number;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.stages');
  return (
    <Modal
      open={option !== null}
      onClose={onClose}
      title={t('delete.title', { name: option?.label ?? '' })}
      size="sm"
    >
      {option && (
        <DeleteBody
          key={option.id}
          group={group}
          option={option}
          options={options}
          scopedStatuses={scopedStatuses}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function DeleteBody({
  group,
  option,
  options,
  scopedStatuses,
  onClose,
}: {
  group: OptionGroup;
  option: StatusOptionResponse;
  options: readonly StatusOptionResponse[];
  scopedStatuses: number;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.stages');
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const usage = useStatusUsage(group);
  const holders = usage.data?.get(option.id);
  const targets = moveTargets(options, option.id);
  const [chosen, setChosen] = useState('');
  // Start from the default option (else the first active one) so the common case is one click.
  const suggested =
    targets.find((o) => o.isDefault && o.isActive) ?? targets.find((o) => o.isActive) ?? targets[0];
  const moveTo = targets.some((o) => o.id === chosen) ? chosen : (suggested?.id ?? '');

  const remove = useMutation({
    mutationFn: () => deleteStatusOption(option.id, (holders ?? 0) > 0 ? moveTo : undefined),
    onSuccess: async () => {
      await Promise.all([invalidateStatusOptions(qc), invalidateContacts(qc)]);
      toast(t('delete.done', { name: option.label }), 'success');
      onClose();
    },
    onError: () => void usage.refetch(),
  });

  const needs = holders === undefined ? null : deleteNeeds(holders);
  const refused = needs === 'move' && targets.length === 0;
  const target = targets.find((o) => o.id === moveTo);

  return (
    <div className="space-y-4">
      {usage.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('delete.checking')}
        </div>
      ) : usage.isError ? (
        <ErrorLine error={usage.error} onRetry={() => void usage.refetch()} />
      ) : needs === 'nothing' ? (
        <p className="text-sm">{t('delete.unused')}</p>
      ) : refused ? (
        <Alert tone="warning">{t('delete.onlyOne', { count: holders ?? 0 })}</Alert>
      ) : (
        <>
          <Alert tone="warning">
            {t('delete.inUse', { count: holders ?? 0, name: option.label })}
          </Alert>
          <Field label={t('delete.moveTo')} htmlFor={`${uid}-move`}>
            <Select id={`${uid}-move`} value={moveTo} onChange={(e) => setChosen(e.target.value)}>
              {targets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                  {o.isActive ? '' : ` (${t('row.hidden')})`}
                </option>
              ))}
            </Select>
          </Field>
          {group !== STAGE_GROUP && target?.stageOptionId && (
            <p className="text-xs text-muted-foreground">
              {t('delete.moveScopedNote', { target: target.label })}
            </p>
          )}
        </>
      )}
      {group === STAGE_GROUP && scopedStatuses > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('delete.scopedStatuses', { count: scopedStatuses })}
        </p>
      )}
      {group === STAGE_GROUP && option.isDefault && needs !== null && (
        <p className="text-xs text-muted-foreground">{t('delete.wasDefault')}</p>
      )}
      {remove.isError && <ErrorLine error={remove.error} />}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={remove.isPending}>
          {refused ? t('delete.close') : t('delete.keep')}
        </Button>
        {!refused && (
          <Button
            variant="danger"
            disabled={remove.isPending || needs === null || (needs === 'move' && !moveTo)}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Spinner />}
            {needs === 'move'
              ? t('delete.moveAndDelete', { count: holders ?? 0, target: target?.label ?? '' })
              : t('delete.confirm')}
          </Button>
        )}
      </div>
    </div>
  );
}
