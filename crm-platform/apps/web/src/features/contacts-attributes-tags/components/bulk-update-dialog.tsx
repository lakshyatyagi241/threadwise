'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Modal, Select, Spinner } from '@crm/ui';
import { usePeople } from '@/features/segments';
import { useStatusOptions } from '../api/attributes';
import type { BulkUpdateValues } from '../api/bulk';
import { statusChoices, stageChoices } from '../lib/option-sets';
import {
  isLostStage,
  lostReasonChoices,
  lostReasonPayload,
  lostReasonProblem,
  type LostReasonAnswer,
} from '../lib/stage-flow';
import { LostReasonFields } from './lost-reason';

const KEEP = '';
const UNASSIGN = '__none__';

/**
 * "Update" on the selected contacts: set the stage, the status and the owner of all of them at once. A field left on
 * "Keep" is not touched; a lost stage asks for the reason once, which is recorded on every contact moved.
 */
export function BulkUpdateDialog({
  open,
  count,
  busy,
  onApply,
  onClose,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onApply: (values: BulkUpdateValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.bulkUpdate');
  return (
    <Modal open={open} onClose={onClose} title={t('title', { count })} closeLabel={t('close')}>
      {open && <Form count={count} busy={busy} onApply={onApply} onClose={onClose} />}
    </Modal>
  );
}

function Form({
  count,
  busy,
  onApply,
  onClose,
}: {
  count: number;
  busy: boolean;
  onApply: (values: BulkUpdateValues) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.bulkUpdate');
  const tf = useTranslations('contacts-attributes-tags.form');
  const uid = useId();
  const options = useStatusOptions();
  const people = usePeople();
  const stages = useMemo(() => stageChoices(options.data), [options.data]);
  const [stage, setStage] = useState(KEEP);
  const [status, setStatus] = useState(KEEP);
  const [owner, setOwner] = useState(KEEP);
  const [reason, setReason] = useState<LostReasonAnswer>({ pick: '', text: '' });
  const [showProblems, setShowProblems] = useState(false);

  const statuses = useMemo(
    () => statusChoices(options.data, (v) => tf(`statuses.${v}`), undefined, stage || undefined),
    [options.data, tf, stage],
  );
  const reasons = useMemo(() => lostReasonChoices(options.data), [options.data]);
  const lost = stage !== KEEP && isLostStage(stages, stage);
  const problem = lost ? lostReasonProblem(reason, reasons.length > 0) : null;
  const nothing = stage === KEEP && status === KEEP && owner === KEEP;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (nothing || busy) return;
    setShowProblems(true);
    if (problem) return;
    const values: BulkUpdateValues = {
      ...(stage !== KEEP ? { lifecycleStage: stage } : {}),
      ...(status !== KEEP ? { status } : {}),
      ...(owner !== KEEP ? { ownerId: owner === UNASSIGN ? null : owner } : {}),
      ...(lost ? lostReasonPayload(reason, reasons.length > 0) : {}),
    };
    if (await onApply(values)) onClose();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('hint', { count })}</p>
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
      <Field label={t('owner')} htmlFor={`${uid}-owner`}>
        <Select id={`${uid}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value={KEEP}>{t('keep')}</option>
          <option value={UNASSIGN}>{t('unassign')}</option>
          {(people.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={nothing || busy}>
          {busy && <Spinner />}
          {t('apply', { count })}
        </Button>
      </div>
    </form>
  );
}
