'use client';

import { useGoogleFiles } from '../../../api/hooks';
import { AddButton, Check, Field, Notice, SelectInput, TextInput } from '../kit';
import type { FormComponent, FormProps } from '../types';
import { extractGoogleId, withSavedOption } from './helpers';
import { Intro, Mono, Num, RemoveButton, RowInput, Sel, Ta, Txt, readRows } from './shared';

type Kind = 'sheets' | 'docs' | 'forms';

const COPY: Record<Kind, { pick: string; empty: string; saved: string; noun: string }> = {
  sheets: { pick: '— pick a sheet —', empty: 'No spreadsheets found — paste a URL/ID below', saved: 'Sheet', noun: 'sheets' },
  docs: { pick: '— pick a template doc —', empty: 'No docs found', saved: 'Doc', noun: 'docs' },
  forms: { pick: '— pick a form —', empty: 'No forms found', saved: 'Form', noun: 'forms' },
};

/**
 * Dropdown over the connected Google account's files. While the Google integration is not connected the list request
 * fails; the field then becomes a plain text input for the id (never a made-up list) with an amber note.
 */
function GoogleFilePicker({ p, kind, dataKey }: { p: FormProps; kind: Kind; dataKey: string }) {
  const files = useGoogleFiles(kind);
  const value = p.data[dataKey];
  const copy = COPY[kind];
  if (files.isError) {
    return (
      <>
        <Notice tone="warn" className="mb-2">
          Google isn&apos;t connected for this workspace, so your {copy.noun} can&apos;t be listed. Paste the {copy.saved.toLowerCase()}{' '}
          id or link instead.
        </Notice>
        <TextInput
          value={value}
          mono
          placeholder={kind === 'sheets' ? 'https://docs.google.com/spreadsheets/d/<ID>/edit' : `${copy.saved} id`}
          onChange={(v) => p.set(dataKey, extractGoogleId(v))}
        />
      </>
    );
  }
  const list = files.data?.data ?? [];
  const first = files.isPending ? `Loading ${copy.noun}…` : list.length ? copy.pick : copy.empty;
  const opts = withSavedOption(
    [{ v: '', l: first }, ...list.map((f) => ({ v: f.id, l: f.name }))],
    value,
    (id) => `${copy.saved} ${id.slice(0, 12)}… (not loaded)`,
  );
  return <SelectInput value={value} onChange={(v) => p.set(dataKey, v)} options={opts} />;
}

export const GoogleSheetsForm: FormComponent = (p) => {
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
        Append a row to a Google Sheet (write mode) or look up a row by a key column (read mode). Uses the workspace&apos;s
        connected Google account.
      </Intro>
      <Field label="Mode">
        {Sel(p, 'mode', [
          { v: 'write', l: 'Write — append a row' },
          { v: 'read', l: 'Read — look up a row' },
        ])}
      </Field>
      <Field label="Spreadsheet">
        <GoogleFilePicker p={p} kind="sheets" dataKey="sheetId" />
      </Field>
      <PasteSheetField p={p} />
      <Field label="Tab name (blank = first tab)">{Txt(p, 'tabName', 'Sheet1')}</Field>
      {read ? (
        <>
          <Field label="Lookup column (header)">{Txt(p, 'matchColumn', 'Phone')}</Field>
          <Field label="Lookup value" hint="Use a flow variable like {{phone}} or {{email}}.">
            {Txt(p, 'matchValue', '{{phone}}')}
          </Field>
          <Field
            label="Save row under variable"
            hint={
              <>
                Cells become <Mono>{'{{saveAs.Name}}'}</Mono>, <Mono>{'{{saveAs.Phone}}'}</Mono> etc.
              </>
            }
          >
            {Txt(p, 'saveAs', 'sheet_row')}
          </Field>
        </>
      ) : (
        <>
          <Field
            label={byHeader ? 'Columns (matched by header name)' : 'Columns to append (in sheet order)'}
            hint={
              byHeader
                ? 'Each value is written under the sheet column whose header matches the Header field — any order. Values support {{merge_tags}}.'
                : 'Header is informational (the row is appended left-to-right by position). Values support {{merge_tags}}.'
            }
          >
            <div className="space-y-2">
              {cols.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <RowInput value={c.header} onChange={(v) => setCol(i, 'header', v)} placeholder="Header" className="w-1/3" />
                  <RowInput value={c.value} onChange={(v) => setCol(i, 'value', v)} placeholder="{{name}}" className="flex-1" />
                  <RemoveButton onClick={() => p.set('columns', cols.filter((_, j) => j !== i))} />
                </div>
              ))}
              <AddButton onClick={() => p.set('columns', cols.concat([{ header: '', value: '' }]))}>Add column</AddButton>
            </div>
          </Field>
          <div className="mb-2 px-1">
            <Check checked={byHeader} onChange={(v) => p.set('matchByHeader', v)}>
              Match columns by header name
            </Check>
            <div className="ml-6 text-[10.5px] text-muted-foreground">
              Write each value into the sheet column with that header (any order). Leave off to append left-to-right by
              position — the default.
            </div>
          </div>
        </>
      )}
    </>
  );
};

/** The "paste a link" box next to the picker; only shown while the picker works (otherwise the picker is already a text box). */
function PasteSheetField({ p }: { p: FormProps }) {
  const files = useGoogleFiles('sheets');
  if (files.isError) return null;
  return (
    <Field
      label="…or paste a Spreadsheet URL / ID"
      hint="Works even if the picker is empty — paste the sheet link and we extract its ID."
    >
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
        Copy a template doc, fill <Mono>{'{{placeholders}}'}</Mono>, share anyone-with-link, send the URL to the customer.
        Place <Mono>{'{{key}}'}</Mono> in your template where the value should go.
      </Intro>
      <Field label="Template document">
        <GoogleFilePicker p={p} kind="docs" dataKey="templateId" />
      </Field>
      <Field label="New copy title">{Txt(p, 'newTitle', 'Document for {{name}}')}</Field>
      <Field
        label="Placeholders to fill"
        hint={
          <>
            Every flow variable is also auto-injected — so <Mono>{'{{name}}'}</Mono> works in the template without listing it
            here.
          </>
        }
      >
        <div className="space-y-2">
          {phs.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <RowInput value={c.key} onChange={(v) => setPh(i, 'key', v)} placeholder="customer_name" mono className="w-1/3" />
              <RowInput value={c.value} onChange={(v) => setPh(i, 'value', v)} placeholder="{{name}}" className="flex-1" />
              <RemoveButton onClick={() => p.set('placeholders', phs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <AddButton onClick={() => p.set('placeholders', phs.concat([{ key: '', value: '' }]))}>Add placeholder</AddButton>
        </div>
      </Field>
      <Field label="Make link viewable by anyone">
        <Check checked={shareable} onChange={(v) => p.set('shareable', v)}>
          {shareable ? 'On — anyone with link can view' : 'Off — must be granted manually'}
        </Check>
      </Field>
      <Field
        label="Message template"
        hint={
          <>
            The bot bubble sent to the customer. <Mono>{'{{doc_url}}'}</Mono> gets the share link.
          </>
        }
      >
        {Ta(p, 'messageTemplate', "Here's your document:\n{{doc_url}}", 4)}
      </Field>
      <Field label="Save URL under variable">{Txt(p, 'saveAs', 'doc_url')}</Field>
    </>
  );
};

export const GoogleFormForm: FormComponent = (p) => (
  <>
    <Intro>
      Sends the form URL via WhatsApp, pauses the flow, resumes via the <b>submitted</b> port when the customer fills it.
      Answers become flow variables.
    </Intro>
    <Field label="Google Form">
      <GoogleFilePicker p={p} kind="forms" dataKey="formId" />
    </Field>
    <Field label="Body bubble (sent above the link)">{Ta(p, 'bodyText', 'Please fill out this short form:', 3)}</Field>
    <Field
      label="Save responses under variable"
      hint={
        <>
          Individual answers also land as <Mono>{'{{saveAs.Question title}}'}</Mono>.
        </>
      }
    >
      {Txt(p, 'saveAs', 'google_form')}
    </Field>
    <Field label="Expire after (seconds)" hint="How long to wait for a submission before timing out. 86400 = 24h.">
      {Num(p, 'expiresInSec', '86400')}
    </Field>
  </>
);
