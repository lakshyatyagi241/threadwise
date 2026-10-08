'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea } from '@crm/ui';
import type { CampaignAiGenerateResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { aiGenerateCampaign, useAiModels } from '../../api/campaigns';
import { SparkIcon } from './parts';

const GOALS = [
  'purchase',
  'booking',
  'sale',
  'reengage',
  'feedback',
  'launch',
  'reminder',
  'festival',
] as const;
const TONES = ['friendly', 'professional', 'urgent', 'playful', 'premium', 'empathetic'] as const;
const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
type Provider = (typeof PROVIDERS)[number];
const isProvider = (v: string): v is Provider => (PROVIDERS as readonly string[]).includes(v);

interface Brief {
  model: string;
  businessName: string;
  product: string;
  goal: string;
  tone: string;
  ctaLabel: string;
  ctaUrl: string;
  audience: string;
  offer: string;
  customPrompt: string;
}
const EMPTY: Brief = {
  model: '',
  businessName: '',
  product: '',
  goal: '',
  tone: '',
  ctaLabel: '',
  ctaUrl: '',
  audience: '',
  offer: '',
  customPrompt: '',
};

/**
 * "Build with AI" (WD-CAMP-002): a brief in a dialog, the campaign's copy out. The model list is the workspace's (the platform's
 * enabled providers plus any it added its own key for). The answer goes to the builder's fields; nothing is saved here.
 */
export function AiModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (copy: CampaignAiGenerateResponse['campaign']) => void;
}) {
  const t = useTranslations('campaigns.builder.ai');
  const models = useAiModels(open);
  // Only the vendors WaDesk's campaign builder offered can write campaigns.
  const options = (models.data ?? []).filter((m) => isProvider(m.provider));
  const [brief, setBrief] = useState<Brief>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Brief>) => setBrief((b) => ({ ...b, ...p }));
  const chosen = options.find((m) => `${m.provider}:${m.value}` === brief.model);
  const ready = chosen !== undefined && brief.businessName.trim() !== '';

  const generate = async () => {
    if (!chosen || !isProvider(chosen.provider)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await aiGenerateCampaign({
        model: chosen.value,
        provider: chosen.provider,
        businessName: brief.businessName,
        product: brief.product || undefined,
        goal: brief.goal ? t(`goals.${brief.goal}`) : undefined,
        tone: brief.tone ? t(`tones.${brief.tone}`) : undefined,
        ctaLabel: brief.ctaLabel || undefined,
        ctaUrl: brief.ctaUrl || undefined,
        audience: brief.audience || undefined,
        offer: brief.offer || undefined,
        customPrompt: brief.customPrompt || undefined,
      });
      onApply(res.campaign);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      eyebrow={t('eyebrow')}
      title={
        <span>
          {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
        </span>
      }
      closeLabel={t('close')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void generate()}>
            {busy ? <Spinner /> : <SparkIcon className="size-3.5" />}
            {t('generate')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12px] text-muted-foreground">{t('intro')}</p>
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label={`${t('model')} *`}
            htmlFor="ai-model"
            hint={
              models.isError
                ? t('modelsError')
                : options.length === 0 && !models.isLoading
                  ? t('noModels')
                  : undefined
            }
          >
            <Select
              id="ai-model"
              value={brief.model}
              disabled={models.isLoading || options.length === 0}
              onChange={(e) => set({ model: e.target.value })}
            >
              <option value="">{models.isLoading ? t('loadingModels') : t('pickModel')}</option>
              {options.map((m) => (
                <option key={`${m.provider}:${m.value}`} value={`${m.provider}:${m.value}`}>
                  {m.providerName} · {m.value}
                  {m.source === 'workspace' ? ` (${t('yourKey')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={`${t('business')} *`} htmlFor="ai-business">
          <Input
            id="ai-business"
            maxLength={191}
            value={brief.businessName}
            onChange={(e) => set({ businessName: e.target.value })}
            placeholder={t('businessPlaceholder')}
          />
        </Field>
        <Field label={t('product')} htmlFor="ai-product">
          <Input
            id="ai-product"
            maxLength={255}
            value={brief.product}
            onChange={(e) => set({ product: e.target.value })}
            placeholder={t('productPlaceholder')}
          />
        </Field>
        <Field label={t('goal')} htmlFor="ai-goal">
          <Select id="ai-goal" value={brief.goal} onChange={(e) => set({ goal: e.target.value })}>
            <option value="">{t('pickGoal')}</option>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {t(`goals.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('tone')} htmlFor="ai-tone">
          <Select id="ai-tone" value={brief.tone} onChange={(e) => set({ tone: e.target.value })}>
            <option value="">{t('pickTone')}</option>
            {TONES.map((x) => (
              <option key={x} value={x}>
                {t(`tones.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ctaLabel')} htmlFor="ai-cta-label">
          <Input
            id="ai-cta-label"
            maxLength={60}
            value={brief.ctaLabel}
            onChange={(e) => set({ ctaLabel: e.target.value })}
            placeholder={t('ctaLabelPlaceholder')}
          />
        </Field>
        <Field label={t('ctaUrl')} htmlFor="ai-cta-url">
          <Input
            id="ai-cta-url"
            maxLength={1024}
            value={brief.ctaUrl}
            onChange={(e) => set({ ctaUrl: e.target.value })}
            placeholder="https://yourbrand.com/spring"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('audience')} htmlFor="ai-audience">
            <Input
              id="ai-audience"
              maxLength={500}
              value={brief.audience}
              onChange={(e) => set({ audience: e.target.value })}
              placeholder={t('audiencePlaceholder')}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('offer')} htmlFor="ai-offer">
            <Input
              id="ai-offer"
              maxLength={500}
              value={brief.offer}
              onChange={(e) => set({ offer: e.target.value })}
              placeholder={t('offerPlaceholder')}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t('notes')} htmlFor="ai-notes" hint={t('notesNote')}>
            <Textarea
              id="ai-notes"
              rows={3}
              maxLength={2000}
              value={brief.customPrompt}
              onChange={(e) => set({ customPrompt: e.target.value })}
              placeholder={t('notesPlaceholder')}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
