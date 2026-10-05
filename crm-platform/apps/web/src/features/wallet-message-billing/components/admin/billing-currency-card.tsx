'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WALLET_LIMITS, type PlatformWalletDetail } from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Modal, Select, Spinner, Textarea } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind, type ErrorKind } from '../../lib/errors';
import { formatMinor } from '../../lib/money';

/**
 * The currency a workspace is billed in, and every wallet it holds. Messages are priced from Meta's card for this currency and
 * charged to this currency's wallet. A wallet in an older currency keeps its money (nothing is converted), so it is listed here.
 */
export function BillingCurrencyCard({
  d,
  canWrite,
}: {
  d: PlatformWalletDetail;
  canWrite: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.detail.billingCurrency');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const others = d.wallets.filter((w) => w.currency !== d.currency);
  const choices = d.billableCurrencies.filter((c) => c !== d.currency);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {canWrite && choices.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t('change')}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('billedIn')}</span>
        <Badge tone="success">{d.currency}</Badge>
      </div>
      {others.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('otherWallets')}</p>
          <ul className="space-y-1 text-sm">
            {others.map((w) => (
              <li key={w.currency} className="flex flex-wrap items-center gap-2">
                <Badge>{w.currency}</Badge>
                <span className="tabular-nums">
                  {formatMinor(w.balanceMinor, w.currency, locale)}
                </span>
                {w.balanceMinor > 0 && (
                  <span className="text-xs text-muted-foreground">{t('notUsed')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && <ChangeDialog d={d} choices={choices} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function ChangeDialog({
  d,
  choices,
  onClose,
}: {
  d: PlatformWalletDetail;
  choices: string[];
  onClose: () => void;
}) {
  const t = useTranslations('wallet-message-billing.admin.detail.billingCurrency.dialog');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [currency, setCurrency] = useState(choices[0] ?? '');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<ErrorKind | null>(null);
  const noteOk = note.trim().length >= WALLET_LIMITS.noteMin;
  const leaving = d.balanceMinor;

  const save = useMutation({
    mutationFn: () =>
      operatorApi.setWorkspaceCurrency(d.workspace.id, { currency, note: note.trim() }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: KEYS.workspace(d.workspace.id) });
      void qc.invalidateQueries({ queryKey: KEYS.workspaces });
      void qc.invalidateQueries({ queryKey: KEYS.overview });
      toast.success(t('done', { from: r.previousCurrency, to: r.currency }));
      onClose();
    },
    onError: (err) => setFailure(errorKind(err)),
  });

  return (
    <Modal
      open
      size="md"
      onClose={() => !save.isPending && onClose()}
      title={t('title')}
      eyebrow={d.workspace.name}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={!currency || !noteOk || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {t('confirm', { currency })}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {failure && <Alert tone="danger">{te(failure)}</Alert>}
        <Field label={t('currency')} htmlFor="bc-currency">
          <Select
            id="bc-currency"
            value={currency}
            onChange={(e) => {
              setFailure(null);
              setCurrency(e.target.value);
            }}
          >
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Alert tone="warning">
          <p>{t('effect', { from: d.currency, to: currency })}</p>
          {leaving > 0 && (
            <p className="mt-1 font-medium">
              {t('left', { amount: formatMinor(leaving, d.currency, locale), from: d.currency })}
            </p>
          )}
        </Alert>
        <Field label={t('reason')} htmlFor="bc-note" hint={t('reasonHint')}>
          <Textarea
            id="bc-note"
            rows={3}
            maxLength={WALLET_LIMITS.noteMax}
            value={note}
            aria-required="true"
            onChange={(e) => {
              setFailure(null);
              setNote(e.target.value);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}
