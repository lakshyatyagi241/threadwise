'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Field, Input } from '@crm/ui';
import { tokensOf, type SlotInputs } from '../lib/variables';

/**
 * WD-TPL-014: one row per distinct `{{token}}` in the header and body. The operator names the contact attribute that fills
 * the slot at send time (default: the token itself) and gives the sample value Meta's review needs.
 */
export function VariablesPanel({
  headerText,
  headerSlots,
  body,
  bodySlots,
  onHeader,
  onBody,
}: {
  headerText: string;
  headerSlots: SlotInputs;
  body: string;
  bodySlots: SlotInputs;
  onHeader: (s: SlotInputs) => void;
  onBody: (s: SlotInputs) => void;
}) {
  const t = useTranslations('message-templates.form.variables');
  const base = useId();
  const headerTokens = tokensOf(headerText);
  const bodyTokens = tokensOf(body);

  const rows = (
    scope: 'header' | 'body',
    tokens: string[],
    slots: SlotInputs,
    set: (s: SlotInputs) => void,
  ) =>
    tokens.map((tok) => {
      const slot = slots[tok] ?? { key: tok, example: '' };
      const id = `${base}-${scope}-${tok}`;
      const put = (p: Partial<typeof slot>) => set({ ...slots, [tok]: { ...slot, ...p } });
      return (
        <li
          key={`${scope}-${tok}`}
          className="grid items-end gap-3 sm:grid-cols-[auto_1fr_1fr]"
          data-testid="variable-row"
        >
          <span className="rounded bg-success/15 px-2 py-1 font-mono text-xs font-medium text-success sm:mb-2">
            {`{{${tok}}}`}
            <span className="ms-1 font-sans text-[10px] text-muted-foreground">{t(scope)}</span>
          </span>
          <Field label={t('attribute')} htmlFor={`${id}-key`}>
            <Input
              id={`${id}-key`}
              dir="ltr"
              value={slot.key}
              maxLength={100}
              onChange={(e) => put({ key: e.target.value })}
            />
          </Field>
          <Field label={t('sample')} htmlFor={`${id}-ex`}>
            <Input
              id={`${id}-ex`}
              value={slot.example}
              maxLength={200}
              onChange={(e) => put({ example: e.target.value })}
            />
          </Field>
        </li>
      );
    });

  if (headerTokens.length === 0 && bodyTokens.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('help')}</p>
      <ul className="space-y-3">
        {rows('header', headerTokens, headerSlots, onHeader)}
        {rows('body', bodyTokens, bodySlots, onBody)}
      </ul>
    </div>
  );
}
