'use client';

import { cn } from '@crm/ui';
import {
  Check,
  controlClass,
  Field,
  IconButton,
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
import { ButtonsPreview, ListPreview, PollPreview } from './previews';

/** Replaces option `i` of a string-options node. */
function setStringOption(options: unknown, i: number, value: string): string[] {
  return asArray(options).map((v, j) => (j === i ? value : String(v ?? '')));
}

export function ButtonsForm({ node, data: d, set, addOption, removeOption }: FormProps) {
  return (
    <>
      <ButtonsPreview d={d} />
      <Field label="Prompt">
        <TextArea value={d.prompt} rows={3} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field label="Options" hint="Max 3 buttons. Each gets its own output port.">
        {asArray(d.options).map((o, i) => (
          <OptionRow
            key={`${node.id}-opt-${i}`}
            index={i}
            value={o}
            onChange={(v) => set('options', setStringOption(d.options, i, v))}
            onRemove={() => removeOption(i)}
          />
        ))}
        <AddLink onClick={addOption}>Add button</AddLink>
      </Field>
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
  const items = listItems(d.options);
  const setItem = (i: number, patch: Partial<ListItem>) =>
    set('options', patchItem(items, i, patch));
  const groups = groupBySection(items);
  const sectionNames = groups.map((g) => g.title).filter(Boolean);
  const listId = `list-sections-${node.id}`;
  return (
    <>
      <ListPreview d={d} />
      <Field label="Prompt">
        <TextArea value={d.prompt} rows={3} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field
        label="Button label"
        hint="Text on the tap-to-open button under the bubble. Max 20 chars on WhatsApp."
      >
        <TextInput value={d.button} placeholder="View options" onChange={(v) => set('button', v)} />
      </Field>
      <Field
        label="Items"
        hint="Up to 10 items total. Give two items the SAME section name to group them under one heading. Sections and descriptions render on WhatsApp Business API (Cloud); on the Unofficial API the list falls back to plain buttons showing the title only."
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
                placeholder="Item title"
                className={cn(controlClass, '!w-auto min-w-0 flex-1')}
              />
              <Counter len={o.title.length} max={LIST_TITLE_MAX} />
              <IconButton title="Remove" danger onClick={() => removeOption(i)}>
                <XIcon />
              </IconButton>
            </div>
            <div className="mt-1.5 flex items-center gap-2 pl-7 pr-8">
              <input
                type="text"
                value={o.description}
                maxLength={LIST_DESC_MAX}
                onChange={(e) => setItem(i, { description: e.target.value })}
                placeholder="Description (optional)"
                className={subInput}
              />
              <Counter len={o.description.length} max={LIST_DESC_MAX} />
            </div>
            <div className="mt-1.5 flex items-center gap-2 pl-7 pr-8">
              <input
                type="text"
                value={o.section}
                maxLength={LIST_SECTION_MAX}
                list={listId}
                onChange={(e) => setItem(i, { section: e.target.value })}
                placeholder="Section (optional)"
                className={subInput}
              />
              <Counter len={o.section.length} max={LIST_SECTION_MAX} />
            </div>
          </div>
        ))}
        <AddLink onClick={addOption}>Add item</AddLink>
        {groups.length > 1 ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Renders as <b>{groups.length}</b> sections:{' '}
            {groups.map((g) => `${g.title || '(no heading)'} × ${g.rows.length}`).join(' · ')}
          </div>
        ) : null}
      </Field>
    </>
  );
}

export function AskForm({ node, data: d, set, addOption, removeOption }: FormProps) {
  const options = asArray(d.options);
  return (
    <>
      <Field label="Question">
        <TextArea value={d.prompt} rows={3} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field label="Validate as">
        <SelectInput
          value={d.validate}
          options={[
            { v: 'text', l: 'Free text' },
            { v: 'email', l: 'Email' },
            { v: 'phone', l: 'Phone' },
            { v: 'number', l: 'Number' },
          ]}
          onChange={(v) => set('validate', v)}
        />
      </Field>
      <Field
        label="Save answer to variable"
        hint={
          <>
            The customer&apos;s reply is stored here — reuse it later as <V>answer</V> (or whatever
            you name it) in a Send message. IMPORTANT: give each Ask question a UNIQUE name — e.g.{' '}
            <span className="font-mono">name</span>, <span className="font-mono">email</span> —
            otherwise a later question overwrites the earlier answer.
          </>
        }
      >
        <TextInput value={d.var} placeholder="answer" onChange={(v) => set('var', v)} />
      </Field>
      <Field
        label="Accept a file/photo upload"
        hint="When on and the customer replies with a file instead of text, the variable holds a link to the stored file — reuse it in Sheets, a Webhook, or a template media header. Works on WhatsApp (official & unofficial) and Twilio."
      >
        <Check checked={!!d.acceptMedia} onChange={(v) => set('acceptMedia', v)}>
          Save an uploaded image / PDF / audio as this variable (a link)
        </Check>
      </Field>
      <Field
        label="Expected answers"
        hint={
          <>
            Max 3 answers, same as Quick replies. Each becomes its own output port; anything else
            goes through the <b>else</b> port. Leave empty for free-text answers.
          </>
        }
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
          <AddLink onClick={addOption}>Add answer</AddLink>
        ) : (
          <div className="mt-1 text-[11px] italic text-muted-foreground">Max 3 reached.</div>
        )}
      </Field>
    </>
  );
}

export function PollForm({ node, data: d, set, addOption, removeOption }: FormProps) {
  const options = asArray(d.options);
  return (
    <>
      <PollPreview d={d} />
      <Field label="Question">
        <TextArea
          value={d.question}
          placeholder="Pick one"
          rows={2}
          onChange={(v) => set('question', v)}
        />
      </Field>
      <Field label="Options" hint="Max 3 options. Each becomes its own output port.">
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
          <AddLink onClick={addOption}>Add option</AddLink>
        ) : (
          <div className="mt-1 text-[11px] italic text-muted-foreground">Max 3 reached.</div>
        )}
      </Field>
      <Field label="Multiple choice">
        <Check checked={!!d.multi} onChange={(v) => set('multi', v)}>
          Allow multiple answers
        </Check>
      </Field>
    </>
  );
}
