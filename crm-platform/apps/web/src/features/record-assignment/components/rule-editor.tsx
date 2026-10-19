'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@crm/ui';
import type { AssignmentRule, AssignmentSubject } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  ruleReducer,
  signature,
  useUnsavedGuard,
  type Group,
  type RuleAction,
} from '@/features/segments';
import { assignmentApi } from '../api/assignment';
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  draftChanged,
  draftOf,
  draftProblems,
  emptyDraft,
  toCreateInput,
  toUpdateInput,
  withStrategy,
  type RuleDraft,
} from '../lib/draft';
import { STRATEGIES } from '../lib/subjects';
import {
  conditionProblems,
  groupFromRules,
  rulesFromGroup,
  serverProblemsOf,
  type ServerProblems,
} from '../lib/tree';
import type { CatalogState } from './catalog-gate';
import { ConditionsEditor } from './conditions-editor';
import { PoolPicker, type PoolOption } from './pool-picker';
import { TestBox } from './test-box';
import { useRa } from './use-ra';

export interface RuleEditorProps {
  subject: AssignmentSubject;
  /** The rule being edited; null creates a new one. */
  rule: AssignmentRule | null;
  catalog: CatalogState;
  people: readonly PoolOption[];
  teams: readonly PoolOption[];
  /** The rule was saved (or the latest version should be reloaded after a conflict). */
  onSaved: (message: 'created' | 'saved') => void;
  onConflict: () => void;
  onClose: () => void;
}

const NO_SERVER: ServerProblems = { conditions: {}, fields: {} };

/**
 * The rule form: name, description, the module (fixed once the rule exists), the conditions (the segments rule builder; none = the
 * fallback) and who takes the records. Saving sends the `rowVersion` that was read; a 409 reloads the latest version instead of
 * overwriting it. Leaving with unsaved changes asks first.
 */
export function RuleEditor({
  subject,
  rule,
  catalog,
  people,
  teams,
  onSaved,
  onConflict,
  onClose,
}: RuleEditorProps) {
  const { t } = useRa();
  const initial = useMemo(() => (rule ? draftOf(rule) : emptyDraft(subject)), [rule, subject]);
  const initialRoot = useMemo(() => groupFromRules(rule?.rules), [rule]);
  const initialSignature = useMemo(() => signature(initialRoot), [initialRoot]);
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [root, setRoot] = useState<Group>(initialRoot);
  const [showProblems, setShowProblems] = useState(false);
  const [server, setServer] = useState<ServerProblems>(NO_SERVER);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [released, setReleased] = useState(false);
  const [askCancel, setAskCancel] = useState(false);

  const dirty = !released && (draftChanged(draft, initial) || signature(root) !== initialSignature);
  const guard = useUnsavedGuard(dirty);

  const dispatch = (a: RuleAction) => {
    setServer(NO_SERVER);
    setRoot((r) => ruleReducer(r, a, catalog.catalog));
  };
  const set = (p: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...p }));

  const problems = useMemo(() => conditionProblems(root, catalog.catalog), [root, catalog.catalog]);
  const formProblems = draftProblems(draft);
  const has = (p: (typeof formProblems)[number]) => showProblems && formProblems.includes(p);
  const poolProblem = has('people')
    ? t('editor.problems.people')
    : has('fixedOne')
      ? t('editor.problems.fixedOne')
      : (server.fields['userIds'] ?? server.fields['teamIds']);

  const save = async (event: FormEvent | null, activate: boolean | undefined) => {
    event?.preventDefault();
    setShowProblems(true);
    setFailed(false);
    const built = rulesFromGroup(subject, root, catalog.catalog);
    if (formProblems.length > 0 || !built.ok) return;
    setSaving(true);
    try {
      if (rule)
        await assignmentApi.update(
          rule.id,
          toUpdateInput(draft, built.rules, rule.rowVersion, activate),
        );
      else await assignmentApi.create(toCreateInput(draft, built.rules, activate ?? true));
      setReleased(true);
      guard.release();
      onSaved(rule ? 'saved' : 'created');
    } catch (e) {
      if (e instanceof ApiError && e.isRowVersionConflict) onConflict();
      else if (e instanceof ApiError && e.status === 422 && e.fieldErrors.length > 0)
        setServer(serverProblemsOf(root, e.fieldErrors));
      else setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const leave = () => {
    if (dirty) setAskCancel(true);
    else onClose();
  };

  const incomplete = showProblems && Object.keys(problems).length > 0;

  return (
    <form
      onSubmit={(e) => void save(e, undefined)}
      noValidate
      className="space-y-5 rounded-lg border border-border p-4"
      data-testid="ra-editor"
      aria-label={rule ? t('editor.titleEdit') : t('editor.titleNew')}
    >
      <h3 className="text-base font-semibold">
        {rule ? t('editor.titleEdit') : t('editor.titleNew')}
      </h3>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={t('editor.name')}
          htmlFor="ra-name"
          error={has('name') ? t('editor.problems.name') : server.fields['name']}
        >
          <Input
            id="ra-name"
            value={draft.name}
            maxLength={NAME_MAX}
            invalid={has('name')}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field
          label={t('editor.module')}
          htmlFor="ra-module"
          hint={rule ? t('editor.moduleLocked') : undefined}
        >
          <Select id="ra-module" value={subject} disabled>
            <option value={subject}>{t(`tabs.${subject}`)}</option>
          </Select>
        </Field>
      </div>
      <Field label={t('editor.description')} htmlFor="ra-description">
        <Textarea
          id="ra-description"
          rows={2}
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t('editor.conditions.title')}</legend>
        <p className="text-xs text-muted-foreground">{t('editor.conditions.hint')}</p>
        <ConditionsEditor
          subject={subject}
          root={root}
          catalog={catalog.catalog}
          ready={catalog.ready}
          failed={catalog.failed}
          dispatch={dispatch}
          problems={problems}
          showProblems={showProblems}
          serverProblems={server.conditions}
        />
        {(incomplete || server.fields['rules']) && (
          <p role="alert" className="text-xs text-danger">
            {incomplete ? t('editor.problems.conditions') : server.fields['rules']}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{t('editor.assign.title')}</legend>
        <Field
          label={t('editor.assign.method')}
          htmlFor="ra-method"
          hint={t(strategyHint(draft, subject))}
        >
          <Select
            id="ra-method"
            value={draft.strategy}
            onChange={(e) =>
              setDraft((d) => withStrategy(d, e.target.value as RuleDraft['strategy']))
            }
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {t(`strategy.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <PoolPicker
          strategy={draft.strategy}
          people={people}
          teams={teams}
          userIds={draft.userIds}
          teamIds={draft.teamIds}
          onChange={set}
          problem={poolProblem}
        />
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={draft.skipOffline}
            onCheckedChange={(v) => set({ skipOffline: v })}
            label={t('editor.assign.skipOffline')}
          />
          <span>
            {t('editor.assign.skipOffline')}
            <span className="block text-xs text-muted-foreground">
              {t('editor.assign.skipOfflineHint')}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={draft.reassignOnUpdate}
            onCheckedChange={(v) => set({ reassignOnUpdate: v })}
            label={t('editor.assign.reassign')}
          />
          <span>
            {t('editor.assign.reassign')}
            <span className="block text-xs text-muted-foreground">
              {t('editor.assign.reassignHint')}
            </span>
          </span>
        </label>
      </fieldset>

      {failed && <Alert tone="danger">{t('toast.failed')}</Alert>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={leave} disabled={saving}>
          {t('editor.cancel')}
        </Button>
        {rule ? (
          <>
            <Button
              type="submit"
              variant={rule.isActive ? 'primary' : 'secondary'}
              disabled={saving}
            >
              {saving && <Spinner />}
              {t('editor.save')}
            </Button>
            {!rule.isActive && (
              <Button disabled={saving} onClick={() => void save(null, true)}>
                {t('editor.saveActivate')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={saving} onClick={() => void save(null, false)}>
              {t('editor.savePaused')}
            </Button>
            <Button disabled={saving} onClick={() => void save(null, true)}>
              {saving && <Spinner />}
              {t('editor.saveActivate')}
            </Button>
          </>
        )}
      </div>

      <TestBox subject={subject} />

      <ConfirmDialog
        open={askCancel || guard.pending !== null}
        title={t('editor.unsavedTitle')}
        message={t('editor.unsavedMessage')}
        confirmLabel={t('editor.leave')}
        cancelLabel={t('editor.stay')}
        onConfirm={() => {
          if (askCancel) {
            setAskCancel(false);
            setReleased(true);
            guard.release();
            onClose();
          } else guard.leave();
        }}
        onClose={() => {
          setAskCancel(false);
          guard.stay();
        }}
      />
    </form>
  );
}

function strategyHint(d: RuleDraft, subject: AssignmentSubject): string {
  return d.strategy === 'least_busy'
    ? `strategy.hint.least_busy.${subject}`
    : `strategy.hint.${d.strategy}`;
}
