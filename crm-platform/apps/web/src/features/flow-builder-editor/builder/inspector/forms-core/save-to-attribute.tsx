'use client';

import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { useTranslations } from 'next-intl';
import { flbCleanVarName } from '@crm/contracts';
import { Check, controlClass, Field, TextInput } from '../kit';
import type { FormProps } from '../types';

/**
 * "Save the selected option as variable" for a List or Quick replies. Reference kept the choice in a run variable (default `choice`)
 * with no field to name it; the name is now editable, with the `{{name}}` it is read back as.
 */
export function ChoiceVariableField({ data: d, set }: Pick<FormProps, 'data' | 'set'>) {
  const t = useTranslations('flb.builder.choiceSave');
  return (
    <Field
      label={t('variableLabel')}
      hint={t('variableHint', { variable: `{{${flbCleanVarName(d.var, 'choice')}}}` })}
    >
      <TextInput value={d.var} placeholder="choice" noAttr onChange={(v) => set('var', v)} />
    </Field>
  );
}

/**
 * "Also save to a contact attribute": a checkbox and, once on, the workspace's custom contact properties. The flow engine writes
 * the picked option's title (List, Quick replies) or the typed answer (Ask question) to the contact when the customer replies.
 * Turning it on without choosing a property is flagged here and in the Simple builder's publish check.
 */
export function SaveToAttributeField({
  data: d,
  set,
  noun,
}: Pick<FormProps, 'data' | 'set'> & { noun: 'choice' | 'answer' }) {
  const t = useTranslations('flb.builder.choiceSave');
  const feed = usePickerFeed();
  const on = d.saveProperty === true;
  const key = typeof d.propertyKey === 'string' ? d.propertyKey : '';
  return (
    <Field hint={on ? t(`${noun}PropertyHint`) : t(`${noun}SaveHelp`)}>
      <Check checked={on} onChange={(x) => set('saveProperty', x)}>
        {t('saveToAttribute')}
      </Check>
      {on ? (
        <>
          <select
            aria-label={t('propertyLabel')}
            aria-invalid={key === ''}
            value={key}
            onChange={(e) => set('propertyKey', e.target.value)}
            className={`${controlClass} mt-2`}
          >
            <option value="">{t('propertyChoose')}</option>
            {(feed.data?.custom ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          {key === '' ? (
            <div role="alert" className="mt-1 text-[10.5px] font-semibold text-[#E87A5D]">
              {t('propertyRequired')}
            </div>
          ) : null}
        </>
      ) : null}
    </Field>
  );
}
