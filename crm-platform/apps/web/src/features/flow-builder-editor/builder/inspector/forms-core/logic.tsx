'use client';

import {
  FLB_COND_MAX_DEPTH,
  FLB_COND_MAX_RULES,
  flbCondProblems,
  flbCondSummary,
  flbIsCondGroup,
  type FlbCondGroup,
  type FlbCondRule,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import type { ReactNode } from 'react';
import {
  Check,
  controlClass,
  Field,
  IconButton,
  NumberInput,
  PasswordInput,
  SelectInput,
  TextArea,
  TextInput,
  XIcon,
} from '../kit';
import {
  addGroup,
  addRule,
  canAddGroup,
  canAddRule,
  conditionTreeOf,
  depthAt,
  patchRule,
  removeAt,
  setGroupOp,
  type CondPath,
} from '../../../lib/condition-tree';
import type { FormProps } from '../types';
import {
  addConditionRow,
  asArray,
  asRecord,
  patchItem,
  removeConditionRow,
  str,
  subflowLabel,
  withCurrent,
  type ConditionRow,
} from './helpers';
import { AddLink, InfoBox, Link, smallInputClass, V } from './parts';

const OPERATOR_CHOICES = [
  { v: 'equals', l: 'Equal to' },
  { v: 'not_equals', l: 'Not equal to' },
  { v: 'contains', l: 'Contains' },
  { v: 'not_contains', l: 'Does not contain' },
  { v: 'gt', l: 'Greater than' },
  { v: 'lt', l: 'Less than' },
  { v: 'exists', l: 'Is set' },
];

const joinerClass = (active: boolean, or: boolean) =>
  cn(
    'px-3 py-1 transition',
    active
      ? or
        ? 'bg-amber-400 text-foreground'
        : 'bg-brand text-white'
      : 'text-foreground/70 hover:bg-background',
  );

function RuleCard({
  rule,
  label,
  onPatch,
  onRemove,
  flagged,
}: {
  rule: FlbCondRule;
  label: string;
  onPatch: (patch: Partial<FlbCondRule>) => void;
  onRemove: () => void;
  flagged: boolean;
}) {
  const operator = rule.operator || 'equals';
  return (
    <div
      className={cn(
        'mb-2 rounded-lg border bg-background p-2',
        flagged ? 'border-[#E87A5D]' : 'border-border',
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
        <div className="flex-1" />
        <IconButton title="Remove rule" danger onClick={onRemove}>
          <XIcon />
        </IconButton>
      </div>
      <input
        type="text"
        value={str(rule.variable)}
        onChange={(e) => onPatch({ variable: e.target.value })}
        placeholder="Variable name (e.g. plan)"
        className={cn(controlClass, 'mb-1.5')}
      />
      {flagged ? (
        <div className="mb-1.5 text-[11px] text-[#E87A5D]">Pick the variable to test.</div>
      ) : null}
      <select
        value={operator}
        onChange={(e) => onPatch({ operator: e.target.value })}
        className={cn(controlClass, 'mb-1.5')}
      >
        {OPERATOR_CHOICES.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
      {operator !== 'exists' ? (
        <input
          type="text"
          value={str(rule.value)}
          onChange={(e) => onPatch({ value: e.target.value })}
          placeholder="Compare against…"
          className={controlClass}
        />
      ) : null}
    </div>
  );
}

function GroupEditor({
  root,
  group,
  path,
  onChange,
}: {
  root: FlbCondGroup;
  group: FlbCondGroup;
  path: CondPath;
  onChange: (next: FlbCondGroup) => void;
}) {
  const isRoot = path.length === 0;
  const depth = depthAt(path);
  const canRule = canAddRule(root);
  const canGroup = canAddGroup(path);
  const or = group.op === 'or';
  return (
    <div
      data-cond-group={depth}
      className={cn(!isRoot && 'mb-2 ml-1 border-l-2 border-border pl-2')}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-full border border-border bg-muted text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => onChange(setGroupOp(root, path, 'and'))}
            className={joinerClass(!or, false)}
          >
            AND
          </button>
          <button
            type="button"
            onClick={() => onChange(setGroupOp(root, path, 'or'))}
            className={joinerClass(or, true)}
          >
            OR
          </button>
        </div>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {group.items.length === 0 ? 'Empty group: always false' : flbCondSummary(group)}
        </span>
        {!isRoot ? (
          <IconButton title="Remove group" danger onClick={() => onChange(removeAt(root, path))}>
            <XIcon />
          </IconButton>
        ) : null}
      </div>
      {group.items.map((item, i) => {
        const childPath = [...path, i];
        return flbIsCondGroup(item) ? (
          <GroupEditor key={i} root={root} group={item} path={childPath} onChange={onChange} />
        ) : (
          <RuleCard
            key={i}
            rule={item}
            label={`Rule ${i + 1}`}
            flagged={!item.variable.trim()}
            onPatch={(patch) => onChange(patchRule(root, childPath, patch))}
            onRemove={() => onChange(removeAt(root, childPath))}
          />
        );
      })}
      {group.items.length === 0 ? (
        <div className="mb-2 text-[11px] text-[#E87A5D]">
          This group has no rules, so it is always false. Add a rule or remove the group.
        </div>
      ) : null}
      <div className="flex gap-3">
        <GroupAction disabled={!canRule} onClick={() => onChange(addRule(root, path))}>
          Add rule
        </GroupAction>
        <GroupAction disabled={!canGroup} onClick={() => onChange(addGroup(root, path))}>
          Add group
        </GroupAction>
      </div>
    </div>
  );
}

function GroupAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
    >
      + {children}
    </button>
  );
}

/**
 * The Condition inspector. A node edits a nested tree of AND/OR groups (`conditionGroup`, beyond WaDesk); a node that only has the
 * flat chain is shown as the equal tree and saved as `conditionGroup` on its first edit (the flat arrays are left as they were and
 * ignored by the runtime). A flat chain too long or too alternating for the tree limits keeps the flat editor.
 */
export function ConditionForm(props: FormProps) {
  const model = conditionTreeOf(props.data);
  if (!model) return <FlatConditionForm {...props} />;
  const { tree, from } = model;
  const problems = flbCondProblems(tree);
  return (
    <>
      <InfoBox>
        Rules are grouped. Each group combines its rules and sub-groups with <b>AND</b> (all must
        match) or <b>OR</b> (any can match). The whole tree either evaluates to TRUE (then the{' '}
        <span className="font-mono text-brand">IF · true</span> port fires) or FALSE (then the{' '}
        <span className="font-mono text-[#E87A5D]">ELSE · false</span> port fires). Groups nest up
        to {FLB_COND_MAX_DEPTH} levels, with at most {FLB_COND_MAX_RULES} rules in total.
        {from === 'flat' ? ' This node still uses the old flat list until you edit it here.' : ''}
      </InfoBox>
      <GroupEditor
        root={tree}
        group={tree}
        path={[]}
        onChange={(next) => props.setMany({ conditionGroup: next })}
      />
      {problems.incompleteRules + problems.emptyGroups > 0 ? (
        <div className="mt-2 text-[11px] text-[#E87A5D]">
          {problems.incompleteRules > 0
            ? `${problems.incompleteRules} rule(s) have no variable. `
            : ''}
          {problems.emptyGroups > 0 ? `${problems.emptyGroups} empty group(s).` : ''}
        </div>
      ) : null}
    </>
  );
}

function FlatConditionForm({ data: d, setMany }: FormProps) {
  const conds = asArray(d.conditions).map(asRecord) as ConditionRow[];
  const ops = asArray(d.operators).map(String);
  const updateRow = (i: number, patch: Partial<ConditionRow>) =>
    setMany({ conditions: patchItem(conds, i, patch) });
  const setLogic = (i: number, val: 'AND' | 'OR') => {
    const next = ops.slice();
    next[i] = val;
    setMany({ operators: next });
  };
  return (
    <>
      <InfoBox>
        All the rules below are combined into ONE expression using the <b>AND</b> / <b>OR</b>{' '}
        toggles. The whole expression either evaluates to TRUE (then the{' '}
        <span className="font-mono text-brand">IF · true</span> port fires) or FALSE (then the{' '}
        <span className="font-mono text-[#E87A5D]">ELSE · false</span> port fires). Add rules to
        make it more specific; chain with <b>AND</b> (all must match) or <b>OR</b> (any can match).
      </InfoBox>
      {conds.map((c, i) => {
        const joiner = ops[i - 1] || 'AND';
        const operator = c.operator || 'equals';
        return (
          <div key={i}>
            {i > 0 ? (
              <div className="my-1.5 flex justify-center">
                <div className="inline-flex overflow-hidden rounded-full border border-border bg-muted text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setLogic(i - 1, 'AND')}
                    className={cn(
                      'px-3 py-1 transition',
                      joiner === 'AND'
                        ? 'bg-brand text-white'
                        : 'text-foreground/70 hover:bg-background',
                    )}
                  >
                    AND
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogic(i - 1, 'OR')}
                    className={cn(
                      'px-3 py-1 transition',
                      joiner === 'OR'
                        ? 'bg-amber-400 text-foreground'
                        : 'text-foreground/70 hover:bg-background',
                    )}
                  >
                    OR
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mb-2 rounded-lg border border-border bg-background p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">Rule {i + 1}</span>
                <div className="flex-1" />
                {conds.length > 1 ? (
                  <IconButton
                    title="Remove"
                    danger
                    onClick={() => setMany(removeConditionRow(conds, ops, i))}
                  >
                    <XIcon />
                  </IconButton>
                ) : null}
              </div>
              <input
                type="text"
                value={str(c.variable)}
                onChange={(e) => updateRow(i, { variable: e.target.value })}
                placeholder="Variable name (e.g. plan)"
                className={cn(controlClass, 'mb-1.5')}
              />
              <select
                value={operator}
                onChange={(e) => updateRow(i, { operator: e.target.value })}
                className={cn(controlClass, 'mb-1.5')}
              >
                {OPERATOR_CHOICES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
              {operator !== 'exists' ? (
                <input
                  type="text"
                  value={str(c.value)}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  placeholder="Compare against…"
                  className={controlClass}
                />
              ) : null}
            </div>
          </div>
        );
      })}
      <AddLink onClick={() => setMany(addConditionRow(conds, ops))}>Add rule</AddLink>
    </>
  );
}

export function DelayForm({ data: d, set }: FormProps) {
  return (
    <>
      <Field label="Amount">
        <NumberInput value={d.amount} placeholder="5" onChange={(v) => set('amount', v)} />
      </Field>
      <Field label="Unit">
        <SelectInput
          value={d.unit}
          options={[
            { v: 'sec', l: 'seconds' },
            { v: 'min', l: 'minutes' },
            { v: 'hour', l: 'hours' },
            { v: 'day', l: 'days' },
          ]}
          onChange={(v) => set('unit', v)}
        />
      </Field>
    </>
  );
}

interface Header {
  key?: string;
  value?: string;
}

export function WebhookForm({ data: d, set }: FormProps) {
  const hdrs = asArray(d.headers).map(asRecord) as Header[];
  return (
    <>
      <Field label="Method">
        <SelectInput
          value={d.method}
          options={['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ v: m, l: m }))}
          onChange={(v) => set('method', v)}
        />
      </Field>
      <Field label="URL">
        <TextInput
          value={d.url}
          placeholder="https://api.example.com/stock?field={{field}}"
          onChange={(v) => set('url', v)}
        />
      </Field>
      <Field
        label="Headers"
        hint="e.g. Authorization → Bearer {{api_token}}. Values can use {{variables}}."
      >
        {hdrs.map((h, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <input
              type="text"
              value={str(h.key)}
              onChange={(e) => set('headers', patchItem(hdrs, i, { key: e.target.value }))}
              placeholder="Header"
              className={cn(smallInputClass, '!w-2/5')}
            />
            <TextInput
              value={h.value}
              onChange={(v) => set('headers', patchItem(hdrs, i, { value: v }))}
              placeholder="Value"
              className={cn(smallInputClass, 'flex-1')}
            />
            <button
              type="button"
              title="Remove"
              onClick={() =>
                set(
                  'headers',
                  hdrs.filter((_, j) => j !== i),
                )
              }
              className="shrink-0 px-1 text-[16px] leading-none text-[#E87A5D]"
            >
              ×
            </button>
          </div>
        ))}
        <AddLink onClick={() => set('headers', [...hdrs, { key: '', value: '' }])}>
          Add header
        </AddLink>
      </Field>
      <Field label="Content type">
        <SelectInput
          value={d.contentType}
          options={[
            { v: 'application/json', l: 'JSON' },
            { v: 'application/x-www-form-urlencoded', l: 'Form URL-encoded' },
            { v: 'text/plain', l: 'Plain text' },
          ]}
          onChange={(v) => set('contentType', v)}
        />
      </Field>
      <Field label="Body" hint="Sent for POST/PUT/PATCH. {{variables}} are substituted.">
        <TextArea
          value={d.body}
          placeholder={'{ "field": "{{field}}" }'}
          rows={4}
          onChange={(v) => set('body', v)}
        />
      </Field>
      <Field
        label="Save response to"
        hint={
          <>
            The API&apos;s response is stored in this variable for later nodes (e.g. <V>response</V>
            ).
          </>
        }
      >
        <TextInput value={d.save} placeholder="response" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

const codeVar = (t: string) => <span className="font-mono text-[#7CF3C4]">{t}</span>;

export function CodeForm({ data: d, set }: FormProps) {
  const save = str(d.save) || 'result';
  return (
    <>
      <div className="mb-1 rounded-lg border border-border bg-[#1E2A33] p-2.5 text-[11px] leading-relaxed text-[#C7D2CC]">
        Runs sandboxed JavaScript. Available: {codeVar('previousResponse')},{' '}
        {codeVar('allResponses')}, {codeVar('functionArgs')}. {codeVar('return')} an object to save
        it.
      </div>
      <Field label="JavaScript" hint="No file / network / require access. CPU + memory are capped.">
        <textarea
          value={str(d.code)}
          onChange={(e) => set('code', e.target.value)}
          rows={12}
          spellCheck={false}
          className={cn(
            controlClass,
            'bg-[#0F1720] font-mono text-[12px] leading-relaxed text-[#D7E3DC]',
          )}
        />
      </Field>
      <Field
        label="Save return value to"
        hint={
          <>
            Later nodes read it as <V>{save}</V> (or <V>{`${save}.FIELD`}</V> for object fields).
          </>
        }
      >
        <TextInput value={d.save} placeholder="result" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

export function MysqlForm({ data: d, set }: FormProps) {
  return (
    <>
      <div className="mb-1 rounded-lg border border-border bg-muted/60 p-2.5 text-[11px] text-foreground/70">
        Read-only — only <span className="font-mono text-brand">SELECT</span> queries run.
        Credentials are stored encrypted and only used to fetch data for the reply.
      </div>
      <Field label="Host">
        <TextInput value={d.host} placeholder="db.yoursite.com" onChange={(v) => set('host', v)} />
      </Field>
      <Field label="Port">
        <TextInput value={d.port} placeholder="3306" onChange={(v) => set('port', v)} />
      </Field>
      <Field label="Database">
        <TextInput
          value={d.database}
          placeholder="my_database"
          onChange={(v) => set('database', v)}
        />
      </Field>
      <Field label="Username">
        <TextInput value={d.username} placeholder="db_user" onChange={(v) => set('username', v)} />
      </Field>
      <Field label="Password">
        <PasswordInput
          value={d.password}
          placeholder="••••••••"
          onChange={(v) => set('password', v)}
        />
      </Field>
      <Field
        label="SQL query"
        hint="SELECT only. Use {{variables}} from earlier nodes (e.g. an AI-extracted field code)."
      >
        <TextArea
          value={d.sql}
          placeholder="SELECT qty FROM stock WHERE field = {{field}}"
          rows={4}
          onChange={(v) => set('sql', v)}
        />
      </Field>
      <Field
        label="Save rows to"
        hint={
          <>
            Returned rows (JSON) are stored here — an AI / message node can then read <V>rows</V>{' '}
            and answer the customer.
          </>
        }
      >
        <TextInput value={d.save} placeholder="rows" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

export function AiForm({ data: d, set, env }: FormProps) {
  const { aiModels, assistants } = env.ctx;
  const modelOpts = withCurrent(
    aiModels.length
      ? [{ v: '', l: '— pick model —' }, ...aiModels.map((m) => ({ v: m.value, l: m.label }))]
      : [{ v: '', l: 'No AI models enabled — ask admin to switch one on' }],
    d.model,
    (v) => `${v} (not enabled)`,
  );
  const assistantOpts = withCurrent(
    [
      { v: '', l: '— none (use the prompt above only) —' },
      ...assistants.map((a) => ({
        v: a.id,
        l: `${a.name} · ${a.sources} source${a.sources === 1 ? '' : 's'}`,
      })),
    ],
    d.assistant,
    (v) => `(assistant ${v.slice(0, 8)})`,
  );
  const picked = assistants.find((a) => a.id === str(d.assistant));
  const aiSave = str(d.save) || 'reply';

  const assistantHint = !assistants.length ? (
    <>
      No trained assistants yet — create one in <Link href="/ai-training">AI Training</Link>.
    </>
  ) : picked && picked.sources === 0 ? (
    <>
      Note: this assistant has 0 trained sources — add some in{' '}
      <Link href="/ai-training">AI Training</Link> or the reply uses the prompt only.
    </>
  ) : (
    <>
      Pulls the chosen assistant&apos;s trained content into this reply.{' '}
      <Link href="/ai-training">Manage knowledge →</Link>
    </>
  );

  return (
    <>
      <Field
        label="Model"
        hint={
          aiModels.length ? (
            'Models the admin enabled — plus any provider you added your own key for (Settings → AI keys, on BYOK plans).'
          ) : (
            <>
              No provider available yet. Add your own key in{' '}
              <Link href="/settings">Settings → AI keys</Link> (BYOK plans), or ask your admin to
              enable one.
            </>
          )
        }
      >
        <SelectInput value={d.model} options={modelOpts} onChange={(v) => set('model', v)} />
      </Field>
      <Field label="System prompt">
        <TextArea value={d.prompt} rows={5} onChange={(v) => set('prompt', v)} />
      </Field>
      <Field
        label="Save response to"
        hint={
          <>
            Later nodes read it as <V>{aiSave}</V> — or <V>{`${aiSave}.FIELD`}</V> when extracting.
          </>
        }
      >
        <TextInput value={d.save} placeholder="reply" onChange={(v) => set('save', v)} />
      </Field>
      <Field label="Knowledge base (optional)" hint={assistantHint}>
        <SelectInput
          value={d.assistant}
          options={assistantOpts}
          onChange={(v) => set('assistant', v)}
        />
      </Field>
      <div className="mb-1 mt-1">
        <Check checked={!!d.extract} onChange={(v) => set('extract', v)}>
          <strong>Extract structured data (JSON)</strong> — turn the message into fields
        </Check>
      </div>
      {d.extract ? (
        <Field
          label="Fields to extract"
          hint={
            <>
              Comma-separated keys. The AI returns ONE JSON object; each key becomes{' '}
              <V>{`${aiSave}.KEY`}</V> (and <V>{`${aiSave}.__rows`}</V> when several records are
              detected — e.g. for a Google Sheets node).
            </>
          }
        >
          <TextInput
            value={d.fields}
            placeholder="FARM, DATE, NAME, FIELD, RATE, VOLUME, EARNINGS"
            onChange={(v) => set('fields', v)}
          />
        </Field>
      ) : null}
      <div className="mt-1">
        <Check checked={!!d.silent} onChange={(v) => set('silent', v)}>
          <strong>Silent</strong> — don&apos;t send a reply to the customer (extraction only)
        </Check>
      </div>
      <div className="mt-2">
        <Check checked={!!d.conversational} onChange={(v) => set('conversational', v)}>
          <strong>Conversation mode</strong> — the AI keeps replying to every message (drives the
          whole chat) instead of answering once
        </Check>
      </div>
      {d.conversational ? (
        <Field
          label="Exit keyword (optional)"
          className="mt-4"
          hint="When the customer types exactly this, the AI hands back and the flow continues to the next node. Leave blank to let the AI run the whole conversation."
        >
          <TextInput
            value={d.exit_keyword}
            placeholder="menu"
            onChange={(v) => set('exit_keyword', v)}
          />
        </Field>
      ) : null}
    </>
  );
}

export function SubflowForm({ data: d, set, env }: FormProps) {
  const opts = withCurrent(
    [
      { v: '', l: env.loading ? 'Loading flows…' : '— pick flow —' },
      // A flow cannot run itself: the flow being edited is not offered.
      ...env.ctx.flows
        .filter((f) => f.id !== env.flowId)
        .map((f) => ({ v: f.id, l: subflowLabel(f.name, f.isPublished) })),
    ],
    d.flow,
    (v) => `Flow ${v.slice(0, 8)} (not in workspace)`,
  );
  return (
    <Field
      label="Flow to run"
      hint="Pick another saved flow. When this node fires, that flow runs end-to-end before control returns to the next node here."
    >
      <SelectInput value={d.flow} options={opts} onChange={(v) => set('flow', v)} />
    </Field>
  );
}

export function EndForm() {
  return (
    <div className="text-[12.5px] leading-relaxed text-foreground/80">
      This node terminates the flow. Anything connected after it won&apos;t run.
    </div>
  );
}
