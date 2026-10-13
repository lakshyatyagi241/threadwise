'use client';

import type { Ref } from 'react';
import { useTranslations } from 'next-intl';
import type { MarketError } from '../lib/errors';
import { useErrorText } from './ui';

const NS = 'marketplace.operator.summary';

/**
 * What a failed save says, in one place that takes focus (so a screen reader reads it and a keyboard user is next to the links):
 * the API's sentence with its request id, and how many problems sit in each editor and in the listing fields, each a link to it.
 * Renders nothing until there is something to say.
 */
export function ErrorSummary({
  innerRef,
  idPrefix,
  general,
  manifestCount,
  recipeCount,
  fieldCount,
  attempted,
}: {
  innerRef: Ref<HTMLDivElement>;
  idPrefix: string;
  /** The API's failure, when the save was sent and refused. */
  general: MarketError | null;
  manifestCount: number;
  recipeCount: number;
  fieldCount: number;
  /** A save was tried: the counts are shown even though nothing was sent. */
  attempted: boolean;
}) {
  const t = useTranslations(NS);
  const errorText = useErrorText();
  const total = manifestCount + recipeCount + fieldCount;
  if (!general && !(attempted && total > 0)) return null;
  const sentence = general ? errorText(general) : null;
  return (
    <div
      ref={innerRef}
      tabIndex={-1}
      role="alert"
      aria-labelledby={`${idPrefix}-summary-title`}
      className="space-y-2 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
    >
      <h2 id={`${idPrefix}-summary-title`} className="font-semibold">
        {general ? t('sentTitle') : t('title')}
      </h2>
      {sentence && <p>{sentence.text}</p>}
      {total > 0 && (
        <ul className="list-disc ps-5">
          {manifestCount > 0 && (
            <li>
              <a className="underline" href={`#${idPrefix}-manifest`}>
                {t('manifest', { count: manifestCount })}
              </a>
            </li>
          )}
          {recipeCount > 0 && (
            <li>
              <a className="underline" href={`#${idPrefix}-recipe`}>
                {t('recipe', { count: recipeCount })}
              </a>
            </li>
          )}
          {fieldCount > 0 && <li>{t('fields', { count: fieldCount })}</li>}
        </ul>
      )}
    </div>
  );
}
