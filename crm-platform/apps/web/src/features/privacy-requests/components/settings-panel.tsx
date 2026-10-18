'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Input, Spinner, Textarea, useToast } from '@crm/ui';
import { KEYS, usePrivacySettings } from '../api/hooks';
import { privacyApi } from '../api/service';
import { errorKey } from '../lib/errors';

/** The deadline of a request, in days (managers only). */
export function SettingsPanel() {
  const t = useTranslations('privacy-requests');
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = usePrivacySettings(true);
  const [value, setValue] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = value ?? String(q.data?.slaDays ?? '');
  const n = Number(shown);
  const valid = Number.isInteger(n) && n >= 1 && n <= 90;
  const savedNotice = q.data?.legalHoldRequesterNotice ?? '';
  const shownNotice = notice ?? savedNotice;
  const noticeChanged = notice !== null && notice.trim() !== savedNotice;
  const save = useMutation({
    mutationFn: () =>
      privacyApi.saveSettings(n, noticeChanged ? notice!.trim() || null : undefined),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      setValue(null);
      setNotice(null);
      toast(t('settings.saved'), 'success');
    },
  });

  return (
    <section className="space-y-3 rounded-xl border border-border bg-background p-4">
      <h2 className="text-sm font-semibold">{t('settings.title')}</h2>
      {q.isError ? (
        <Alert tone="danger" role="alert">
          {t(`errors.${errorKey(q.error)}`)}
        </Alert>
      ) : !q.data ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('common.loading')}
        </div>
      ) : (
        <>
          <Field
            label={t('settings.slaDays')}
            htmlFor="pr-sla-days"
            hint={t('settings.slaHint')}
            error={shown !== '' && !valid ? t('settings.invalid') : undefined}
          >
            <Input
              id="pr-sla-days"
              type="number"
              min={1}
              max={90}
              inputMode="numeric"
              value={shown}
              onChange={(e) => setValue(e.target.value)}
              className="max-w-32"
            />
          </Field>
          <Field
            label={t('legalHold.settings.noticeLabel')}
            htmlFor="pr-hold-notice"
            hint={t('legalHold.settings.noticeHint')}
          >
            <Textarea
              id="pr-hold-notice"
              rows={4}
              maxLength={1500}
              placeholder={t('legalHold.requesterResponse')}
              value={shownNotice}
              onChange={(e) => setNotice(e.target.value)}
            />
          </Field>
          {save.isError && (
            <Alert tone="danger" role="alert">
              {t(`errors.${errorKey(save.error)}`)}
            </Alert>
          )}
          <Button
            size="sm"
            disabled={!valid || save.isPending || (n === q.data.slaDays && !noticeChanged)}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Spinner />}
            {t('common.save')}
          </Button>
        </>
      )}
    </section>
  );
}
