'use client';

import { useTranslations } from 'next-intl';
import { GoogleConnectionNotice } from './google-connection';
import { FLB_FIELD_MATCH_OPERATORS } from '@crm/contracts';
import { Field, type Opt } from '../kit';
import type { FormComponent } from '../types';
import { GoogleFilePicker } from './google';
import { withSavedOption, type HelperT } from './helpers';
import {
  AddLink,
  ExtLink,
  Intro,
  Mono,
  Num,
  RemoveButton,
  RowInput,
  Sel,
  Txt,
  readRows,
} from './shared';

const NS = 'flb.builder.formsChannels.workflow';

/** The field-match operators in plain words, in the order the Condition node lists them. Shared by the Sheet check and the trigger's rules. */
export function useFieldMatchOperators(): {
  ids: readonly string[];
  label: (id: string) => string;
} {
  const t = useTranslations(NS);
  return {
    ids: FLB_FIELD_MATCH_OPERATORS,
    label: (id) => t(`op.${id as (typeof FLB_FIELD_MATCH_OPERATORS)[number]}`),
  };
}

const listOptions = (p: Parameters<FormComponent>[0], t: HelperT): Opt[] =>
  withSavedOption(
    [
      { v: '', l: p.env.loading ? t('listLoading') : t('listPick') },
      ...p.env.ctx.groups.map((g) => ({ v: g.id, l: g.name || t('listFallback') })),
    ],
    p.data.listId,
    (id) => t('listNotLoaded', { id: id.slice(0, 8) }),
  );

export const UpdateContactForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <>
      <Intro
        sub={t.rich('updateIntroSub', {
          link: (chunks) => <ExtLink href="/contacts">{chunks}</ExtLink>,
        })}
      >
        {t.rich('updateIntro', {
          b: (chunks) => <b>{chunks}</b>,
          mono: (chunks) => <Mono>{chunks}</Mono>,
        })}
      </Intro>
      <Field label={t('fieldLabel')} hint={t('fieldHint')}>
        {Txt(p, 'field', 'city')}
      </Field>
      <Field label={t('newValueLabel')} hint={t('newValueHint', { example: '{{variable}}' })}>
        {Txt(p, 'value', '{{user_message}}')}
      </Field>
    </>
  );
};

export const ListMemberForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <>
      <Intro
        sub={t.rich('listIntroSub', {
          link: (chunks) => <ExtLink href="/contacts/groups">{chunks}</ExtLink>,
        })}
      >
        {t.rich('listIntro', { b: (chunks) => <b>{chunks}</b> })}
      </Intro>
      <Field label={t('actionLabel')}>
        {Sel(p, 'action', [
          { v: 'add', l: t('actionAdd') },
          { v: 'remove', l: t('actionRemove') },
        ])}
      </Field>
      <Field label={t('listLabel')}>{Sel(p, 'listId', listOptions(p, t))}</Field>
    </>
  );
};

export const InListForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <>
      <Intro>
        {t.rich('inListIntro', {
          b: (chunks) => <b>{chunks}</b>,
          mono: (chunks) => <Mono>{chunks}</Mono>,
        })}
      </Intro>
      <Field label={t('listLabel')}>{Sel(p, 'listId', listOptions(p, t))}</Field>
    </>
  );
};

export const InSegmentForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const opts = withSavedOption(
    [
      { v: '', l: p.env.loading ? t('segmentLoading') : t('segmentPick') },
      ...p.env.ctx.segments.map((s) => ({ v: s.id, l: s.name || t('segmentFallback') })),
    ],
    p.data.segmentId,
    (id) => t('segmentNotLoaded', { id: id.slice(0, 8) }),
  );
  return (
    <>
      <Intro
        sub={t.rich('segmentIntroSub', {
          link: (chunks) => <ExtLink href="/segments">{chunks}</ExtLink>,
        })}
      >
        {t.rich('segmentIntro', {
          b: (chunks) => <b>{chunks}</b>,
          mono: (chunks) => <Mono>{chunks}</Mono>,
        })}
      </Intro>
      <Field label={t('segmentLabel')}>{Sel(p, 'segmentId', opts)}</Field>
    </>
  );
};

export const WaSessionForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <>
      <Intro>
        {t.rich('waSessionIntro', {
          b: (chunks) => <b>{chunks}</b>,
          mono: (chunks) => <Mono>{chunks}</Mono>,
        })}
      </Intro>
      <Field label={t('windowLabel')} hint={t('windowHint')}>
        {Num(p, 'hours', '24')}
      </Field>
    </>
  );
};

function SheetLookup({ p }: { p: Parameters<FormComponent>[0] }) {
  const t = useTranslations(NS);
  return (
    <>
      <GoogleConnectionNotice need="sheets" />
      <Field label={t('spreadsheetLabel')} hint={t('spreadsheetHint')}>
        <GoogleFilePicker p={p} kind="sheets" dataKey="sheetId" />
      </Field>
      <Field label={t('tabLabel')} hint={t('tabHint')}>
        {Txt(p, 'tabName', 'Sheet1')}
      </Field>
      <Field label={t('matchColumnLabel')} hint={t('matchColumnHint')}>
        {Txt(p, 'matchColumn', 'Phone')}
      </Field>
      <Field label={t('matchValueLabel')} hint={t('matchValueHint', { example: '{{phone}}' })}>
        {Txt(p, 'matchValue', '{{phone}}')}
      </Field>
    </>
  );
}

export const SheetCheckForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const ops = useFieldMatchOperators();
  return (
    <>
      <Intro>
        {t.rich('sheetCheckIntro', {
          mono: (chunks) => <Mono>{chunks}</Mono>,
        })}
      </Intro>
      <SheetLookup p={p} />
      <Field label={t('checkColumnLabel')}>{Txt(p, 'checkColumn', 'Status')}</Field>
      <Field label={t('testLabel')}>
        {Sel(
          p,
          'operator',
          ops.ids.map((v) => ({ v, l: ops.label(v) })),
        )}
      </Field>
      {p.data.operator !== 'is_set' && p.data.operator !== 'is_not_set' ? (
        <Field label={t('valueLabel')}>{Txt(p, 'value', 'Paid')}</Field>
      ) : null}
    </>
  );
};

export const SheetContactForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const rows = readRows(p.data.map);
  const write = (next: Record<string, unknown>[]) => p.set('map', next);
  return (
    <>
      <Intro>
        {t.rich('sheetContactIntro', {
          b: (chunks) => <b>{chunks}</b>,
        })}
      </Intro>
      <SheetLookup p={p} />
      <Field label={t('copyColumnsLabel')} hint={t('copyColumnsHint')}>
        {rows.map((r, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-1.5">
            <RowInput
              value={r.column}
              placeholder={t('columnHeaderPlaceholder')}
              onChange={(v) => write(rows.map((x, j) => (j === i ? { ...x, column: v } : x)))}
            />
            <span className="text-muted-foreground">→</span>
            <RowInput
              value={r.field}
              placeholder="name"
              onChange={(v) => write(rows.map((x, j) => (j === i ? { ...x, field: v } : x)))}
            />
            <RemoveButton onClick={() => write(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddLink plain onClick={() => write([...rows, { column: '', field: '' }])}>
          {t('addColumn')}
        </AddLink>
      </Field>
    </>
  );
};
