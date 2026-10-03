'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { PAYGW_PROOF_MAX_BYTES } from '@crm/contracts';
import { Alert, Button, Field, Input, Textarea } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { uploadProof } from '../api';

const NS = 'platform-payment-gateways.proof';
const TYPES = 'image/jpeg,image/png,image/webp,application/pdf';

/** Attach (or replace) the receipt of an offline payment (TW-PAYGW-013). The server checks the file's real type and size again. */
export function ProofForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const t = useTranslations(NS);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      uploadProof(orderId, file!, {
        paymentReference: reference.trim() || undefined,
        proofNote: note.trim() || undefined,
      }),
    onSuccess: onDone,
    onError: (e) =>
      setProblem(
        e instanceof ApiError && e.status === 409
          ? t('closed')
          : e instanceof ApiError && e.status === 422
            ? t('rejected')
            : t('failed'),
      ),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return setProblem(t('chooseFile'));
        if (file.size > PAYGW_PROOF_MAX_BYTES) return setProblem(t('tooLarge'));
        setProblem(null);
        send.mutate();
      }}
    >
      {problem && <Alert tone="danger">{problem}</Alert>}
      <Field label={t('file')} htmlFor="proof-file" hint={t('fileHint')}>
        <Input
          id="proof-file"
          type="file"
          accept={TYPES}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label={t('reference')} htmlFor="proof-ref" hint={t('referenceHint')}>
        <Input
          id="proof-ref"
          maxLength={120}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>
      <Field label={t('note')} htmlFor="proof-note">
        <Textarea
          id="proof-note"
          maxLength={1000}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={send.isPending}>
        {send.isPending ? t('sending') : t('submit')}
      </Button>
    </form>
  );
}
