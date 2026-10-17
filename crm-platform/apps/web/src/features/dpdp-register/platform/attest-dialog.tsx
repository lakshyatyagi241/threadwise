'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Modal, Select, Textarea } from '@crm/ui';
import type { DpdpAttestInput, DpdpCheckKey } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  ATTEST_LIMITS,
  buildAttestInput,
  checkMessageKey,
  emptyAttestDraft,
  errorKind,
  type AttestDraft,
} from './logic';
import { REGISTER_KEY, historyKey, registerSchema } from './queries';

const NS = 'dpdp-register-admin';
const FIELD_ORDER = ['note', 'evidenceUrl', 'expiresInDays'] as const;

/** The form a super admin fills to record that an attestable check passes or fails. Closed, it holds nothing, so it opens blank every time. */
export function AttestDialog({
  checkKey,
  onClose,
}: {
  checkKey: DpdpCheckKey | null;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  return (
    <Modal open={checkKey !== null} onClose={onClose} size="md" title={t('attest.title')}>
      {checkKey && <AttestForm key={checkKey} checkKey={checkKey} onClose={onClose} />}
    </Modal>
  );
}

function AttestForm({ checkKey, onClose }: { checkKey: DpdpCheckKey; onClose: () => void }) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<AttestDraft>(emptyAttestDraft);
  const [showErrors, setShowErrors] = useState(false);
  // `isPending` only turns true after the next render, so a fast double press would send twice; the ref closes that window.
  const sending = useRef(false);

  const days = { min: ATTEST_LIMITS.daysMin, max: ATTEST_LIMITS.daysMax };
  const built = buildAttestInput(draft);
  const errors = showErrors && !built.ok ? built.errors : {};

  const save = useMutation({
    mutationFn: (body: DpdpAttestInput) =>
      operatorFetch(`/dpdp-register/checks/${encodeURIComponent(checkKey)}/attest`, {
        method: 'POST',
        body,
        schema: registerSchema,
      }),
    // The API answers with the register as it now reads, so the page updates without a second call.
    onSuccess: (register) => {
      qc.setQueryData(REGISTER_KEY, register);
      void qc.invalidateQueries({ queryKey: historyKey(checkKey) });
      toast.success(t('attest.saved'));
      onClose();
    },
    onError: (error) => toast.error(t(`errors.${errorKind(error)}`)),
    onSettled: () => {
      sending.current = false;
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending || sending.current) return;
    if (!built.ok) {
      setShowErrors(true);
      const first = FIELD_ORDER.find((field) => built.errors[field]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    sending.current = true;
    save.mutate(built.body);
  };

  const change = (patch: Partial<AttestDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(`checks.${checkMessageKey(checkKey)}.title`)}</p>
        <p className="text-sm text-muted-foreground">{t('attest.intro')}</p>
      </div>

      <Field label={t('attest.result.label')} htmlFor={`${id}-result`}>
        <Select
          id={`${id}-result`}
          value={draft.result}
          onChange={(e) => change({ result: e.target.value === 'fail' ? 'fail' : 'pass' })}
        >
          <option value="pass">{t('attest.result.pass')}</option>
          <option value="fail">{t('attest.result.fail')}</option>
        </Select>
      </Field>

      <Field
        label={t('attest.note.label')}
        htmlFor={`${id}-note`}
        hint={t('attest.note.hint', { min: ATTEST_LIMITS.noteMin })}
        error={
          errors.note
            ? t(`attest.problems.${errors.note === 'long' ? 'noteLong' : 'noteShort'}`, {
                min: ATTEST_LIMITS.noteMin,
                max: ATTEST_LIMITS.noteMax,
              })
            : undefined
        }
      >
        <Textarea
          id={`${id}-note`}
          value={draft.note}
          maxLength={ATTEST_LIMITS.noteMax}
          invalid={Boolean(errors.note)}
          onChange={(e) => change({ note: e.target.value })}
        />
      </Field>

      <Field
        label={t('attest.evidence.label')}
        htmlFor={`${id}-evidenceUrl`}
        hint={t('attest.evidence.hint')}
        error={errors.evidenceUrl ? t('attest.problems.link') : undefined}
      >
        <Input
          id={`${id}-evidenceUrl`}
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          placeholder={t('attest.evidence.placeholder')}
          value={draft.evidenceUrl}
          invalid={Boolean(errors.evidenceUrl)}
          onChange={(e) => change({ evidenceUrl: e.target.value })}
        />
      </Field>

      <Field
        label={t('attest.expiry.label')}
        htmlFor={`${id}-expiresInDays`}
        hint={t('attest.expiry.hint', days)}
        error={errors.expiresInDays ? t('attest.problems.range', days) : undefined}
      >
        <Input
          id={`${id}-expiresInDays`}
          inputMode="numeric"
          dir="ltr"
          value={draft.expiresInDays}
          invalid={Boolean(errors.expiresInDays)}
          onChange={(e) => change({ expiresInDays: e.target.value })}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {t('attest.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('attest.saving') : t('attest.submit')}
        </Button>
      </div>
    </form>
  );
}
