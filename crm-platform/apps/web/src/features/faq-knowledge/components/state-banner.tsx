'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useFaqSettings } from '../api/hooks';
import { faqApi } from '../api/service';
import { useFaqFlow } from './faq-flow';
import { errorKey } from '../lib/errors';
import { formFromSettings, toSettingsInput } from '../lib/settings-model';

/**
 * Says, on every FAQ screen, whether customers get FAQ answers at all: the workspace switch (off by default) and the platform
 * switch above it. Without this the most common "why does nothing happen" would need a trip to Settings to discover.
 */
export function StateBanner() {
  const t = useTranslations('faq.banner');
  const te = useTranslations('faq.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { flowId, href } = useFaqFlow();
  const canRead = useCan('faq.entries.read');
  const canManage = useCan('faq.settings.manage');
  const settings = useFaqSettings(canRead);
  const enable = useMutation({
    mutationFn: () => {
      const s = settings.data!;
      return faqApi.saveSettings(
        flowId,
        toSettingsInput({ ...formFromSettings(s), enabled: true }, s),
      );
    },
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings(flowId), saved);
      toast(t('enabledToast'));
    },
    onError: (e) => toast(te(errorKey(e)), 'danger'),
  });

  const s = settings.data;
  if (!s) return null;
  if (!s.engineEnabled) return <Alert tone="danger">{t('engineOff')}</Alert>;
  const changed = s.modelChanged && (
    <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
      <span>{t('modelChanged')}</span>
      <Link
        href={href('settings')}
        className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('reviewSensitivity')}
      </Link>
    </Alert>
  );
  if (s.enabled) return changed || null;
  return (
    <div className="space-y-3">
      <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t('offTitle')}</p>
          <p className="mt-0.5">{canManage ? t('offBody') : t('offNoRight')}</p>
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => enable.mutate()}
            disabled={enable.isPending}
          >
            {enable.isPending && <Spinner />}
            {t('enable')}
          </Button>
        )}
      </Alert>
      {changed}
    </div>
  );
}
