'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { faqHref } from '@/features/faq-knowledge/lib/links';
import { useFaqSummary } from '../../../api/hooks';
import {
  FAQ_DEFAULT_QUERY,
  FAQ_MIN_SCORE,
  FAQ_MIN_SCORE_START,
  FAQ_VARIABLES,
  faqSaveName,
  hasOwnMinScore,
  minScoreOutOfRange,
} from '../../../lib/faq-node';
import { Check, Field, Notice, NumberInput, SelectInput, TextInput } from '../kit';
import type { FormComponent, FormProps } from '../types';
import { withSavedOption } from './helpers';
import { ExtLink, Intro, Mono } from './shared';

const NS = 'flb.builder.formsChannels.faq';

/**
 * "Answer from FAQ": matches a message against THIS flow's FAQs by meaning (ADR-0021). The FAQs are edited in the flow's Simple
 * builder, on its FAQs tab; this form only links there. Leaves by `matched` when an FAQ answered
 * and by `no_match` otherwise (nothing close, the FAQ engine off, a linked flow or step gone, an empty message). The result is saved
 * as `<save>.answer`, `.question`, `.score`, `.id` and `.matched`.
 */
function Body(p: FormProps) {
  const t = useTranslations(NS);
  const { data: d, set } = p;
  const flowId = p.env.flowId;
  const summary = useFaqSummary(flowId);
  // Links into the flow's FAQs tab. A flow that has not been saved has none yet: the text stays, without the link.
  const faqLink = (view?: 'new' | 'test') =>
    function FaqLink(c: ReactNode) {
      return flowId ? <ExtLink href={faqHref(flowId, view)}>{c}</ExtLink> : <>{c}</>;
    };
  const categories = summary.data?.categories ?? [];
  const category = String(d.category ?? '');
  const own = hasOwnMinScore(d.minScore);
  const outOfRange = minScoreOutOfRange(d.minScore);
  const sendAnswer = d.sendAnswer !== false;
  const save = faqSaveName(d.save);

  const categoryOptions = withSavedOption(
    [
      {
        v: '',
        l: summary.isPending ? t('loadingCategories') : t('allFaqs'),
      },
      ...categories.map((c) => ({ v: c, l: c })),
    ],
    category,
    (c) => (summary.isPending ? c : t('categoryGone', { name: c })),
  );

  return (
    <>
      <Intro
        sub={t.rich('intro.sub', {
          link: faqLink(),
        })}
      >
        {t.rich('intro.body', { mono: (c) => <Mono>{c}</Mono> })}
      </Intro>

      <ul className="mb-4 space-y-1.5 text-[11.5px]" aria-label={t('exitsLabel')}>
        <li className="flex items-start gap-2">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <span>
            <b>{t('exitMatchedName')}</b> {t('exitMatched')}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
          <span>
            <b>{t('exitNoMatchName')}</b> {t('exitNoMatch')}
          </span>
        </li>
      </ul>

      {flowId === null ? (
        <Notice tone="info">{t('saveFlowFirst')}</Notice>
      ) : summary.isSuccess && summary.data.total === 0 ? (
        <Notice tone="info">{t.rich('noFaqs', { link: faqLink('new') })}</Notice>
      ) : null}

      <Field
        label={t('query')}
        hint={t.rich('queryHint', {
          mono: (c) => <Mono>{c}</Mono>,
          variable: '{{answer}}',
        })}
      >
        <TextInput
          value={d.query}
          mono
          placeholder={FAQ_DEFAULT_QUERY}
          onChange={(v) => set('query', v)}
        />
      </Field>

      <Field
        label={t('category')}
        hint={
          <>
            {summary.isError ? <>{t('categoriesFailed')} </> : null}
            {t('categoryHint')}
            {summary.isError ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => void summary.refetch()}
                  className="text-brand underline"
                >
                  {t('retry')}
                </button>
              </>
            ) : null}
          </>
        }
      >
        <SelectInput
          value={category}
          options={categoryOptions}
          onChange={(v) => set('category', v)}
        />
      </Field>

      <Field
        label={t('minScore')}
        hint={t.rich('minScoreHint', {
          min: FAQ_MIN_SCORE.min,
          max: FAQ_MIN_SCORE.max,
          link: faqLink('test'),
        })}
      >
        <Check
          checked={!own}
          onChange={(useWorkspace) => set('minScore', useWorkspace ? null : FAQ_MIN_SCORE_START)}
        >
          {t('useWorkspaceScore')}
        </Check>
        {own ? (
          <div className="mt-2">
            <NumberInput
              value={d.minScore}
              min={FAQ_MIN_SCORE.min}
              max={FAQ_MIN_SCORE.max}
              step={0.01}
              placeholder={String(FAQ_MIN_SCORE_START)}
              aria-invalid={outOfRange}
              onChange={(v) => set('minScore', Number.isNaN(v) ? '' : v)}
            />
            {outOfRange ? (
              <div role="alert" className="mt-1.5 text-[10.5px] leading-snug text-red-700">
                {t('minScoreInvalid', { min: FAQ_MIN_SCORE.min, max: FAQ_MIN_SCORE.max })}
              </div>
            ) : null}
          </div>
        ) : null}
      </Field>

      <Field
        label={t('sendAnswer')}
        hint={sendAnswer ? t('sendAnswerOnHint') : t('sendAnswerOffHint')}
      >
        <Check checked={sendAnswer} onChange={(v) => set('sendAnswer', v)}>
          {t('sendAnswerToggle')}
        </Check>
      </Field>

      <Field label={t('save')} hint={t('saveHint')}>
        <TextInput value={d.save} mono placeholder="faq" onChange={(v) => set('save', v)} />
        <ul className="mt-2 space-y-1 text-[10.5px] text-muted-foreground">
          {FAQ_VARIABLES.map((name) => (
            <li key={name}>
              <Mono>{`{{${save}.${name}}}`}</Mono> {t(`variables.${name}`)}
            </li>
          ))}
        </ul>
      </Field>
    </>
  );
}

export const FaqForm: FormComponent = (p) => <Body {...p} />;
