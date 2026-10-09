'use client';

import { useTranslations } from 'next-intl';
import { Check, Field, KnowledgeBaseActions, NumberInput } from '../kit';
import type { FormComponent } from '../types';
import {
  AddLink,
  RemoveButton,
  RowInput,
  Sel,
  Ta,
  Txt,
  aiModelOptions,
  knowledgeBaseOptions,
  readRows,
  voiceAssistantOptions,
} from './shared';

const NS = 'flb.builder.formsChannels.call';
const SHARED = 'flb.builder.formsChannels.shared';

export const CfSayForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <Field label={t('sayLabel')} hint={t('sayHint')}>
      {Ta(p, 'text', t('sayPlaceholder'), 3)}
    </Field>
  );
};

export const CfListenForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const save = String(p.data.save || 'caller_said');
  return (
    <>
      <Field label={t('listenSave')} hint={t('listenSaveHint', { token: `{{${save}}}` })}>
        {Txt(p, 'save', 'caller_said')}
      </Field>
      <Field label={t('silenceLabel')} hint={t('silenceHint')}>
        <NumberInput
          value={p.data.silenceTimeout ?? 6}
          min={1}
          max={30}
          onChange={(v) => p.set('silenceTimeout', Number.isNaN(v) || v === 0 ? 6 : Math.trunc(v))}
        />
      </Field>
    </>
  );
};

export const CfAiForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const ts = useTranslations(SHARED);
  return (
    <>
      <Field label={t('model')}>{Sel(p, 'model', aiModelOptions(p, ts))}</Field>
      <Field label={t('instructions')}>{Ta(p, 'prompt', t('aiPromptPlaceholder'), 4)}</Field>
      <Field label={t('knowledgeBase')} hint={t('knowledgeBaseHint')}>
        {Sel(p, 'assistant', knowledgeBaseOptions(p, ts))}
        <KnowledgeBaseActions refresh={() => p.env.refresh()} />
      </Field>
      <Field label={t('saveSpoken')}>{Txt(p, 'save', 'ai_reply')}</Field>
      <Check checked={!!p.data.endOnGoodbye} onChange={(v) => p.set('endOnGoodbye', v)}>
        {t('endOnGoodbye')}
      </Check>
    </>
  );
};

export const CfAssistantForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const ts = useTranslations(SHARED);
  return (
    <>
      <Field label={t('voiceAssistant')} hint={t('voiceAssistantHint')}>
        {Sel(p, 'assistant', voiceAssistantOptions(p, 'assistant', t('pickVoiceAssistant'), ts))}
      </Field>
      <Field label={t('extraInstructions')} hint={t('extraInstructionsHint')}>
        {Ta(p, 'prompt', '', 3)}
      </Field>
      <Field label={t('saveSpoken')}>{Txt(p, 'save', 'assistant_reply')}</Field>
      <Check checked={!!p.data.endOnGoodbye} onChange={(v) => p.set('endOnGoodbye', v)}>
        {t('endOnGoodbye')}
      </Check>
    </>
  );
};

export const CfMenuForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const opts = readRows(p.data.options);
  const setOpt = (i: number, k: string, val: string) =>
    p.set(
      'options',
      opts.map((o, j) => (j === i ? { ...o, [k]: val } : o)),
    );
  return (
    <>
      <Field label={t('routeBy')}>
        {Sel(p, 'mode', [
          { v: 'intent', l: t('routeIntent') },
          { v: 'keyword', l: t('routeKeyword') },
          { v: 'digit', l: t('routeDigit') },
        ])}
      </Field>
      <Field label={t('branches')} hint={t('branchesHint')}>
        {opts.map((o, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <RowInput
              value={o.match}
              onChange={(v) => setOpt(i, 'match', v)}
              placeholder={p.data.mode === 'digit' ? '1' : 'sales'}
              className="w-1/3"
            />
            <RowInput
              value={o.label}
              onChange={(v) => setOpt(i, 'label', v)}
              placeholder={t('branchLabel')}
              className="flex-1"
            />
            <RemoveButton
              onClick={() =>
                p.set(
                  'options',
                  opts.filter((_, j) => j !== i),
                )
              }
            />
          </div>
        ))}
        <AddLink onClick={() => p.set('options', opts.concat([{ match: '', label: '' }]))}>
          {t('addBranch')}
        </AddLink>
      </Field>
    </>
  );
};

export const CfSearchForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const save = String(p.data.save || 'search');
  return (
    <>
      <Field label={t('searchQuery')} hint={t('searchQueryHint')}>
        {Txt(p, 'query', '{{caller_said}}')}
      </Field>
      <Field label={t('saveResults')} hint={t('saveResultsHint', { token: `{{${save}}}` })}>
        {Txt(p, 'save', 'search')}
      </Field>
      <Field label={t('sayWhileSearching')} hint={t('sayWhileSearchingHint')}>
        {Txt(p, 'filler', t('fillerPlaceholder'))}
      </Field>
    </>
  );
};

export const CfTransferForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <>
      <Field label={t('transferTo')} hint={t('transferToHint')}>
        {Txt(p, 'number', '+1555…')}
      </Field>
      <Field label={t('sayBeforeTransfer')}>{Txt(p, 'message', t('transferPlaceholder'))}</Field>
    </>
  );
};

export const CfHangupForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <Field label={t('goodbye')} hint={t('goodbyeHint')}>
      {Txt(p, 'goodbye', t('goodbyePlaceholder'))}
    </Field>
  );
};
