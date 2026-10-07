'use client';

import type { ReactNode } from 'react';
import {
  FLB_ASK_FILE_GROUPS,
  FLB_ASK_INPUT_LABELS,
  FLB_ASK_INPUT_TYPES,
  FLB_DATE_FORMATS,
  flbAskInputWrongText,
  flbCleanAskFileExtensions,
  flbCleanAskInputType,
  flbCleanDateFormat,
  type FlbBuilderContext,
} from '@crm/contracts';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import { Field, Input, Select, Textarea } from '@crm/ui';
import {
  BRANCHING,
  LIMITS,
  stageIn,
  groupsOf,
  stepLabel,
  stepSummary,
  type SimpleDoc,
  type SimpleStep,
} from '../../lib/simple-model';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Where a button or row leads: nothing (the conversation ends), or any step of any journey, or a brand new journey. */
export const NEW_JOURNEY = '__new__';

export function LinkSelect({
  doc,
  stepId,
  value,
  onChange,
}: {
  doc: SimpleDoc;
  /** The step the button is on: a button can lead back to its own step. */
  stepId: string;
  value: string | null;
  onChange: (target: string | null | typeof NEW_JOURNEY) => void;
}) {
  return (
    <Select
      aria-label="Where this leads"
      className="h-9 text-[12.5px]"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">Ends here (nothing more is sent)</option>
      {groupsOf(doc).map((g) => (
        <optgroup key={g.key} label={g.name}>
          {g.chains.flatMap((ci) =>
            doc.journeys[ci]!.steps.map((s, si) => (
              <option key={s.id} value={s.id}>
                {stageIn(doc, ci, si)} · {stepLabel(s)}
                {s.id === stepId ? ' (this step)' : ''}
                {stepSummary(s) ? ` · ${stepSummary(s)}` : ''}
              </option>
            )),
          )}
        </optgroup>
      ))}
      <option value={NEW_JOURNEY}>+ Lead to a new flow…</option>
    </Select>
  );
}

interface EditorProps {
  step: SimpleStep;
  doc: SimpleDoc;
  ctx: FlbBuilderContext;
  /** Merge keys into the step's data. */
  set: (patch: Record<string, unknown>) => void;
  /** Point button / row `i` at a step (or `null` to end, or NEW_JOURNEY). */
  link: (i: number, target: string | null) => void;
}

const Counter = ({ value, max }: { value: string; max: number }) => (
  <span
    className={`font-mono text-[10.5px] ${value.length > max ? 'text-danger' : 'text-muted-foreground'}`}
  >
    {value.length}/{max}
  </span>
);

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40);

const Row = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-muted/40 p-2.5">{children}</div>
);

export function StepEditor(p: EditorProps) {
  const { step: s } = p;
  switch (s.type) {
    case 'message':
      return <MessageEditor {...p} />;
    case 'media':
      return <MediaEditor {...p} />;
    case 'buttons':
      return <ButtonsEditor {...p} />;
    case 'list':
      return <ListEditor {...p} />;
    case 'ask':
      return <AskEditor {...p} />;
    case 'ask_file':
      return <AskFileEditor {...p} />;
    case 'ask_location':
      return <AskLocationEditor {...p} />;
    case 'delay':
      return <DelayEditor {...p} />;
    case 'location':
      return <LocationEditor {...p} />;
    case 'template':
      return <TemplateEditor {...p} />;
    case 'cta':
      return <CtaEditor {...p} />;
    case 'assign':
      return <AssignEditor {...p} />;
  }
}

function MessageEditor({ step, set }: EditorProps) {
  return (
    <Field
      label="Message"
      hint="*bold*  _italic_  ~strike~  — and {{name}} for the customer's name."
    >
      <Textarea
        rows={5}
        value={str(step.data.text)}
        onChange={(e) => set({ text: e.target.value })}
      />
    </Field>
  );
}

const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

function MediaEditor({ step, set }: EditorProps) {
  const kind = str(step.data.kind) || 'image';
  return (
    <div className="space-y-3">
      <Field label="Type">
        <Select value={kind} onChange={(e) => set({ kind: e.target.value })}>
          {MEDIA_KINDS.map((k) => (
            <option key={k} value={k}>
              {k[0]!.toUpperCase() + k.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="File link" hint="A public https link to the file.">
        <Input
          value={str(step.data.url)}
          placeholder="https://"
          onChange={(e) => set({ url: e.target.value })}
        />
      </Field>
      {kind === 'document' ? (
        <Field label="File name shown to the customer">
          <Input
            value={str(step.data.filename)}
            onChange={(e) => set({ filename: e.target.value })}
          />
        </Field>
      ) : null}
      {kind !== 'audio' ? (
        <Field label="Caption (optional)">
          <Textarea
            rows={3}
            value={str(step.data.caption)}
            onChange={(e) => set({ caption: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

function ButtonsEditor({ step, doc, set, link }: EditorProps) {
  const opts = arr(step.data.options).map(str);
  const prompt = str(step.data.prompt);
  return (
    <div className="space-y-3">
      <Field
        label={
          <span className="flex items-center justify-between">
            Message above the buttons <Counter value={prompt} max={LIMITS.body} />
          </span>
        }
      >
        <Textarea rows={4} value={prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      <div className="space-y-2">
        <div className="text-[12px] font-medium">
          Buttons{' '}
          <span className="font-normal text-muted-foreground">
            (up to {LIMITS.buttons}) — each one decides what is sent next
          </span>
        </div>
        {opts.map((o, i) => (
          <Row key={i}>
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={o}
                maxLength={LIMITS.buttonLabel + 20}
                placeholder={`Button ${i + 1}`}
                invalid={o.length > LIMITS.buttonLabel}
                onChange={(e) =>
                  set({ options: opts.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              <Counter value={o} max={LIMITS.buttonLabel} />
              <RemoveBtn
                label="Remove button"
                disabled={opts.length <= 1}
                onClick={() => set({ options: opts.filter((_, j) => j !== i) })}
              />
            </div>
            <LinkSelect
              doc={doc}
              stepId={step.id}
              value={step.links[i] ?? null}
              onChange={(t) => link(i, t)}
            />
          </Row>
        ))}
        {opts.length < LIMITS.buttons ? (
          <AddBtn onClick={() => set({ options: [...opts, `Button ${opts.length + 1}`] })}>
            Add a button
          </AddBtn>
        ) : null}
      </div>
      <VarField step={step} set={set} label="Save the tapped button in" />
    </div>
  );
}

function ListEditor({ step, doc, set, link }: EditorProps) {
  const rows = arr(step.data.options).map(rec);
  const prompt = str(step.data.prompt);
  const button = str(step.data.button);
  const setRow = (i: number, patch: Record<string, unknown>) =>
    set({ options: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-3">
      <Field
        label={
          <span className="flex items-center justify-between">
            Message above the list <Counter value={prompt} max={LIMITS.body} />
          </span>
        }
      >
        <Textarea rows={4} value={prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            Text on the button that opens the list{' '}
            <Counter value={button} max={LIMITS.listButton} />
          </span>
        }
      >
        <Input
          value={button}
          invalid={button.length > LIMITS.listButton}
          onChange={(e) => set({ button: e.target.value })}
        />
      </Field>
      <div className="space-y-2">
        <div className="text-[12px] font-medium">
          Rows <span className="font-normal text-muted-foreground">(up to {LIMITS.rows})</span>
        </div>
        {rows.map((r, i) => (
          <Row key={i}>
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={str(r.title)}
                placeholder={`Row ${i + 1}`}
                invalid={str(r.title).length > LIMITS.rowTitle}
                onChange={(e) => setRow(i, { title: e.target.value })}
              />
              <Counter value={str(r.title)} max={LIMITS.rowTitle} />
              <RemoveBtn
                label="Remove row"
                disabled={rows.length <= 1}
                onClick={() => set({ options: rows.filter((_, j) => j !== i) })}
              />
            </div>
            <Input
              className="mb-2 h-9 text-[12.5px]"
              value={str(r.description)}
              placeholder="Description (optional)"
              invalid={str(r.description).length > LIMITS.rowDescription}
              onChange={(e) => setRow(i, { description: e.target.value })}
            />
            <LinkSelect
              doc={doc}
              stepId={step.id}
              value={step.links[i] ?? null}
              onChange={(t) => link(i, t)}
            />
          </Row>
        ))}
        {rows.length < LIMITS.rows ? (
          <AddBtn
            onClick={() =>
              set({
                options: [
                  ...rows,
                  { title: `Row ${rows.length + 1}`, description: '', section: '' },
                ],
              })
            }
          >
            Add a row
          </AddBtn>
        ) : null}
      </div>
      <VarField step={step} set={set} label="Save the chosen row in" />
    </div>
  );
}

/** What happens when an answer does not pass: the text sent, how many wrong answers are tolerated, and what then. */
function WrongAnswerFields({
  step,
  set,
  placeholder,
  defaultRetries,
}: {
  step: SimpleStep;
  set: (patch: Record<string, unknown>) => void;
  placeholder: string;
  defaultRetries: string;
}) {
  const retries = Number(step.data.retries) || 0;
  return (
    <div className="space-y-3">
      <Field label="Message for a wrong answer" hint="Leave blank to use the ready-made one.">
        <Textarea
          rows={2}
          value={str(step.data.wrongReply)}
          placeholder={placeholder}
          onChange={(e) => set({ wrongReply: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stop after wrong answers" hint={defaultRetries}>
          <Input
            type="number"
            min={0}
            max={10}
            value={str(step.data.retries)}
            onChange={(e) =>
              set({ retries: Math.min(10, Math.max(0, Math.trunc(Number(e.target.value) || 0))) })
            }
          />
        </Field>
        {retries > 0 ? (
          <Field label="Then">
            <Select
              value={str(step.data.onFail) === 'end' ? 'end' : 'continue'}
              onChange={(e) => set({ onFail: e.target.value })}
            >
              <option value="continue">Carry on without an answer</option>
              <option value="end">End the flow</option>
            </Select>
          </Field>
        ) : null}
      </div>
    </div>
  );
}

/** "Also copy the answer to a contact property". */
function SavePropertyField({
  step,
  set,
}: {
  step: SimpleStep;
  set: (patch: Record<string, unknown>) => void;
}) {
  const feed = usePickerFeed();
  const on = step.data.saveProperty === true;
  return (
    <Field label="Contact property">
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set({ saveProperty: e.target.checked })}
        />
        Also copy the answer to the contact
      </label>
      {on ? (
        <Select
          aria-label="Contact property"
          className="mt-2"
          value={str(step.data.propertyKey)}
          onChange={(e) => set({ propertyKey: e.target.value })}
        >
          <option value="">Choose a property…</option>
          {(feed.data?.custom ?? []).map((pr) => (
            <option key={pr.key} value={pr.key}>
              {pr.name}
            </option>
          ))}
        </Select>
      ) : null}
    </Field>
  );
}

function AskEditor({ step, set }: EditorProps) {
  const type = flbCleanAskInputType(step.data.validate);
  const checked = type !== 'text';
  return (
    <div className="space-y-3">
      <Field label="Question">
        <Textarea
          rows={3}
          value={str(step.data.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <Field
        label="Accept"
        hint={checked ? 'The answer is checked before the flow goes on.' : 'Any text is accepted.'}
      >
        <Select value={type} onChange={(e) => set({ validate: e.target.value })}>
          {FLB_ASK_INPUT_TYPES.map((v) => (
            <option key={v} value={v}>
              {FLB_ASK_INPUT_LABELS[v]}
            </option>
          ))}
        </Select>
      </Field>
      {type === 'date' ? (
        <Field
          label="Date format"
          hint="How the customer writes the date. It is saved as typed, and a copy as year-month-day in the _iso variable."
        >
          <Select
            value={flbCleanDateFormat(step.data.dateFormat)}
            onChange={(e) => set({ dateFormat: e.target.value })}
          >
            {FLB_DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <VarField step={step} set={set} label="Save the answer in" />
      {checked ? (
        <>
          <WrongAnswerFields
            step={step}
            set={set}
            placeholder={flbAskInputWrongText(type, step.data.dateFormat)}
            defaultRetries="0 keeps asking until the answer is right."
          />
          <SavePropertyField step={step} set={set} />
        </>
      ) : null}
    </div>
  );
}

function AskFileEditor({ step, set }: EditorProps) {
  const chosen = new Set(flbCleanAskFileExtensions(step.data.extensions));
  const toggle = (exts: readonly string[], on: boolean) => {
    const next = new Set(chosen);
    for (const e of exts) {
      if (on) next.add(e);
      else next.delete(e);
    }
    set({ extensions: flbCleanAskFileExtensions([...next]) });
  };
  return (
    <div className="space-y-3">
      <Field label="Question">
        <Textarea
          rows={3}
          value={str(step.data.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <Field
        label="Files accepted"
        hint={
          chosen.size === 0
            ? 'None ticked: any file is accepted.'
            : `Only: ${[...chosen].join(', ')}`
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {FLB_ASK_FILE_GROUPS.map((g) => {
            const exts = g.extensions.map((e) => e.ext);
            return (
              <label key={g.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={exts.every((e) => chosen.has(e))}
                  onChange={(e) => toggle(exts, e.target.checked)}
                />
                {g.label}
              </label>
            );
          })}
        </div>
      </Field>
      <VarField step={step} set={set} label="Save the file link in" />
      <WrongAnswerFields
        step={step}
        set={set}
        placeholder="That is not a file we can accept. Please send it as an attachment."
        defaultRetries="After this many wrong answers the flow moves on (or ends)."
      />
      <SavePropertyField step={step} set={set} />
    </div>
  );
}

function AskLocationEditor({ step, set }: EditorProps) {
  return (
    <div className="space-y-3">
      <Field label="Question">
        <Textarea
          rows={3}
          value={str(step.data.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </Field>
      <VarField step={step} set={set} label="Save the location link in" />
      <WrongAnswerFields
        step={step}
        set={set}
        placeholder="Please share your location with the attachment (+) menu, then Location."
        defaultRetries="After this many wrong answers the flow moves on (or ends)."
      />
    </div>
  );
}

function VarField({
  step,
  set,
  label,
}: {
  step: SimpleStep;
  set: (patch: Record<string, unknown>) => void;
  label: string;
}) {
  return (
    <Field
      label={label}
      hint={
        <>
          Use it later as <code className="font-mono">{`{{${str(step.data.var) || 'name'}}}`}</code>
          . Give every question its own name.
        </>
      }
    >
      <Input
        className="font-mono"
        value={str(step.data.var)}
        onChange={(e) => set({ var: slug(e.target.value) })}
      />
    </Field>
  );
}

function AssignEditor({ step, ctx, set }: EditorProps) {
  const teams = ctx.teams;
  const team = teams.find((t) => t.id === str(step.data.team));
  return (
    <div className="space-y-3">
      <Field label="Team" hint="The conversation lands in this team's queue.">
        <Select
          value={str(step.data.team)}
          onChange={(e) => set({ team: e.target.value, userId: '' })}
        >
          <option value="">{teams.length ? '— pick a team —' : 'No teams yet'}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.members.length ? ` · ${t.members.length} agent(s)` : ''}
            </option>
          ))}
          {str(step.data.team) && !team ? (
            <option value={str(step.data.team)}>
              {str(step.data.team)} (not in this workspace)
            </option>
          ) : null}
        </Select>
      </Field>
      {team ? (
        <Field
          label="A specific agent (optional)"
          hint="Any: the team's own assignment rule picks."
        >
          <Select value={str(step.data.userId)} onChange={(e) => set({ userId: e.target.value })}>
            <option value="">Any</option>
            {team.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Note for the agent" hint="Shown on the conversation when it reaches the team.">
        <Textarea
          rows={3}
          value={str(step.data.message)}
          onChange={(e) => set({ message: e.target.value })}
        />
      </Field>
    </div>
  );
}

function DelayEditor({ step, set }: EditorProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Wait for">
        <Input
          type="number"
          min={1}
          value={str(step.data.amount)}
          onChange={(e) => set({ amount: e.target.value === '' ? '' : Number(e.target.value) })}
        />
      </Field>
      <Field label="Unit">
        <Select
          value={str(step.data.unit) || 'min'}
          onChange={(e) => set({ unit: e.target.value })}
        >
          <option value="sec">seconds</option>
          <option value="min">minutes</option>
          <option value="hour">hours</option>
          <option value="day">days</option>
        </Select>
      </Field>
    </div>
  );
}

function LocationEditor({ step, set }: EditorProps) {
  const f = (key: string, label: string, props: { placeholder?: string } = {}) => (
    <Field label={label}>
      <Input
        value={str(step.data[key])}
        placeholder={props.placeholder}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="space-y-3">
      {f('title', 'Place name', { placeholder: 'Our office' })}
      {f('address', 'Address')}
      <div className="grid grid-cols-2 gap-3">
        {f('lat', 'Latitude', { placeholder: '18.5204' })}
        {f('lng', 'Longitude', { placeholder: '73.8567' })}
      </div>
    </div>
  );
}

function TemplateEditor({ step, ctx, set }: EditorProps) {
  const chosen = ctx.templates.find((t) => t.name === str(step.data.tpl));
  return (
    <div className="space-y-3">
      <Field
        label="Approved template"
        hint="Only templates your WhatsApp number has approved are listed."
      >
        <Select
          value={str(step.data.tpl)}
          onChange={(e) => {
            const hit = ctx.templates.find((t) => t.name === e.target.value);
            set({ tpl: e.target.value, tplId: hit ? hit.id : null });
          }}
        >
          <option value="">Choose a template…</option>
          {ctx.templates.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      {chosen?.body ? (
        <div className="whitespace-pre-wrap rounded-xl bg-[var(--flb-bubble)] p-3 text-[12.5px]">
          {chosen.body}
        </div>
      ) : null}
    </div>
  );
}

function CtaEditor({ step, set }: EditorProps) {
  const a = rec(arr(step.data.actions)[0]);
  const setA = (patch: Record<string, unknown>) =>
    set({ actions: [{ type: 'url', label: '', value: '', ...a, ...patch }] });
  return (
    <div className="space-y-3">
      <Field label="Message">
        <Textarea
          rows={3}
          value={str(step.data.bodyText)}
          onChange={(e) => set({ bodyText: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Button text">
          <Input
            value={str(a.label)}
            maxLength={20}
            onChange={(e) => setA({ label: e.target.value })}
          />
        </Field>
        <Field label="Opens (link)">
          <Input
            value={str(a.value)}
            placeholder="https://"
            onChange={(e) => setA({ value: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-[12px] font-medium text-brand hover:bg-muted"
    >
      <span aria-hidden>+</span> {children}
    </button>
  );
}

function RemoveBtn({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-danger disabled:opacity-30"
    >
      ✕
    </button>
  );
}

export { BRANCHING };
