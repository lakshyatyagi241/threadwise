'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { WALLET_LIMITS, type AdjustWalletResult } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Spinner, Textarea, cn } from '@crm/ui';
import { operatorApi } from '../../api';
import {
  EMPTY_ADJUST,
  checkAdjust,
  keyFor,
  outcomeOf,
  previewBalance,
  signatureOf,
  willBeCapped,
  type AdjustDirection,
  type KeyMemo,
} from '../../lib/adjust';
import { errorKind, type ErrorKind } from '../../lib/errors';
import { currencySymbol, formatMinor } from '../../lib/money';

/**
 * Add money to / deduct money from a workspace wallet. The reason is mandatory (it is shown to the workspace and kept in the
 * audit log), so the review button stays off until it is valid. A confirm step restates the effect before anything is sent.
 * One Idempotency-Key is kept per distinct request, so a retry after a timeout never posts twice.
 */
export function AdjustDialog({
  workspaceId,
  workspaceName,
  currency,
  balanceMinor,
  onClose,
  onDone,
}: {
  workspaceId: string;
  workspaceName: string;
  currency: string;
  balanceMinor: number;
  onClose: () => void;
  onDone: (result: AdjustWalletResult) => void;
}) {
  const t = useTranslations('wallet-message-billing.admin.adjust');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const [draft, setDraft] = useState(EMPTY_ADJUST);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [shown, setShown] = useState(false);
  const [failure, setFailure] = useState<ErrorKind | null>(null);
  const memo = useRef<KeyMemo | null>(null);
  const check = checkAdjust(draft);
  const money = (m: number) => formatMinor(m, currency, locale);

  const post = useMutation({
    mutationFn: () => {
      if (!check.input) throw new Error('unreachable: the form validates before posting');
      memo.current = keyFor(memo.current, signatureOf(workspaceId, check.input));
      return operatorApi.adjust(workspaceId, check.input, memo.current.key);
    },
    onSuccess: (r) => onDone(r),
    onError: (err) => {
      setFailure(errorKind(err));
      setStep('form');
    },
  });

  const set = (patch: Partial<typeof draft>) => {
    setFailure(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const review = () => {
    setShown(true);
    if (check.input) setStep('confirm');
  };

  const amountMinor = check.amountMinor ?? 0;
  const after = previewBalance(balanceMinor, draft.direction, amountMinor);
  const capped = willBeCapped(balanceMinor, draft.direction, amountMinor);
  const noteLen = draft.note.trim().length;
  const amountError = shown && check.amount ? t(`problems.amount.${check.amount}`) : undefined;
  const noteError = shown && check.note ? t(`problems.note.${check.note}`, { min: WALLET_LIMITS.noteMin, max: WALLET_LIMITS.noteMax }) : undefined;

  return (
    <Modal
      open
      size="md"
      onClose={() => !post.isPending && onClose()}
      title={t('title')}
      eyebrow={workspaceName}
      closeLabel={tc('close')}
      footer={
        step === 'form' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button onClick={review} disabled={check.input === null}>
              {t('review')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep('form')} disabled={post.isPending}>
              {tc('back')}
            </Button>
            <Button
              variant={draft.direction === 'debit' ? 'danger' : 'primary'}
              onClick={() => post.mutate()}
              disabled={post.isPending}
            >
              {post.isPending && <Spinner label={t('posting')} />}
              {t(draft.direction === 'credit' ? 'confirmAdd' : 'confirmDeduct')}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {t('current')}: <span className="font-medium text-foreground">{money(balanceMinor)}</span>
        </p>
        {failure && <Alert tone="danger">{te(failure)}</Alert>}
        {step === 'form' ? (
          <>
            <fieldset className="space-y-1.5">
              <legend className="font-medium">{t('direction')}</legend>
              <div role="radiogroup" aria-label={t('direction')} className="inline-flex rounded-md border border-border p-0.5">
                {(['credit', 'debit'] as const).map((d: AdjustDirection) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={draft.direction === d}
                    onClick={() => set({ direction: d })}
                    className={cn(
                      'rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      draft.direction === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {t(d === 'credit' ? 'add' : 'deduct')}
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label={t('amount')} htmlFor="adj-amount" hint={t('amountHint')} error={amountError}>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground" aria-hidden="true">{currencySymbol(currency, locale)}</span>
                <Input
                  id="adj-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="250.00"
                  value={draft.amount}
                  invalid={Boolean(amountError)}
                  onChange={(e) => set({ amount: e.target.value })}
                />
              </div>
            </Field>
            {capped && <Alert tone="warning">{t('cappedWarning', { balance: money(balanceMinor) })}</Alert>}
            <Field label={t('reason')} htmlFor="adj-note" hint={t('reasonHint')} error={noteError}>
              <Textarea
                id="adj-note"
                rows={3}
                maxLength={WALLET_LIMITS.noteMax}
                value={draft.note}
                aria-required="true"
                invalid={Boolean(noteError)}
                onChange={(e) => set({ note: e.target.value })}
              />
              <p className="text-end text-xs text-muted-foreground" aria-live="polite">
                {t('counter', { count: noteLen, max: WALLET_LIMITS.noteMax })}
              </p>
            </Field>
          </>
        ) : (
          <div className="space-y-2" aria-live="polite">
            <p className="font-medium">
              {t(draft.direction === 'credit' ? 'summaryAdd' : 'summaryDeduct', {
                amount: money(amountMinor),
                workspace: workspaceName,
              })}
            </p>
            <p>{t('newBalance', { balance: money(after) })}</p>
            {capped && <Alert tone="warning">{t('cappedWarning', { balance: money(balanceMinor) })}</Alert>}
            <p className="text-muted-foreground">{t('summaryReason', { reason: draft.note.trim() })}</p>
            <p className="text-xs text-muted-foreground">{t('visibleNote')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The sentence shown after an adjustment: what was applied, which differs from the request when a debit hit 0. */
export function resultMessageKey(r: AdjustWalletResult): 'appliedAdd' | 'appliedDeduct' | 'partial' {
  if (outcomeOf(r) === 'partial') return 'partial';
  return r.direction === 'credit' ? 'appliedAdd' : 'appliedDeduct';
}
