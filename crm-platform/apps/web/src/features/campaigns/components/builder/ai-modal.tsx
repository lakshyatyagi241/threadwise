'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea } from '@crm/ui';
import {
  CAMPAIGN_AI_IMAGE_SIZES,
  type CampaignAiGenerateResponse,
  type MarketingMedia,
} from '@crm/contracts';
import { aiErrorKind } from '@/lib/api/ai-error';
import { aiGenerateCampaign, aiImageCampaign, useAiModels } from '../../api/campaigns';
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
/** The picture's shapes, in the order the select lists them: each is a key under `ai.sizes` and one of the contract's sizes. */
const SIZE_KEYS = {
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
} as const satisfies Record<string, (typeof CAMPAIGN_AI_IMAGE_SIZES)[number]>;
type SizeKey = keyof typeof SIZE_KEYS;
const SIZE_IDS = Object.keys(SIZE_KEYS) as SizeKey[];
/** The only vendor that draws pictures (the contract's `provider`). */
const IMAGE_PROVIDER = 'openai';
const IMAGE_PROMPT_MAX = 1000;
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
 * "Build with AI" (TW-CAMP-002): a brief in a dialog, the campaign's copy out. The model list is the workspace's (the platform's
 * enabled providers plus any it added its own key for). The answer goes to the builder's fields; nothing is saved here.
 *
 * "Also create a picture" (an addition to Reference) asks for one image from the same brief once the text is in, and hands it to
 * `onImage` to attach as the campaign's image. The text is applied first and stays whatever happens to the picture: a picture that
 * fails is reported on its own line and can be retried without writing the text again.
 */
export function AiModal({
  open,
  onClose,
  onApply,
  onImage,
  canAttach = true,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (copy: CampaignAiGenerateResponse['campaign']) => void;
  /** The picture, to attach as the campaign's image. */
  onImage?: (image: MarketingMedia) => void;
  /** False when the sender cannot carry an image (SMS, email): the picture option is off. */
  canAttach?: boolean;
}) {
  const t = useTranslations('campaigns.builder.ai');
  const models = useAiModels(open);
  // Only the vendors Reference's campaign builder offered can write campaigns.
  const options = (models.data ?? []).filter((m) => isProvider(m.provider));
  const [brief, setBrief] = useState<Brief>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picture, setPicture] = useState(false);
  const [size, setSize] = useState<SizeKey>('square');
  // The text is in the builder already; only the picture is left to do (it failed, and can be asked for again).
  const [textApplied, setTextApplied] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const set = (p: Partial<Brief>) => setBrief((b) => ({ ...b, ...p }));
  const chosen = options.find((m) => `${m.provider}:${m.value}` === brief.model);
  const ready = chosen !== undefined && brief.businessName.trim() !== '';
  const canDraw = chosen?.provider === IMAGE_PROVIDER && canAttach && onImage !== undefined;
  const wantPicture = picture && canDraw;
  const close = () => {
    setTextApplied(false);
    setPictureError(null);
    setError(null);
    onClose();
  };

  const drawPicture = async (): Promise<boolean> => {
    setPictureError(null);
    try {
      const res = await aiImageCampaign({
        provider: IMAGE_PROVIDER,
        businessName: brief.businessName,
        product: brief.product || undefined,
        offer: brief.offer || undefined,
        tone: brief.tone ? t(`tones.${brief.tone}`) : undefined,
        customPrompt: brief.customPrompt.slice(0, IMAGE_PROMPT_MAX) || undefined,
        size: SIZE_KEYS[size],
      });
      onImage?.(res.image);
      return true;
    } catch (e) {
      setPictureError(t(`picture.errors.${aiErrorKind(e)}`));
      return false;
    }
  };

  const generate = async () => {
    if (!chosen || !isProvider(chosen.provider)) return;
    setBusy(true);
    setError(null);
    try {
      if (!textApplied) {
        let res: Awaited<ReturnType<typeof aiGenerateCampaign>>;
        try {
          res = await aiGenerateCampaign({
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
        } catch (e) {
          const kind = aiErrorKind(e);
          setError(t(`errors.${kind === 'imageRefused' ? 'failed' : kind}`));
          return;
        }
        onApply(res.campaign);
        setTextApplied(true);
      }
      if (wantPicture && !(await drawPicture())) return;
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      eyebrow={t('eyebrow')}
      title={
        <span>
          {t('title')} <span className="not-italic text-brand">{t('titleAccent')}</span>
        </span>
      }
      closeLabel={t('close')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close}>
            {textApplied ? t('close') : t('cancel')}
          </Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void generate()}>
            {busy ? <Spinner /> : <SparkIcon className="size-3.5" />}
            {textApplied ? t('picture.retry') : t('generate')}
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
      {textApplied && pictureError && (
        <div className="mb-3 space-y-2">
          <Alert tone="success">{t('picture.textKept')}</Alert>
          <Alert tone="danger">{pictureError}</Alert>
        </div>
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
        {onImage && (
          <div className="rounded-xl border border-border p-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-[13px] font-medium" htmlFor="ai-picture">
              <input
                id="ai-picture"
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={wantPicture}
                disabled={!canDraw || busy || textApplied}
                onChange={(e) => setPicture(e.target.checked)}
              />
              {t('picture.label')}
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {!canAttach
                ? t('picture.noAttachment')
                : !canDraw
                  ? t('picture.needsOpenAi')
                  : t('picture.hint')}
            </p>
            {wantPicture && (
              <div className="mt-2 max-w-xs">
                <Field label={t('picture.size')} htmlFor="ai-picture-size">
                  <Select
                    id="ai-picture-size"
                    value={size}
                    disabled={busy || textApplied}
                    onChange={(e) => setSize(e.target.value as SizeKey)}
                  >
                    {SIZE_IDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`picture.sizes.${k}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
