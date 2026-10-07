'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AIAG_RESPONDER_MODES, type AiagResponder, type AiagResponderMode } from '@crm/contracts';
import { Button, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, saveResponder, useResponder } from '../api/training';

/**
 * "Who answers your WhatsApp?" (TW-AIAG-013): our AI, or Meta's own Business Agent, so a customer never gets two replies. Only
 * stores the choice; the stand-down of our AI and the keyword auto-replies is enforced where they are sent.
 */
export function ResponderCard() {
  const t = useTranslations('aiTraining.responder');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = useCan('aiag.responder.manage');
  const current = useResponder();
  return current.data ? (
    <Form
      key={`${current.data.mode}:${current.data.metaAgentEnabled}`}
      initial={current.data}
      canManage={canManage}
      onSaved={(r) => {
        qc.setQueryData(KEYS.responder, r);
        toast(t('saved'), 'success');
      }}
      onFailed={(e) => toast(e instanceof ApiError ? e.message : t('saveFailed'), 'danger')}
    />
  ) : current.isError ? (
    <section className="mb-6 rounded-2xl border border-border bg-background p-5 shadow-sm">
      <h2 className="text-[19px] leading-tight">{t('title')}</h2>
      <p className="mt-2 text-sm text-danger" role="alert">
        {t('loadError')}
      </p>
      <Button variant="secondary" className="mt-3" onClick={() => void current.refetch()}>
        {t('retry')}
      </Button>
    </section>
  ) : (
    <section
      aria-busy="true"
      className="mb-6 rounded-2xl border border-border bg-background p-5 shadow-sm"
    >
      <h2 className="text-[19px] leading-tight">{t('title')}</h2>
      <div className="mt-3">
        <Spinner label={t('loading')} />
      </div>
    </section>
  );
}

function Form({
  initial,
  canManage,
  onSaved,
  onFailed,
}: {
  initial: AiagResponder;
  canManage: boolean;
  onSaved: (r: AiagResponder) => void;
  onFailed: (e: unknown) => void;
}) {
  const t = useTranslations('aiTraining.responder');
  const [mode, setMode] = useState<AiagResponderMode>(initial.mode);
  const [meta, setMeta] = useState(initial.metaAgentEnabled);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !canManage) return;
    setBusy(true);
    try {
      onSaved(await saveResponder({ mode, metaAgentEnabled: meta }));
    } catch (err) {
      onFailed(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mb-6 rounded-2xl border border-border bg-background p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] leading-tight">{t('title')}</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">{t('body')}</p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={meta}
            disabled={!canManage}
            onChange={(e) => setMeta(e.target.checked)}
            className="size-4 rounded border-border accent-[var(--color-brand,#075e54)]"
          />
          {t('metaCheck')}
        </label>
      </div>

      <fieldset className="mt-4" disabled={!canManage}>
        <legend className="sr-only">{t('title')}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {AIAG_RESPONDER_MODES.map((key) => (
            <label
              key={key}
              className={cn(
                'cursor-pointer rounded-[14px] border p-3.5 focus-within:ring-2 focus-within:ring-primary',
                mode === key
                  ? 'border-brand bg-emerald-50 dark:bg-emerald-950/30'
                  : 'border-border hover:bg-muted',
                !canManage && 'cursor-not-allowed opacity-70',
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="aiag-responder-mode"
                  value={key}
                  checked={mode === key}
                  onChange={() => setMode(key)}
                  className="accent-[var(--color-brand,#075e54)]"
                />
                <span className="text-[13px] font-semibold">{t(`mode.${key}.label`)}</span>
              </span>
              <span className="mt-1.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                {t(`mode.${key}.desc`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canManage && (
          <Button type="submit" disabled={busy} className="rounded-full">
            {busy && <Spinner />}
            {t('save')}
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {canManage ? t('hint') : t('readOnly')}
        </span>
      </div>
    </form>
  );
}
