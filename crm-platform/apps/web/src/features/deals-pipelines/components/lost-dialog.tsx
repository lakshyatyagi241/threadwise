'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Modal, Select, Spinner, Textarea } from '@crm/ui';
import { useLostReasons } from '../api/hooks';
import {
  LOST_REASON_KEYS,
  LOST_REASON_MAX,
  OTHER,
  resolveLostReason,
  type LostReasonPayload,
  type ReasonOption,
} from '../lib/lost-reasons';

export interface LostDialogProps {
  dealTitle: string;
  busy?: boolean;
  onConfirm: (reason: LostReasonPayload) => void;
  onClose: () => void;
}

/**
 * Closing a deal as lost always asks why (WaDesk never did, so reasons were empty in practice). The choices are the
 * workspace's lost-reason catalogue; until it has entries the dialog offers a few presets. "Other" asks for a few
 * words. Mount it only while it is needed: it starts empty each time.
 */
export function LostDialog({ dealTitle, busy, onConfirm, onClose }: LostDialogProps) {
  const t = useTranslations('deals-pipelines.lost');
  const catalogue = useLostReasons(true);
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [touched, setTouched] = useState(false);

  const options = useMemo<ReasonOption[]>(() => {
    const rows = catalogue.data ?? [];
    if (rows.length > 0) return rows.map((r) => ({ value: `r:${r.id}`, label: r.name, id: r.id }));
    return LOST_REASON_KEYS.map((k) => ({ value: `p:${k}`, label: t(`reasons.${k}`) }));
  }, [catalogue.data, t]);
  const payload = resolveLostReason(choice, options, other);

  const submit = () => {
    setTouched(true);
    if (payload) onConfirm(payload);
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={dealTitle}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="danger" disabled={busy || catalogue.isPending} onClick={submit}>
            {busy && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Field
          label={t('reason')}
          htmlFor="lost-reason"
          error={touched && !choice ? t('required') : undefined}
        >
          <Select
            id="lost-reason"
            value={choice}
            invalid={touched && !choice}
            disabled={catalogue.isPending}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">{t('choose')}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value={OTHER}>{t('other')}</option>
          </Select>
        </Field>
        {choice === OTHER && (
          <Field
            label={t('details')}
            htmlFor="lost-other"
            error={touched && !payload ? t('required') : undefined}
          >
            <Textarea
              id="lost-other"
              rows={3}
              maxLength={LOST_REASON_MAX}
              autoFocus
              value={other}
              invalid={touched && !payload}
              onChange={(e) => setOther(e.target.value)}
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
