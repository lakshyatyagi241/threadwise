'use client';

import { useTranslations } from 'next-intl';
import type { FormComponent } from '../types';
import { Intro } from './shared';

const NS = 'flb.builder.formsChannels.faq';

/**
 * "Answer from FAQ" is retired: FAQs are now entries in an AI agent's knowledge base. A flow that still holds the step keeps
 * working (the step always leaves by "no match"), so this form only says so and points to the AI step. No settings are kept.
 */
function Body() {
  const t = useTranslations(NS);
  return <Intro>{t('retired')}</Intro>;
}

export const FaqForm: FormComponent = () => <Body />;
