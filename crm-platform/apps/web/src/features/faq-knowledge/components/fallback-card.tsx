'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FAQ_LIMITS, type FaqSettings } from '@crm/contracts';
import { Button, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS } from '../api/hooks';
import { faqApi } from '../api/service';
import { errorKey } from '../lib/errors';
import { fallbackInput } from '../lib/settings-model';
import { useFaqFlow } from './faq-flow';
import { CARD } from './parts';

/**
 * What the bot says when no FAQ answers a customer's message. Saved with the flow's other FAQ settings (same row), kept exactly as
 * typed. The message still lands on this screen, so the team can teach the FAQ the answer.
 */
export function FallbackCard({ settings }: { settings: FaqSettings | undefined }) {
  const t = useTranslations('faq.unanswered.fallback');
  const te = useTranslations('faq.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { flowId } = useFaqFlow();
  const canManage = useCan('faq.settings.manage');
  const saved = settings?.fallbackMessage ?? '';
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);

  const save = useMutation({
    mutationFn: (message: string) => faqApi.saveSettings(flowId, fallbackInput(settings!, message)),
    onSuccess: (next) => {
      qc.setQueryData(KEYS.settings(flowId), next);
      toast(t('saved'));
    },
    onError: (e) => toast(te(errorKey(e)), 'danger'),
  });

  if (!settings) return null;
  const dirty = text !== saved;
  return (
    <div className={`${CARD} space-y-2 p-4`} data-testid="faq-fallback">
      <label htmlFor="faq-fallback-text" className="block text-sm font-semibold">
        {t('title')}
      </label>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <textarea
        id="faq-fallback-text"
        value={text}
        rows={2}
        maxLength={FAQ_LIMITS.fallbackMessage}
        disabled={!canManage}
        placeholder={t('placeholder')}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
      />
      {canManage ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {text.length}/{FAQ_LIMITS.fallbackMessage}
          </span>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(text)}>
            {t('save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
