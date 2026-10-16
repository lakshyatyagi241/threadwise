'use client';

import { ButtonIcon } from '../../button-icon';
import { ButtonActionPicker } from '../../button-action-picker';
import { buttonActionOf, buttonActionPatch } from '../../../lib/button-actions';
import {
  FLB_ASK_INPUT_TYPES,
  FLB_DATE_FORMATS,
  flbCleanAskInputType,
  flbCleanDateFormat,
} from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { askInputLabel, askInputWrongText, dateFormatLabel } from '../../../lib/contract-text';
import { useFlb } from '../../../lib/msg';
import { cn } from '@crm/ui';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import {
  Check,
  controlClass,
  Field,
  IconButton,
  NumberInput,
  SelectInput,
  TextArea,
  TextInput,
  XIcon,
} from '../kit';
import type { FormProps } from '../types';
import {
  asArray,
  groupBySection,
  LIST_DESC_MAX,
  LIST_SECTION_MAX,
  LIST_TITLE_MAX,
  listItems,
  patchItem,
  type ListItem,
} from './helpers';
import { AddLink, OptionRow, V } from './parts';
import { ChoiceVariableField, SaveToAttributeField } from './save-to-attribute';
import { ButtonsPreview, ListPreview, PollPreview } from './previews';

/** Replaces option `i` of a string-options node. */
function setStringOption(options: unknown, i: number, value: string): string[] {
  return asArray(options).map((v, j) => (j === i ? value : String(v ?? '')));
}

export function ButtonsForm({
  node,
  data: d,
  set,
  setMany,
  env,
  addOption,
  removeOption,
}: FormProps) {
  const t = useTranslations('flb.builder.formsCore.options');
  return (
    <>
      <ButtonsPreview d={d} />
      <Field label={t('prompt')}>
        <TextArea value={d.prompt} rows={3} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field label={t('buttonsOptions')} hint={t('buttonsOptionsHint', { max: 3 })}>
        {asArray(d.options).map((o, i) => (
          <div key={`${node.id}-opt-${i}`}>
            <OptionRow
              index={i}
              value={o}
              onChange={(v) => set('options', setStringOption(d.options, i, v))}
              onRemove={() => removeOption(i)}
            />
            <div className="-mt-1 mb-2 ps-6">
              <ButtonIcon
                value={String(asArray(d.optionIcons)[i] ?? '')}
                onChange={(v) =>
                  set(
                    'optionIcons',
                    asArray(d.options).map((_, j) =>
                      j === i ? v : String(asArray(d.optionIcons)[j] ?? ''),
                    ),
                  )
                }
              />
            </div>
            <div className="mb-3 ps-6">
              <ButtonActionPicker
                value={buttonActionOf(d, i)}
                ctx={env.ctx}
                loading={env.loading}
                flowId={env.flowId}
                onChange={(next) => setMany(buttonActionPatch(d, i, next))}
              />
            </div>
          </div>
        ))}
        <AddLink onClick={addOption}>{t('addButton')}</AddLink>
      </Field>
      <ChoiceVariableField data={d} set={set} />
      <SaveToAttributeField data={d} set={set} noun="choice" />
    </>
  );
}

function Counter({ len, max }: { len: number; max: number }) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-[9.5px] tabular-nums',
        len > max ? 'font-bold text-[#E87A5D]' : 'text-muted-foreground',
      )}
    >
      {len}/{max}
    </span>
  );
}

const subInput = `${controlClass} !w-auto min-w-0 flex-1 !py-1.5 !text-[11.5px]`;

export function ListForm({ node, data: d, set, addOption, removeOption }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.options');
  const unofficial = useUnofficialWhatsapp();
  const items = listItems(d.options);
  const setItem = (i: number, patch: Partial<ListItem>) =>
    set('options', patchItem(items, i, patch));
  const groups = groupBySection(items);
  const sectionNames = groups.map((g) => g.title).filter(Boolean);
  const listId = `list-sections-${node.id}`;
  return (
    <>
      <ListPreview d={d} />
      <Field label={t('prompt')}>
        <TextArea value={d.prompt} rows={3} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field label={t('listButtonLabel')} hint={t('listButtonHint', { max: 20 })}>
        <TextInput
          value={d.button}
          placeholder={t('listButtonPlaceholder')}
          onChange={(v) => set('button', v)}
        />
      </Field>
      <Field
        label={t('listItems')}
        hint={t('listItemsHint', { max: 10, unofficial: unofficial ? 'true' : 'false' })}
      >
        <datalist id={listId}>
          {sectionNames.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {items.map((o, i) => (
          <div
            key={`${node.id}-item-${i}`}
            className="mb-2 rounded-lg border border-border bg-muted/60 p-2"
          >
            <div className="flex items-center gap-2">
              <span className="w-5 font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
              <input
                type="text"
                value={o.title}
                maxLength={LIST_TITLE_MAX}
                onChange={(e) => setItem(i, { title: e.target.value })}
                placeholder={t('itemTitle')}
                className={cn(controlClass, '!w-auto min-w-0 flex-1')}
              />
              <Counter len={o.title.length} max={LIST_TITLE_MAX} />
              <IconButton title={t('remove')} danger onClick={() => removeOption(i)}>
                <XIcon />
              </IconButton>
            </div>
            <div className="mt-1.5 flex items-center gap-2 ps-7 pe-8">
              <input
                type="text"
                value={o.description}
                maxLength={LIST_DESC_MAX}
                onChange={(e) => setItem(i, { description: e.target.value })}
                placeholder={t('itemDescription')}
                className={subInput}
              />
              <Counter len={o.description.length} max={LIST_DESC_MAX} />
            </div>
            <div className="mt-1.5 flex items-center gap-2 ps-7 pe-8">
              <input
                type="text"
                value={o.section}
                maxLength={LIST_SECTION_MAX}
                list={listId}
                onChange={(e) => setItem(i, { section: e.target.value })}
                placeholder={t('itemSection')}
                className={subInput}
              />
              <Counter len={o.section.length} max={LIST_SECTION_MAX} />
            </div>
          </div>
        ))}
        <AddLink onClick={addOption}>{t('addItem')}</AddLink>
        {groups.length > 1 ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {t.rich('listSections', {
              b: (chunks) => <b>{chunks}</b>,
              count: groups.length,
              summary: groups
                .map((g) =>
                  t('listSectionRow', { title: g.title || t('noHeading'), count: g.rows.length }),
                )
                .join(' · '),
            })}
          </div>
        ) : null}
      </Field>
      <ChoiceVariableField data={d} set={set} />
      <SaveToAttributeField data={d} set={set} noun="choice" />
    </>
  );
}

export function AskForm({ node, data: d, set, addOption, removeOption }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.options');
  const ts = useTranslations('flb.builder.simple.editors');
  const tf = useFlb();
  const unofficial = useUnofficialWhatsapp();
  const options = asArray(d.options);
  // A checked answer applies to a free reply: with fixed answers or a file upload the plain Ask runs.
  const checked =
    flbCleanAskInputType(d.validate) !== 'text' && options.length === 0 && d.acceptMedia !== true;
  return (
    <>
      <Field label={t('askQuestion')}>
        <TextArea value={d.prompt} rows={3} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field
        label={t('askValidate')}
        hint={checked ? t('askValidateChecked') : t('askValidateFree')}
      >
        <SelectInput
          value={flbCleanAskInputType(d.validate)}
          options={FLB_ASK_INPUT_TYPES.map((v) => ({ v, l: askInputLabel(tf, v) }))}
          onChange={(v) => set('validate', v)}
        />
      </Field>
      {checked ? (
        <>
          {flbCleanAskInputType(d.validate) === 'date' ? (
            <Field label={t('askDateFormat')} hint={t('askDateFormatHint')}>
              <SelectInput
                value={flbCleanDateFormat(d.dateFormat)}
                options={FLB_DATE_FORMATS.map((v) => ({ v, l: dateFormatLabel(tf, v) }))}
                onChange={(v) => set('dateFormat', v)}
              />
            </Field>
          ) : null}
          {flbCleanAskInputType(d.validate) === 'phone' ? (
            <Field hint={ts('ask.verifyOtpHint')}>
              <Check checked={d.verifyOtp === true} onChange={(v) => set('verifyOtp', v)}>
                {ts('ask.verifyOtp')}
              </Check>
            </Field>
          ) : null}
          <Field label={t('askWrongLabel')} hint={t('askWrongHint')}>
            <TextArea
              value={d.wrongReply}
              rows={2}
              placeholder={askInputWrongText(tf, flbCleanAskInputType(d.validate), d.dateFormat)}
              onChange={(v) => set('wrongReply', v)}
            />
          </Field>
          <Field label={t('askRetriesLabel')} hint={t('askRetriesHint')}>
            <NumberInput
              value={d.retries}
              min={0}
              max={10}
              onChange={(v) =>
                set('retries', Number.isNaN(v) ? 0 : Math.min(10, Math.max(0, Math.trunc(v))))
              }
            />
          </Field>
          {Number(d.retries) > 0 ? (
            <Field label={t('askThen')}>
              <SelectInput
                value={d.onFail === 'end' ? 'end' : 'continue'}
                options={[
                  { v: 'continue', l: t('askThenContinue') },
                  { v: 'end', l: t('askThenEnd') },
                ]}
                onChange={(v) => set('onFail', v)}
              />
            </Field>
          ) : null}
        </>
      ) : null}
      <Field
        label={t('askVarLabel')}
        hint={t.rich('askVarHint', {
          v: (chunks) => <V>{chunks}</V>,
          m: (chunks) => <span className="font-mono">{chunks}</span>,
        })}
      >
        <TextInput value={d.var} placeholder="answer" onChange={(v) => set('var', v)} />
      </Field>
      <SaveToAttributeField data={d} set={set} noun="answer" />
      <Field
        label={t('askMediaLabel')}
        hint={t('askMediaHint', { unofficial: unofficial ? 'true' : 'false' })}
      >
        <Check checked={!!d.acceptMedia} onChange={(v) => set('acceptMedia', v)}>
          {t('askMediaCheck')}
        </Check>
      </Field>
      <Field
        label={t('askAnswersLabel')}
        hint={t.rich('askAnswersHint', { max: 3, b: (chunks) => <b>{chunks}</b> })}
      >
        {options.map((o, i) => (
          <OptionRow
            key={`${node.id}-ans-${i}`}
            index={i}
            value={o}
            onChange={(v) => set('options', setStringOption(d.options, i, v))}
            onRemove={() => removeOption(i)}
          />
        ))}
        {options.length < 3 ? (
          <AddLink onClick={addOption}>{t('addAnswer')}</AddLink>
        ) : (
          <div className="mt-1 text-[11px] italic text-muted-foreground">
            {t('maxReached', { max: 3 })}
          </div>
        )}
      </Field>
    </>
  );
}

export function PollForm({ node, data: d, set, addOption, removeOption }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.options');
  const options = asArray(d.options);
  return (
    <>
      <PollPreview d={d} />
      <Field label={t('askQuestion')}>
        <TextArea
          value={d.question}
          placeholder={t('pollPlaceholder')}
          rows={2}
          onChange={(v) => set('question', v)}
        />
      </Field>
      <Field label={t('buttonsOptions')} hint={t('pollOptionsHint', { max: 3 })}>
        {options.map((o, i) => (
          <OptionRow
            key={`${node.id}-poll-${i}`}
            index={i}
            value={o}
            onChange={(v) => set('options', setStringOption(d.options, i, v))}
            onRemove={() => removeOption(i)}
          />
        ))}
        {options.length < 3 ? (
          <AddLink onClick={addOption}>{t('addOption')}</AddLink>
        ) : (
          <div className="mt-1 text-[11px] italic text-muted-foreground">
            {t('maxReached', { max: 3 })}
          </div>
        )}
      </Field>
      <Field label={t('pollMulti')}>
        <Check checked={!!d.multi} onChange={(v) => set('multi', v)}>
          {t('pollMultiCheck')}
        </Check>
      </Field>
    </>
  );
}
