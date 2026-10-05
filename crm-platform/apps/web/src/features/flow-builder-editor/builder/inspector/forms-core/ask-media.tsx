'use client';

import { useTranslations } from 'next-intl';
import { flbCleanAskFileExtensions, flbCleanVarName } from '@crm/contracts';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { ExtensionChecklist } from '../../ask-media/extension-panel';
import { Check, controlClass, Field, NumberInput, SelectInput, TextArea, TextInput } from '../kit';
import type { FormProps } from '../types';

/**
 * The inspector forms of the Ask for file / image and Ask for location nodes (TW-FLB-081, 082: an addition beyond Reference).
 * The retry, wrong-reply, skip, give-up and wait-limit fields are the same on both and live in `WaitSettings`.
 */

/** A variable name as the runtime will use it, for the hint under the field. */
const varName = (v: unknown, fallback: string) => flbCleanVarName(v, fallback);

function WaitSettings({
  d,
  set,
  t,
}: {
  d: FormProps['data'];
  set: FormProps['set'];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      <Field label={t('retriesLabel')} hint={t('retriesHint')}>
        <NumberInput
          value={d.retries}
          min={0}
          max={10}
          onChange={(v) =>
            set('retries', Number.isNaN(v) ? 0 : Math.min(10, Math.max(0, Math.trunc(v))))
          }
        />
      </Field>
      <Field label={t('wrongReplyLabel')} hint={t('wrongReplyHint')}>
        <TextArea value={d.wrongReply} rows={3} onChange={(v) => set('wrongReply', v)} />
      </Field>
      <Field label={t('skipLabel')} hint={t('skipHint')}>
        <TextInput
          value={d.skipKeyword}
          placeholder="skip"
          onChange={(v) => set('skipKeyword', v)}
        />
      </Field>
      <Field label={t('onFailLabel')}>
        <SelectInput
          value={d.onFail === 'end' ? 'end' : 'continue'}
          options={[
            { v: 'continue', l: t('onFailContinue') },
            { v: 'end', l: t('onFailEnd') },
          ]}
          onChange={(v) => set('onFail', v)}
        />
      </Field>
      <Field label={t('timeoutLabel')} hint={t('timeoutHint')}>
        <NumberInput
          value={d.timeoutMinutes}
          min={0}
          onChange={(v) => set('timeoutMinutes', Number.isNaN(v) ? 0 : Math.max(0, Math.trunc(v)))}
        />
      </Field>
    </>
  );
}

export function AskFileForm({ node, data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.askMedia.file');
  const te = useTranslations('flb.builder.askMedia.extensions');
  const feed = usePickerFeed();
  const properties = feed.data?.custom ?? [];
  const v = varName(d.var, 'file');
  return (
    <>
      <Field label={t('promptLabel')}>
        <TextArea
          value={d.prompt}
          rows={3}
          placeholder={t('promptPlaceholder')}
          onChange={(x) => set('prompt', x)}
        />
      </Field>
      <Field label={t('allowExtensions')} hint={te('empty')}>
        <div className="rounded-lg border border-border bg-background p-3">
          <ExtensionChecklist
            idPrefix={`form-${node.id}`}
            value={flbCleanAskFileExtensions(d.extensions)}
            onChange={(next) => set('extensions', next)}
          />
        </div>
      </Field>
      <Field
        label={t('variableLabel')}
        hint={t('variableHint', {
          file: `{{${v}}}`,
          kind: `{{${v}_kind}}`,
          name: `{{${v}_name}}`,
          mime: `{{${v}_mime}}`,
          caption: `{{${v}_caption}}`,
          status: `{{${v}_status}}`,
        })}
      >
        <TextInput value={d.var} placeholder="file" noAttr onChange={(x) => set('var', x)} />
      </Field>
      <Field hint={d.saveProperty === true ? t('propertyHint') : t('saveAsPropertyHelp')}>
        <Check checked={d.saveProperty === true} onChange={(x) => set('saveProperty', x)}>
          {t('saveAsProperty')}
        </Check>
        {d.saveProperty === true ? (
          <select
            aria-label={t('propertyLabel')}
            value={typeof d.propertyKey === 'string' ? d.propertyKey : ''}
            onChange={(e) => set('propertyKey', e.target.value)}
            className={`${controlClass} mt-2`}
          >
            <option value="">{t('propertyChoose')}</option>
            {properties.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </Field>
      <WaitSettings d={d} set={set} t={t} />
      <div className="text-[10.5px] leading-snug text-muted-foreground">{t('outputHint')}</div>
    </>
  );
}

export function AskLocationForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.askMedia.location');
  const v = varName(d.var, 'location');
  return (
    <>
      <Field label={t('promptLabel')}>
        <TextArea
          value={d.prompt}
          rows={3}
          placeholder={t('promptPlaceholder')}
          onChange={(x) => set('prompt', x)}
        />
      </Field>
      <Field hint={t('interactiveHint')}>
        <Check checked={d.interactive !== false} onChange={(x) => set('interactive', x)}>
          {t('interactiveLabel')}
        </Check>
      </Field>
      <Field
        label={t('variableLabel')}
        hint={t('variableHint', {
          loc: `{{${v}}}`,
          latitude: `{{${v}_latitude}}`,
          longitude: `{{${v}_longitude}}`,
          name: `{{${v}_name}}`,
          address: `{{${v}_address}}`,
          link: `{{${v}_link}}`,
          status: `{{${v}_status}}`,
        })}
      >
        <TextInput value={d.var} placeholder="location" noAttr onChange={(x) => set('var', x)} />
      </Field>
      <WaitSettings d={d} set={set} t={t} />
      <div className="text-[10.5px] leading-snug text-muted-foreground">{t('outputHint')}</div>
    </>
  );
}
