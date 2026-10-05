'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MarketGrandfatherResult, MarketOperatorApp } from '@crm/contracts';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { grandfatherSubscriptions, marketKeys } from '../api';
import { marketError } from '../lib/errors';
import {
  grandfatherCheck,
  grandfatherPayload,
  grandfatherPreview,
  initialGrandfatherDraft,
  type GrandfatherDraft,
} from '../lib/grandfather';
import { DurationField, NoteField } from './comp-fields';
import { ErrorLine } from './ui';

const NS = 'marketplace.operator.grandfather';

/**
 * "Comp existing users": a feature that became a paid app is not taken from the workspaces that already have it. Step one asks for a dry run
 * (how many workspaces qualify, and some of their names); step two, after the operator has looked, runs it for real. The form is locked
 * between the two so what was previewed is what runs.
 */
export function GrandfatherDialog({
  app,
  onClose,
}: {
  app: Pick<MarketOperatorApp, 'slug' | 'name'>;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<GrandfatherDraft>(initialGrandfatherDraft);
  const [preview, setPreview] = useState<MarketGrandfatherResult | null>(null);
  const check = grandfatherCheck(draft);
  const view = preview ? grandfatherPreview(preview) : null;
  const formId = 'grandfather-form';

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      grandfatherSubscriptions(app.slug, grandfatherPayload(draft, dryRun)),
    onSuccess: (result) => {
      if (result.dryRun) {
        setPreview(result);
        return;
      }
      toast.success(t('done', { count: result.comped, name: app.name }));
      void qc.invalidateQueries({ queryKey: marketKeys.subscriptionsAll });
      void qc.invalidateQueries({ queryKey: marketKeys.subscriptionSummary });
      void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
      void qc.invalidateQueries({ queryKey: marketKeys.appDetailsAll });
      onClose();
    },
  });

  const busy = run.isPending;
  const refused = run.error ? marketError(run.error).key === 'subscriptionState' : false;

  return (
    <Modal
      open
      size="md"
      eyebrow={t('eyebrow')}
      title={t('title', { name: app.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          {view ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  run.reset();
                }}
              >
                {t('change')}
              </Button>
              <Button disabled={!view.canRun || busy} onClick={() => run.mutate(false)}>
                {busy && <Spinner />}
                {t('run', { count: view.matched })}
              </Button>
            </>
          ) : (
            <Button type="submit" form={formId} disabled={!check.canPreview || busy}>
              {busy && <Spinner />}
              {t('preview')}
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.canPreview && !preview) run.mutate(true);
        }}
      >
        <p className="text-muted-foreground">{t('intro', { name: app.name })}</p>
        <p className="text-xs text-muted-foreground">{t('timing')}</p>

        <DurationField
          id="grandfather"
          duration={draft.duration}
          months={draft.months}
          disabled={busy || preview !== null}
          onChange={(next) => setDraft({ ...draft, ...next })}
        />
        <NoteField
          id="grandfather-note"
          label={t('note')}
          value={draft.note}
          rule={check.note}
          disabled={busy || preview !== null}
          onChange={(note) => setDraft({ ...draft, note })}
        />

        {view && (
          <section aria-live="polite" className="space-y-2 rounded-md border border-border p-3">
            <h3 className="font-medium" data-testid="grandfather-matched">
              {t('matched', { count: view.matched })}
            </h3>
            {view.matched === 0 ? (
              <p className="text-muted-foreground">{t('nobody')}</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{t('sample')}</p>
                <ul className="list-disc space-y-0.5 ps-5" dir="auto">
                  {view.shown.map((name, i) => (
                    <li key={`${name}-${i}`}>{name}</li>
                  ))}
                </ul>
                {view.more > 0 && (
                  <p className="text-xs text-muted-foreground">{t('more', { count: view.more })}</p>
                )}
                <p className="text-xs text-muted-foreground">{t('confirm')}</p>
              </>
            )}
          </section>
        )}

        {refused ? <Alert tone="danger">{t('refused')}</Alert> : <ErrorLine error={run.error} />}
      </form>
    </Modal>
  );
}
