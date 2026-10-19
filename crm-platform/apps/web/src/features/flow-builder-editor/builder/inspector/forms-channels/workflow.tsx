'use client';

import { GoogleConnectionNotice } from './google-connection';
import { FLB_FIELD_MATCH_OPERATORS } from '@crm/contracts';
import { Field, type Opt } from '../kit';
import type { FormComponent } from '../types';
import { GoogleFilePicker } from './google';
import { withSavedOption } from './helpers';
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

/** Operators in plain words, in the order the Condition node lists them. */
export const OPERATOR_OPTIONS: Opt[] = FLB_FIELD_MATCH_OPERATORS.map((v) => ({
  v,
  l: {
    equals: 'equals',
    not_equals: 'does not equal',
    contains: 'contains',
    not_contains: 'does not contain',
    starts_with: 'starts with',
    ends_with: 'ends with',
    greater_than: 'is greater than',
    less_than: 'is less than',
    is_set: 'has a value',
    is_not_set: 'is blank',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
  }[v],
}));

const listOptions = (p: Parameters<FormComponent>[0]): Opt[] =>
  withSavedOption(
    [
      { v: '', l: p.env.loading ? 'Loading lists…' : '— pick list —' },
      ...p.env.ctx.groups.map((g) => ({ v: g.id, l: g.name || 'List' })),
    ],
    p.data.listId,
    (id) => `List ${id.slice(0, 8)} (not loaded)`,
  );

export const UpdateContactForm: FormComponent = (p) => (
  <>
    <Intro
      sub={
        <>
          Contact fields live at <ExtLink href="/contacts">/contacts</ExtLink>. The phone number
          cannot be changed here.
        </>
      }
    >
      Sets <b>one field</b> of this contact. Use <Mono>name</Mono>, <Mono>first_name</Mono>,{' '}
      <Mono>last_name</Mono>, <Mono>email</Mono>, <Mono>title</Mono>, <Mono>language</Mono>,{' '}
      <Mono>address</Mono> or the key of one of your custom fields. Later nodes see the new value.
    </Intro>
    <Field label="Field" hint="The field key, for example city or email.">
      {Txt(p, 'field', 'city')}
    </Field>
    <Field
      label="New value"
      hint="Any text or {{variable}}. Leave blank to clear the field (a name cannot be cleared)."
    >
      {Txt(p, 'value', '{{user_message}}')}
    </Field>
  </>
);

export const ListMemberForm: FormComponent = (p) => (
  <>
    <Intro
      sub={
        <>
          Manage lists at <ExtLink href="/contacts/groups">/contacts/groups</ExtLink>.
        </>
      }
    >
      Puts this contact in a <b>list</b>, or takes them out of it. A list a flow changes does not
      start the &ldquo;joins / leaves a list&rdquo; flows, so a flow cannot loop on itself.
    </Intro>
    <Field label="Action">
      {Sel(p, 'action', [
        { v: 'add', l: 'Add the contact to the list' },
        { v: 'remove', l: 'Remove the contact from the list' },
      ])}
    </Field>
    <Field label="List">{Sel(p, 'listId', listOptions(p))}</Field>
  </>
);

export const InListForm: FormComponent = (p) => (
  <>
    <Intro>
      Branches on whether this contact is in a <b>list</b>: <Mono>yes</Mono> when they are,{' '}
      <Mono>no</Mono> when they are not (or the list is gone).
    </Intro>
    <Field label="List">{Sel(p, 'listId', listOptions(p))}</Field>
  </>
);

export const InSegmentForm: FormComponent = (p) => {
  const opts = withSavedOption(
    [
      { v: '', l: p.env.loading ? 'Loading segments…' : '— pick segment —' },
      ...p.env.ctx.segments.map((s) => ({ v: s.id, l: s.name || 'Segment' })),
    ],
    p.data.segmentId,
    (id) => `Segment ${id.slice(0, 8)} (not loaded)`,
  );
  return (
    <>
      <Intro
        sub={
          <>
            Build segments at <ExtLink href="/segments">/segments</ExtLink>.
          </>
        }
      >
        Branches on whether this contact matches a <b>segment</b> right now: <Mono>yes</Mono> or{' '}
        <Mono>no</Mono>.
      </Intro>
      <Field label="Segment">{Sel(p, 'segmentId', opts)}</Field>
    </>
  );
};

export const WaSessionForm: FormComponent = (p) => (
  <>
    <Intro>
      <Mono>yes</Mono> when the customer wrote to you within the last <b>24 hours</b>, so a plain
      message can still be sent; <Mono>no</Mono> when the window has closed and only an approved
      template can reach them.
    </Intro>
    <Field
      label="Window (hours)"
      hint="WhatsApp's window is 24 hours. Use a shorter one to be stricter."
    >
      {Num(p, 'hours', '24')}
    </Field>
  </>
);

function SheetLookup({ p }: { p: Parameters<FormComponent>[0] }) {
  return (
    <>
      <GoogleConnectionNotice need="sheets" />
      <Field label="Spreadsheet" hint="Pick a sheet from your connected Google account.">
        <GoogleFilePicker p={p} kind="sheets" dataKey="sheetId" />
      </Field>
      <Field label="Tab (optional)" hint="Blank = the first tab.">
        {Txt(p, 'tabName', 'Sheet1')}
      </Field>
      <Field label="Find the row where column" hint="The header of the column to look in.">
        {Txt(p, 'matchColumn', 'Phone')}
      </Field>
      <Field label="equals" hint="Usually {{phone}}.">
        {Txt(p, 'matchValue', '{{phone}}')}
      </Field>
    </>
  );
}

export const SheetCheckForm: FormComponent = (p) => (
  <>
    <Intro>
      Looks up a row in a Google Sheet and checks one of its cells: <Mono>yes</Mono> when the cell
      meets the test, <Mono>no</Mono> when it does not, when no row matches, or when Google cannot
      be read.
    </Intro>
    <SheetLookup p={p} />
    <Field label="Check column">{Txt(p, 'checkColumn', 'Status')}</Field>
    <Field label="Test">{Sel(p, 'operator', OPERATOR_OPTIONS)}</Field>
    {p.data.operator !== 'is_set' && p.data.operator !== 'is_not_set' ? (
      <Field label="Value">{Txt(p, 'value', 'Paid')}</Field>
    ) : null}
  </>
);

export const SheetContactForm: FormComponent = (p) => {
  const rows = readRows(p.data.map);
  const write = (next: Record<string, unknown>[]) => p.set('map', next);
  return (
    <>
      <Intro>
        Looks up a row in a Google Sheet and copies cells into <b>this contact</b>: one column per
        field. It updates the contact the flow is talking to; it does not create contacts from new
        rows.
      </Intro>
      <SheetLookup p={p} />
      <Field label="Copy these columns" hint="Sheet column header → contact field key.">
        {rows.map((r, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-1.5">
            <RowInput
              value={r.column}
              placeholder="Column header"
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
          Add column
        </AddLink>
      </Field>
    </>
  );
};
