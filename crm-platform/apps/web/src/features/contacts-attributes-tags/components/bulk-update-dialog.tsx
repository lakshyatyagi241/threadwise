'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Modal, Select, Spinner } from '@crm/ui';
import { useStatusOptions } from '../api/attributes';
import { useOwners } from '../api/owners';
import type { BulkUpdateValues } from '../api/bulk';
import { useContactFields } from '../api/properties';
import {
  bulkCustomFields,
  bulkPropertyProblems,
  type BulkPropertyChanges,
} from '../lib/bulk-properties';
import { statusChoices, stageChoices } from '../lib/option-sets';
import {
  isLostStage,
  lostReasonChoices,
  lostReasonPayload,
  lostReasonProblem,
  type LostReasonAnswer,
} from '../lib/stage-flow';
import { BulkPropertiesSection } from './bulk-properties-section';
import { LostReasonFields } from './lost-reason';
import { TimezoneSelect } from './timezone-select';

const KEEP = '';
const UNASSIGN = '__none__';
const CLEAR_ZONE = '__clear__';

/**
 * "Update" on the selected contacts: set the stage, the status, the owner and any custom properties of all of them at
 * once. A field left on "Keep" is not touched; a lost stage asks for the reason once, which is recorded on every contact moved.
 */
export function BulkUpdateDialog({
  open,
  count,
  ownerOnly = false,
  busy,
  onApply,
  onClose,
}: {
  open: boolean;
  /** How many contacts the update reaches; `null` = everything the filter matches, count not known. */
  count: number | null;
  /**
   * "Select all N matching" has no explicit ids, which stage, status and property changes need: that selection can only be
   * handed to a new owner (the API moves a whole filter in one request), so the other fields are not offered.
   */
  ownerOnly?: boolean;
  busy: boolean;
  onApply: (values: BulkUpdateValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.bulkUpdate');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={count === null ? t('titleAll') : t('title', { count })}
      closeLabel={t('close')}
    >
      {open && (
        <Form count={count} ownerOnly={ownerOnly} busy={busy} onApply={onApply} onClose={onClose} />
      )}
    </Modal>
  );
}

function Form({
  count,
  ownerOnly,
  busy,
  onApply,
  onClose,
}: {
  count: number | null;
  ownerOnly: boolean;
  busy: boolean;
  onApply: (values: BulkUpdateValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.bulkUpdate');
  const tf = useTranslations('contacts-attributes-tags.form');
  const tz = useTranslations('contacts-attributes-tags.timezone');
  const uid = useId();
  const options = useStatusOptions();
  const owners = useOwners();
  const stages = useMemo(() => stageChoices(options.data), [options.data]);
  const [stage, setStage] = useState(KEEP);
  const [status, setStatus] = useState(KEEP);
  const [owner, setOwner] = useState(KEEP);
  const [zone, setZone] = useState(KEEP);
  const [reason, setReason] = useState<LostReasonAnswer>({ pick: '', text: '' });
  const [showProblems, setShowProblems] = useState(false);
  const registry = useContactFields();
  const [changes, setChanges] = useState<BulkPropertyChanges>({});
  const fieldsByKey = useMemo(
    () => new Map((registry.data ?? []).map((f) => [f.key, f])),
    [registry.data],
  );
  const propertyProblems = useMemo(
    () => bulkPropertyProblems(changes, fieldsByKey),
    [changes, fieldsByKey],
  );

  const statuses = useMemo(
    () => statusChoices(options.data, (v) => tf(`statuses.${v}`), undefined, stage || undefined),
    [options.data, tf, stage],
  );
  const reasons = useMemo(() => lostReasonChoices(options.data), [options.data]);
  const lost = stage !== KEEP && isLostStage(stages, stage);
  const problem = lost ? lostReasonProblem(reason, reasons.length > 0) : null;
  const nothing =
    stage === KEEP &&
    status === KEEP &&
    owner === KEEP &&
    zone === KEEP &&
    Object.keys(changes).length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (nothing || busy) return;
    setShowProblems(true);
    if (problem || Object.keys(propertyProblems).length > 0) return;
    const customFields = bulkCustomFields(changes, fieldsByKey);
    const values: BulkUpdateValues = {
      ...(stage !== KEEP ? { lifecycleStage: stage } : {}),
      ...(status !== KEEP ? { status } : {}),
      ...(owner !== KEEP ? { ownerId: owner === UNASSIGN ? null : owner } : {}),
      ...(zone !== KEEP ? { timezone: zone === CLEAR_ZONE ? null : zone } : {}),
      ...(lost ? lostReasonPayload(reason, reasons.length > 0) : {}),
      ...(customFields ? { customFields } : {}),
    };
    if (await onApply(values)) onClose();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {count === null ? t('hintAll') : t('hint', { count })}
      </p>
      {ownerOnly && <p className="text-sm text-muted-foreground">{t('ownerOnlyNote')}</p>}
      {!ownerOnly && (
        <>
          <Field label={t('stage')} htmlFor={`${uid}-stage`}>
            <Select
              id={`${uid}-stage`}
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setStatus(KEEP);
              }}
            >
              <option value={KEEP}>{t('keep')}</option>
              {stages.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          {lost && (
            <LostReasonFields
              choices={reasons}
              value={reason}
              onChange={setReason}
              problem={showProblems ? problem : null}
              idPrefix={`${uid}-lost`}
            />
          )}
          <Field label={t('status')} htmlFor={`${uid}-status`}>
            <Select id={`${uid}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value={KEEP}>{t('keep')}</option>
              {statuses.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <Field label={t('owner')} htmlFor={`${uid}-owner`}>
        <Select id={`${uid}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value={KEEP}>{t('keep')}</option>
          <option value={UNASSIGN}>{t('unassign')}</option>
          {(owners.data ?? [])
            .filter((p) => p.canAssign)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
        </Select>
      </Field>
      {!ownerOnly && (
        <Field label={tz('title')} htmlFor={`${uid}-zone`}>
          <TimezoneSelect
            id={`${uid}-zone`}
            value={zone}
            onChange={setZone}
            emptyLabel={t('keep')}
            extra={[{ value: CLEAR_ZONE, label: tz('clear') }]}
          />
        </Field>
      )}
      {!ownerOnly && (
        <BulkPropertiesSection
          fields={registry.data ?? []}
          changes={changes}
          problems={showProblems ? propertyProblems : {}}
          count={count ?? 0}
          idPrefix={`${uid}-props`}
          onChange={setChanges}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={nothing || busy}>
          {busy && <Spinner />}
          {count === null ? t('applyAll') : t('apply', { count })}
        </Button>
      </div>
    </form>
  );
}
