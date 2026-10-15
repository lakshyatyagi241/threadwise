'use client';

import { useTranslations } from 'next-intl';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { useGoogleFiles } from '../../../api/hooks';
import { GoogleConnectionNotice } from './google-connection';
import { Check, Field, Notice, SelectInput, TextInput } from '../kit';
import type { FormComponent, FormProps } from '../types';
import { appsScriptHref, extractGoogleId, withSavedOption } from './helpers';
import {
  AddLink,
  ExtLink,
  Intro,
  Mono,
  Num,
  RemoveButton,
  RowInput,
  Sel,
  Ta,
  Txt,
  readRows,
} from './shared';

type Kind = 'sheets' | 'docs' | 'forms';

const NS = 'flb.builder.formsChannels.google';

/**
 * Dropdown over the connected Google account's files. While the Google integration is not connected the list request
 * fails; the field then becomes a plain text input for the id (never a made-up list) with an amber note.
 */
function GoogleFilePicker({ p, kind, dataKey }: { p: FormProps; kind: Kind; dataKey: string }) {
  const t = useTranslations(NS);
  const files = useGoogleFiles(kind);
  const value = p.data[dataKey];
  if (files.isError) {
    // Connected, but without the Drive file list permission: say that, not "not connected".
    const noListing =
      files.error instanceof ApiError && files.error.code === ERROR_CODES.GOOGLE_SCOPE_MISSING;
    return (
      <>
        <Notice tone="warn" className="mb-2">
          {noListing ? t('noListing') : t(`kinds.${kind}.notConnected`)}
        </Notice>
        <TextInput
          value={value}
          mono
          placeholder={
            kind === 'sheets'
              ? 'https://docs.google.com/spreadsheets/d/<ID>/edit'
              : t(`kinds.${kind}.idPlaceholder`)
          }
          onChange={(v) => p.set(dataKey, extractGoogleId(v))}
        />
      </>
    );
  }
  const list = files.data?.data ?? [];
  const first = files.isPending
    ? t(`kinds.${kind}.loading`)
    : list.length
      ? t(`kinds.${kind}.pick`)
      : t(`kinds.${kind}.empty`);
  const opts = withSavedOption(
    [{ v: '', l: first }, ...list.map((f) => ({ v: f.id, l: f.name }))],
    value,
    (id) => t(`kinds.${kind}.saved`, { id: id.slice(0, 12) }),
  );
  return <SelectInput value={value} onChange={(v) => p.set(dataKey, v)} options={opts} />;
}

export const GoogleSheetsForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const read = p.data.mode === 'read';
  const cols = readRows(p.data.columns);
  const byHeader = !!p.data.matchByHeader;
  const setCol = (i: number, k: string, v: string) =>
    p.set(
      'columns',
      cols.map((c, j) => (j === i ? { ...c, [k]: v } : c)),
    );
  return (
    <>
      <Intro>
        {t.rich('sheetsIntro', { link: (c) => <ExtLink href="/google-account">{c}</ExtLink> })}
      </Intro>
      <GoogleConnectionNotice need="sheets" />
      <Field label={t('mode')}>
        {Sel(p, 'mode', [
          { v: 'write', l: t('modeWrite') },
          { v: 'read', l: t('modeRead') },
        ])}
      </Field>
      <Field label={t('spreadsheet')}>
        <GoogleFilePicker p={p} kind="sheets" dataKey="sheetId" />
      </Field>
      <PasteSheetField p={p} />
      <Field label={t('tabName')}>{Txt(p, 'tabName', 'Sheet1')}</Field>
      {read ? (
        <>
          <Field label={t('lookupColumn')}>{Txt(p, 'matchColumn', 'Phone')}</Field>
          <Field label={t('lookupValue')} hint={t('lookupValueHint')}>
            {Txt(p, 'matchValue', '{{phone}}')}
          </Field>
          <Field
            label={t('saveRow')}
            hint={t.rich('saveRowHint', {
              nameToken: '{{saveAs.Name}}',
              phoneToken: '{{saveAs.Phone}}',
              mono: (c) => <Mono>{c}</Mono>,
            })}
          >
            {Txt(p, 'saveAs', 'sheet_row')}
          </Field>
        </>
      ) : (
        <>
          <Field
            label={byHeader ? t('columnsByHeader') : t('columnsByPosition')}
            hint={byHeader ? t('columnsByHeaderHint') : t('columnsByPositionHint')}
          >
            <div className="space-y-2">
              {cols.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <RowInput
                    value={c.header}
                    onChange={(v) => setCol(i, 'header', v)}
                    placeholder={t('header')}
                    className="w-1/3"
                  />
                  <RowInput
                    value={c.value}
                    onChange={(v) => setCol(i, 'value', v)}
                    placeholder="{{name}}"
                    className="flex-1"
                  />
                  <RemoveButton
                    onClick={() =>
                      p.set(
                        'columns',
                        cols.filter((_, j) => j !== i),
                      )
                    }
                  />
                </div>
              ))}
              <AddLink
                plain
                onClick={() => p.set('columns', cols.concat([{ header: '', value: '' }]))}
              >
                {t('addColumn')}
              </AddLink>
            </div>
          </Field>
          <div className="mb-2 px-1">
            <Check checked={byHeader} onChange={(v) => p.set('matchByHeader', v)}>
              {t('matchByHeader')}
            </Check>
            <div className="ml-6 text-[10.5px] text-muted-foreground">{t('matchByHeaderHint')}</div>
          </div>
        </>
      )}
    </>
  );
};

/** The "paste a link" box next to the picker; only shown while the picker works (otherwise the picker is already a text box). */
function PasteSheetField({ p }: { p: FormProps }) {
  const t = useTranslations(NS);
  const files = useGoogleFiles('sheets');
  if (files.isError) return null;
  return (
    <Field label={t('pasteLabel')} hint={t('pasteHint')}>
      <TextInput
        mono
        value={p.data.sheetId}
        placeholder="https://docs.google.com/spreadsheets/d/<ID>/edit"
        onChange={(v) => p.set('sheetId', extractGoogleId(v))}
      />
    </Field>
  );
}

export const GoogleDocsForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  const phs = readRows(p.data.placeholders);
  const shareable = p.data.shareable !== false;
  const setPh = (i: number, k: string, v: string) =>
    p.set(
      'placeholders',
      phs.map((c, j) => (j === i ? { ...c, [k]: v } : c)),
    );
  return (
    <>
      <Intro>
        {t.rich('docsIntro', {
          placeholders: '{{placeholders}}',
          key: '{{key}}',
          mono: (c) => <Mono>{c}</Mono>,
        })}
      </Intro>
      <GoogleConnectionNotice need="docs" />
      <Field label={t('templateDocument')}>
        <GoogleFilePicker p={p} kind="docs" dataKey="templateId" />
      </Field>
      <Field label={t('newCopyTitle')}>{Txt(p, 'newTitle', t('newCopyTitlePlaceholder'))}</Field>
      <Field
        label={t('placeholdersToFill')}
        hint={t.rich('placeholdersHint', { token: '{{name}}', mono: (c) => <Mono>{c}</Mono> })}
      >
        <div className="space-y-2">
          {phs.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <RowInput
                value={c.key}
                onChange={(v) => setPh(i, 'key', v)}
                placeholder="customer_name"
                mono
                className="w-1/3"
              />
              <RowInput
                value={c.value}
                onChange={(v) => setPh(i, 'value', v)}
                placeholder="{{name}}"
                className="flex-1"
              />
              <RemoveButton
                onClick={() =>
                  p.set(
                    'placeholders',
                    phs.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          <AddLink
            plain
            onClick={() => p.set('placeholders', phs.concat([{ key: '', value: '' }]))}
          >
            {t('addPlaceholder')}
          </AddLink>
        </div>
      </Field>
      <Field label={t('makeViewable')}>
        <Check checked={shareable} onChange={(v) => p.set('shareable', v)}>
          {shareable ? t('viewableOn') : t('viewableOff')}
        </Check>
      </Field>
      <Field
        label={t('messageTemplate')}
        hint={t.rich('messageTemplateHint', {
          token: '{{doc_url}}',
          mono: (c) => <Mono>{c}</Mono>,
        })}
      >
        {Ta(p, 'messageTemplate', t('messageTemplatePlaceholder'), 4)}
      </Field>
      <Field label={t('saveUrl')}>{Txt(p, 'saveAs', 'doc_url')}</Field>
    </>
  );
};

export const GoogleFormForm: FormComponent = (p) => {
  const t = useTranslations(NS);
  return (
    <>
      <Intro>{t.rich('formIntro', { b: (c) => <b>{c}</b> })}</Intro>
      <GoogleConnectionNotice need="forms" />
      <Field label={t('googleForm')}>
        <GoogleFilePicker p={p} kind="forms" dataKey="formId" />
      </Field>
      <Field label={t('bodyBubble')}>{Ta(p, 'bodyText', t('bodyBubblePlaceholder'), 3)}</Field>
      <Field
        label={t('saveResponses')}
        hint={t.rich('saveResponsesHint', {
          token: '{{saveAs.Question title}}',
          mono: (c) => <Mono>{c}</Mono>,
        })}
      >
        {Txt(p, 'saveAs', 'google_form')}
      </Field>
      <Field label={t('expireAfter')} hint={t('expireAfterHint')}>
        {Num(p, 'expiresInSec', '86400')}
      </Field>
      {p.data.formId ? (
        <div className="mt-3 rounded-lg border border-border bg-muted p-3">
          <div className="mb-1 text-[12px] font-semibold">{t('setupTitle')}</div>
          <ol className="mb-2 list-inside list-decimal space-y-0.5 text-[11.5px] text-foreground/80">
            <li>{t.rich('setupOpen', { mono: (c) => <Mono>{c}</Mono> })}</li>
            <li>
              {t.rich('setupDownload', {
                link: (c) => (
                  <a
                    href={appsScriptHref(String(p.data.formId))}
                    download
                    className="text-brand underline"
                  >
                    {c}
                  </a>
                ),
              })}
            </li>
            <li>{t.rich('setupTrigger', { mono: (c) => <Mono>{c}</Mono> })}</li>
          </ol>
          <div className="font-mono text-[10.5px] text-muted-foreground">{t('setupWarning')}</div>
        </div>
      ) : null}
    </>
  );
};
