'use client';

import {
  FLB_COND_MAX_DEPTH,
  FLB_COND_MAX_RULES,
  flbCondProblems,
  flbIsCondGroup,
  type FlbCondGroup,
  type FlbCondRule,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { condSummary } from '../../../lib/contract-text';
import { useFlb } from '../../../lib/msg';
import type { ReactNode } from 'react';
import {
  Check,
  controlClass,
  Field,
  IconButton,
  KnowledgeBaseActions,
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

/** The operator ids; their labels are the messages `logic.operator.<id>`. */
const OPERATOR_CHOICES = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'lt',
  'exists',
] as const;

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
  const t = useTranslations('flb.builder.formsCore.logic');
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
        <IconButton title={t('removeRule')} danger onClick={onRemove}>
          <XIcon />
        </IconButton>
      </div>
      <input
        type="text"
        value={str(rule.variable)}
        onChange={(e) => onPatch({ variable: e.target.value })}
        placeholder={t('variablePlaceholder')}
        className={cn(controlClass, 'mb-1.5')}
      />
      {flagged ? (
        <div className="mb-1.5 text-[11px] text-[#E87A5D]">{t('pickVariable')}</div>
      ) : null}
      <select
        value={operator}
        onChange={(e) => onPatch({ operator: e.target.value })}
        className={cn(controlClass, 'mb-1.5')}
      >
        {OPERATOR_CHOICES.map((o) => (
          <option key={o} value={o}>
            {t(`operator.${o}`)}
          </option>
        ))}
      </select>
      {operator !== 'exists' ? (
        <input
          type="text"
          value={str(rule.value)}
          onChange={(e) => onPatch({ value: e.target.value })}
          placeholder={t('comparePlaceholder')}
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
  const t = useTranslations('flb.builder.formsCore.logic');
  const tf = useFlb();
  const isRoot = path.length === 0;
  const depth = depthAt(path);
  const canRule = canAddRule(root);
  const canGroup = canAddGroup(path);
  const or = group.op === 'or';
  return (
    <div
      data-cond-group={depth}
      className={cn(!isRoot && 'mb-2 ms-1 border-s-2 border-border ps-2')}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-full border border-border bg-muted text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => onChange(setGroupOp(root, path, 'and'))}
            className={joinerClass(!or, false)}
          >
            {t('joinerAnd')}
          </button>
          <button
            type="button"
            onClick={() => onChange(setGroupOp(root, path, 'or'))}
            className={joinerClass(or, true)}
          >
            {t('joinerOr')}
          </button>
        </div>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {group.items.length === 0 ? t('emptyGroupSummary') : condSummary(tf, group)}
        </span>
        {!isRoot ? (
          <IconButton
            title={t('removeGroup')}
            danger
            onClick={() => onChange(removeAt(root, path))}
          >
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
            label={t('ruleLabel', { n: i + 1 })}
            flagged={!item.variable.trim()}
            onPatch={(patch) => onChange(patchRule(root, childPath, patch))}
            onRemove={() => onChange(removeAt(root, childPath))}
          />
        );
      })}
      {group.items.length === 0 ? (
        <div className="mb-2 text-[11px] text-[#E87A5D]">{t('emptyGroupWarning')}</div>
      ) : null}
      <div className="flex gap-3">
        <GroupAction disabled={!canRule} onClick={() => onChange(addRule(root, path))}>
          {t('addRule')}
        </GroupAction>
        <GroupAction disabled={!canGroup} onClick={() => onChange(addGroup(root, path))}>
          {t('addGroup')}
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

/** Rich tags of the two condition info boxes: bold AND/OR and the coloured port names. */
const conditionRich = {
  b: (chunks: ReactNode) => <b>{chunks}</b>,
  ifPort: (chunks: ReactNode) => <span className="font-mono text-brand">{chunks}</span>,
  elsePort: (chunks: ReactNode) => <span className="font-mono text-[#E87A5D]">{chunks}</span>,
};

/**
 * The Condition inspector. A node edits a nested tree of AND/OR groups (`conditionGroup`, beyond Reference); a node that only has the
 * flat chain is shown as the equal tree and saved as `conditionGroup` on its first edit (the flat arrays are left as they were and
 * ignored by the runtime). A flat chain too long or too alternating for the tree limits keeps the flat editor.
 */
/** The nested AND / OR rules of a Condition, as one editor (the Simple builder's Condition step shows the same one). */
export function ConditionGroupEditor({
  tree,
  onChange,
}: {
  tree: FlbCondGroup;
  onChange: (next: FlbCondGroup) => void;
}) {
  return <GroupEditor root={tree} group={tree} path={[]} onChange={onChange} />;
}

export function ConditionForm(props: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
  const model = conditionTreeOf(props.data);
  if (!model) return <FlatConditionForm {...props} />;
  const { tree, from } = model;
  const problems = flbCondProblems(tree);
  return (
    <>
      <InfoBox>
        {t.rich('conditionTreeInfo', {
          ...conditionRich,
          depth: FLB_COND_MAX_DEPTH,
          rules: FLB_COND_MAX_RULES,
          flat: from === 'flat' ? 'true' : 'false',
        })}
      </InfoBox>
      <GroupEditor
        root={tree}
        group={tree}
        path={[]}
        onChange={(next) => props.setMany({ conditionGroup: next })}
      />
      {problems.incompleteRules + problems.emptyGroups > 0 ? (
        <div className="mt-2 text-[11px] text-[#E87A5D]">
          {[
            problems.incompleteRules > 0
              ? t('problemRules', { count: problems.incompleteRules })
              : '',
            problems.emptyGroups > 0 ? t('problemGroups', { count: problems.emptyGroups }) : '',
          ]
            .filter(Boolean)
            .join(' ')}
        </div>
      ) : null}
    </>
  );
}

function FlatConditionForm({ data: d, setMany }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
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
      <InfoBox>{t.rich('flatInfo', conditionRich)}</InfoBox>
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
                    {t('joinerAnd')}
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
                    {t('joinerOr')}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mb-2 rounded-lg border border-border bg-background p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {t('ruleLabel', { n: i + 1 })}
                </span>
                <div className="flex-1" />
                {conds.length > 1 ? (
                  <IconButton
                    title={t('remove')}
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
                placeholder={t('variablePlaceholder')}
                className={cn(controlClass, 'mb-1.5')}
              />
              <select
                value={operator}
                onChange={(e) => updateRow(i, { operator: e.target.value })}
                className={cn(controlClass, 'mb-1.5')}
              >
                {OPERATOR_CHOICES.map((o) => (
                  <option key={o} value={o}>
                    {t(`operator.${o}`)}
                  </option>
                ))}
              </select>
              {operator !== 'exists' ? (
                <input
                  type="text"
                  value={str(c.value)}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  placeholder={t('comparePlaceholder')}
                  className={controlClass}
                />
              ) : null}
            </div>
          </div>
        );
      })}
      <AddLink onClick={() => setMany(addConditionRow(conds, ops))}>{t('addRule')}</AddLink>
    </>
  );
}

export function DelayForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
  return (
    <>
      <Field label={t('delayAmount')}>
        <NumberInput value={d.amount} placeholder="5" onChange={(v) => set('amount', v)} />
      </Field>
      <Field label={t('delayUnit')}>
        <SelectInput
          value={d.unit}
          options={[
            { v: 'sec', l: t('unitSec') },
            { v: 'min', l: t('unitMin') },
            { v: 'hour', l: t('unitHour') },
            { v: 'day', l: t('unitDay') },
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
  const t = useTranslations('flb.builder.formsCore.logic');
  const hdrs = asArray(d.headers).map(asRecord) as Header[];
  return (
    <>
      <Field label={t('webhookMethod')}>
        <SelectInput
          value={d.method}
          options={['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ v: m, l: m }))}
          onChange={(v) => set('method', v)}
        />
      </Field>
      <Field label={t('webhookUrl')}>
        <TextInput
          value={d.url}
          placeholder="https://api.example.com/stock?field={{field}}"
          onChange={(v) => set('url', v)}
        />
      </Field>
      <Field label={t('webhookHeaders')} hint={t('webhookHeadersHint')}>
        {hdrs.map((h, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <input
              type="text"
              value={str(h.key)}
              onChange={(e) => set('headers', patchItem(hdrs, i, { key: e.target.value }))}
              placeholder={t('webhookHeaderName')}
              className={cn(smallInputClass, '!w-2/5')}
            />
            <TextInput
              value={h.value}
              onChange={(v) => set('headers', patchItem(hdrs, i, { value: v }))}
              placeholder={t('webhookHeaderValue')}
              className={cn(smallInputClass, 'flex-1')}
            />
            <button
              type="button"
              title={t('remove')}
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
          {t('webhookAddHeader')}
        </AddLink>
      </Field>
      <Field label={t('webhookContentType')}>
        <SelectInput
          value={d.contentType}
          options={[
            { v: 'application/json', l: t('contentJson') },
            { v: 'application/x-www-form-urlencoded', l: t('contentForm') },
            { v: 'text/plain', l: t('contentPlain') },
          ]}
          onChange={(v) => set('contentType', v)}
        />
      </Field>
      <Field label={t('webhookBody')} hint={t('webhookBodyHint')}>
        <TextArea
          value={d.body}
          placeholder={'{ "field": "{{field}}" }'}
          rows={4}
          onChange={(v) => set('body', v)}
        />
      </Field>
      <Field
        label={t('webhookSave')}
        hint={t.rich('webhookSaveHint', { v: (chunks) => <V>{chunks}</V> })}
      >
        <TextInput value={d.save} placeholder="response" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

const codeVar = (chunks: ReactNode) => <span className="font-mono text-[#7CF3C4]">{chunks}</span>;

export function CodeForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
  const save = str(d.save) || 'result';
  return (
    <>
      <div className="mb-1 rounded-lg border border-border bg-[#1E2A33] p-2.5 text-[11px] leading-relaxed text-[#C7D2CC]">
        {t.rich('codeInfo', { code: codeVar })}
      </div>
      <Field label={t('codeLabel')} hint={t('codeHint')}>
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
        label={t('codeSave')}
        hint={t.rich('codeSaveHint', {
          v: (chunks) => <V>{chunks}</V>,
          save,
          path: `${save}.FIELD`,
        })}
      >
        <TextInput value={d.save} placeholder="result" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

export function MysqlForm({ data: d, set }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
  return (
    <>
      <div className="mb-1 rounded-lg border border-border bg-muted/60 p-2.5 text-[11px] text-foreground/70">
        {t.rich('mysqlInfo', {
          code: (chunks) => <span className="font-mono text-brand">{chunks}</span>,
        })}
      </div>
      <Field label={t('mysqlHost')}>
        <TextInput value={d.host} placeholder="db.yoursite.com" onChange={(v) => set('host', v)} />
      </Field>
      <Field label={t('mysqlPort')}>
        <TextInput value={d.port} placeholder="3306" onChange={(v) => set('port', v)} />
      </Field>
      <Field label={t('mysqlDatabase')}>
        <TextInput
          value={d.database}
          placeholder="my_database"
          onChange={(v) => set('database', v)}
        />
      </Field>
      <Field label={t('mysqlUsername')}>
        <TextInput value={d.username} placeholder="db_user" onChange={(v) => set('username', v)} />
      </Field>
      <Field label={t('mysqlPassword')}>
        <PasswordInput
          value={d.password}
          placeholder="••••••••"
          onChange={(v) => set('password', v)}
        />
      </Field>
      <Field label={t('mysqlSql')} hint={t('mysqlSqlHint')}>
        <TextArea
          value={d.sql}
          placeholder="SELECT qty FROM stock WHERE field = {{field}}"
          rows={4}
          onChange={(v) => set('sql', v)}
        />
      </Field>
      <Field
        label={t('mysqlSave')}
        hint={t.rich('mysqlSaveHint', { v: (chunks) => <V>{chunks}</V> })}
      >
        <TextInput value={d.save} placeholder="rows" onChange={(v) => set('save', v)} />
      </Field>
    </>
  );
}

export function AiForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
  const { aiModels, assistants } = env.ctx;
  const modelOpts = withCurrent(
    aiModels.length
      ? [{ v: '', l: t('aiModelPick') }, ...aiModels.map((m) => ({ v: m.value, l: m.label }))]
      : [{ v: '', l: t('aiModelNone') }],
    d.model,
    (v) => t('aiModelNotEnabled', { value: v }),
  );
  const assistantOpts = withCurrent(
    [
      { v: '', l: t('aiAssistantNone') },
      ...assistants.map((a) => ({
        v: a.id,
        l: t('aiAssistantOption', { name: a.name, count: a.sources }),
      })),
    ],
    d.assistant,
    (v) => t('aiAssistantMissing', { id: v.slice(0, 8) }),
  );
  const picked = assistants.find((a) => a.id === str(d.assistant));
  const aiSave = str(d.save) || 'reply';
  const trainingLink = (chunks: ReactNode) => (
    <Link href="/ai-training" newTab>
      {chunks}
    </Link>
  );
  const v = (chunks: ReactNode) => <V>{chunks}</V>;

  const assistantHint = !assistants.length
    ? t.rich('aiAssistantHintNone', { link: trainingLink })
    : picked && picked.sources === 0
      ? t.rich('aiAssistantHintEmpty', { link: trainingLink })
      : t.rich('aiAssistantHint', { link: trainingLink });

  return (
    <>
      <Field
        label={t('aiModelLabel')}
        hint={
          aiModels.length
            ? t('aiModelHint')
            : t.rich('aiModelHintNone', {
                link: (chunks) => <Link href="/settings">{chunks}</Link>,
              })
        }
      >
        <SelectInput value={d.model} options={modelOpts} onChange={(x) => set('model', x)} />
      </Field>
      <Field label={t('aiPrompt')}>
        <TextArea value={d.prompt} rows={5} onChange={(x) => set('prompt', x)} />
      </Field>
      <Field
        label={t('aiSave')}
        hint={t.rich('aiSaveHint', { v, save: aiSave, path: `${aiSave}.FIELD` })}
      >
        <TextInput value={d.save} placeholder="reply" onChange={(x) => set('save', x)} />
      </Field>
      <Field label={t('aiAssistantLabel')} hint={assistantHint}>
        <SelectInput
          value={d.assistant}
          options={assistantOpts}
          onChange={(x) => set('assistant', x)}
        />
        <KnowledgeBaseActions refresh={() => env.refresh()} />
      </Field>
      <div className="mb-1 mt-1">
        <Check checked={!!d.extract} onChange={(x) => set('extract', x)}>
          {t.rich('aiExtract', { strong: (chunks) => <strong>{chunks}</strong> })}
        </Check>
      </div>
      {d.extract ? (
        <Field
          label={t('aiFields')}
          hint={t.rich('aiFieldsHint', {
            v,
            key: `${aiSave}.KEY`,
            rows: `${aiSave}.__rows`,
          })}
        >
          <TextInput
            value={d.fields}
            placeholder="FARM, DATE, NAME, FIELD, RATE, VOLUME, EARNINGS"
            onChange={(x) => set('fields', x)}
          />
        </Field>
      ) : null}
      <div className="mt-1">
        <Check checked={!!d.silent} onChange={(x) => set('silent', x)}>
          {t.rich('aiSilent', { strong: (chunks) => <strong>{chunks}</strong> })}
        </Check>
      </div>
      <div className="mt-2">
        <Check checked={!!d.conversational} onChange={(x) => set('conversational', x)}>
          {t.rich('aiConversation', { strong: (chunks) => <strong>{chunks}</strong> })}
        </Check>
      </div>
      {d.conversational ? (
        <Field label={t('aiExit')} className="mt-4" hint={t('aiExitHint')}>
          <TextInput
            value={d.exit_keyword}
            placeholder="menu"
            onChange={(x) => set('exit_keyword', x)}
          />
        </Field>
      ) : null}
    </>
  );
}

export function SubflowForm({ data: d, set, env }: FormProps) {
  const t = useTranslations('flb.builder.formsCore.logic');
  const th = useTranslations('flb.builder.formsCore.helpers');
  const opts = withCurrent(
    [
      { v: '', l: env.loading ? t('subflowLoading') : t('subflowPick') },
      // A flow cannot run itself: the flow being edited is not offered.
      ...env.ctx.flows
        .filter((f) => f.id !== env.flowId)
        .map((f) => ({ v: f.id, l: subflowLabel(th, f.name, f.isPublished) })),
    ],
    d.flow,
    (v) => t('subflowMissing', { id: v.slice(0, 8) }),
  );
  return (
    <Field label={t('subflowLabel')} hint={t('subflowHint')}>
      <SelectInput value={d.flow} options={opts} onChange={(v) => set('flow', v)} />
    </Field>
  );
}

export function EndForm() {
  const t = useTranslations('flb.builder.formsCore.logic');
  return <div className="text-[12.5px] leading-relaxed text-foreground/80">{t('endInfo')}</div>;
}
