'use client';

import { useTranslations } from 'next-intl';
import { Check, Field } from '../kit';
import type { FormComponent } from '../types';
import { Sel, Txt, knowledgeBaseOptions } from './shared';

const NS = 'flb.builder.formsChannels.faq';

/**
 * "Answer from FAQ": looks the customer's message up in an AI agent's knowledge base (FAQs are entries there). A match leaves by
 * "Answered" with the best entry in the step's variables, and sends it unless that is switched off; no match leaves by "No match".
 */
export const FaqForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const ts = useTranslations('flb.builder.formsChannels.shared');
  const { data, set } = p;
  return (
    <>
      <Field label={t('agent')} hint={t('agentHint')}>
        {Sel(p, 'assistant', knowledgeBaseOptions(p, ts))}
      </Field>
      <Field label={t('query')} hint={t('queryHint')}>
        {Txt(p, 'query', '{{user_message}}', true)}
      </Field>
      <Check checked={data.sendAnswer !== false} onChange={(v) => set('sendAnswer', v)}>
        {t('sendAnswer')}
      </Check>
      <Field label={t('variable')} hint={t('variableHint')}>
        {Txt(p, 'save', 'faq', true)}
      </Field>
    </>
  );
};
