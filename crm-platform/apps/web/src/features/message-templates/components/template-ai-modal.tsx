'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea } from '@crm/ui';
import type { TplAiDraft } from '@crm/contracts';
import { aiErrorKind } from '@/lib/api/ai-error';
import { useAiModels } from '../api/hooks';
import { aiApi } from '../api/service';
import {
  AI_ACTIONS,
  AI_INDUSTRIES,
  AI_OCCASIONS,
  AI_PURPOSES,
  AI_TONES,
  isAiProvider,
} from '../lib/ai-draft';
import { languageName } from '../lib/languages';
import { SparkIcon } from './icons';

interface Brief {
  model: string;
  businessName: string;
  industry: string;
  occasion: string;
  purpose: string;
  action: string;
  tone: string;
  customPrompt: string;
}
const EMPTY: Brief = {
  model: '',
  businessName: '',
  industry: '',
  occasion: '',
  purpose: '',
  action: '',
  tone: '',
  customPrompt: '',
};

/**
 * "Build with AI" for a WhatsApp template (TW-TPL-016): a brief in a dialog, a template draft out. The template form opens it in
 * place; the guided campaign wizard opens the same dialog and carries the draft to the new-template form. The language and category
 * are the caller's (read-only here). The model list is the workspace's (the platform's enabled providers plus any it added its own
 * key for). Nothing is saved here and nothing is submitted to Meta.
 */
export function TemplateAiModal({
  open,
  onClose,
  language,
  metaCategory,
  onDraft,
  note,
}: {
  open: boolean;
  onClose: () => void;
  /** A Meta language code such as `en_US`; the draft is written in it. */
  language: string;
  metaCategory: 'MARKETING' | 'UTILITY';
  onDraft: (draft: TplAiDraft) => void;
  /** An extra line under the intro (the wizard says the template still has to pass Meta's review). */
  note?: string | undefined;
}) {
  const t = useTranslations('message-templates.ai');
  const locale = useLocale();
  const models = useAiModels(open);
  const options = (models.data ?? []).filter((m) => isAiProvider(m.provider));
  const [brief, setBrief] = useState<Brief>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessMissing, setBusinessMissing] = useState(false);
  const set = (p: Partial<Brief>) => setBrief((b) => ({ ...b, ...p }));
  const chosen = options.find((m) => `${m.provider}:${m.value}` === brief.model);

  const generate = async () => {
    if (!chosen || !isAiProvider(chosen.provider)) return;
    if (brief.businessName.trim() === '') {
      setBusinessMissing(true);
      setError(t('errors.businessRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    setBusinessMissing(false);
    try {
      const res = await aiApi.generate({
        provider: chosen.provider,
        model: chosen.value,
        metaCategory,
        language,
        businessName: brief.businessName.trim(),
        industry: brief.industry ? t(`industries.${brief.industry}`) : undefined,
        occasion: brief.occasion ? t(`occasions.${brief.occasion}`) : undefined,
        purpose: brief.purpose ? t(`purposes.${brief.purpose}`) : undefined,
        action: brief.action ? t(`actions.${brief.action}`) : undefined,
        tone: brief.tone ? t(`tones.${brief.tone}`) : undefined,
        customPrompt: brief.customPrompt.trim() || undefined,
      });
      onDraft(res.template);
      onClose();
    } catch (e) {
      const kind = aiErrorKind(e);
      setError(t(`errors.${kind === 'imageRefused' ? 'failed' : kind}`));
    } finally {
      setBusy(false);
    }
  };

  const pick = (
    id: string,
    label: string,
    placeholder: string,
    value: string,
    ids: readonly string[],
    group: string,
    onChange: (v: string) => void,
  ) => (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {ids.map((x) => (
          <option key={x} value={x}>
            {t(`${group}.${x}`)}
          </option>
        ))}
      </Select>
    </Field>
  );

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
          <Button type="button" disabled={!chosen || busy} onClick={() => void generate()}>
            {busy ? <Spinner /> : <SparkIcon className="size-3.5" />}
            {t('generate')}
          </Button>
        </>
      }
    >
      <p className="mb-1 text-[12px] text-muted-foreground">{t('intro')}</p>
      {note && <p className="mb-3 text-[12px] text-muted-foreground">{note}</p>}
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label={`${t('model')} *`}
            htmlFor="tpl-ai-model"
            hint={
              models.isError
                ? t('modelsError')
                : options.length === 0 && !models.isLoading
                  ? t('noModels')
                  : undefined
            }
          >
            <Select
              id="tpl-ai-model"
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
        <div className="sm:col-span-2">
          <Field label={`${t('business')} *`} htmlFor="tpl-ai-business">
            <Input
              id="tpl-ai-business"
              maxLength={120}
              value={brief.businessName}
              invalid={businessMissing}
              onChange={(e) => set({ businessName: e.target.value })}
              placeholder={t('businessPlaceholder')}
            />
          </Field>
        </div>
        {pick(
          'tpl-ai-industry',
          t('industry'),
          t('pickIndustry'),
          brief.industry,
          AI_INDUSTRIES,
          'industries',
          (industry) => set({ industry }),
        )}
        {pick(
          'tpl-ai-occasion',
          t('occasion'),
          t('pickOccasion'),
          brief.occasion,
          AI_OCCASIONS,
          'occasions',
          (occasion) => set({ occasion }),
        )}
        {pick(
          'tpl-ai-purpose',
          t('purpose'),
          t('pickPurpose'),
          brief.purpose,
          AI_PURPOSES,
          'purposes',
          (purpose) => set({ purpose }),
        )}
        {pick(
          'tpl-ai-action',
          t('action'),
          t('pickAction'),
          brief.action,
          AI_ACTIONS,
          'actions',
          (action) => set({ action }),
        )}
        {pick('tpl-ai-tone', t('tone'), t('pickTone'), brief.tone, AI_TONES, 'tones', (tone) =>
          set({ tone }),
        )}
        <Field label={t('language')} htmlFor="tpl-ai-language" hint={t('languageHint')}>
          <Input
            id="tpl-ai-language"
            readOnly
            dir="ltr"
            value={`${languageName(language, locale)} (${language})`}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('notes')} htmlFor="tpl-ai-notes" hint={t('notesNote')}>
            <Textarea
              id="tpl-ai-notes"
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
