'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSegmentCatalog } from '../api/lookups';
import { ruleReducer, type RuleAction } from '../lib/builder';
import { kindLookup, type FieldDef } from '../lib/fields';
import {
  MAX_CONDITIONS,
  conditionsOf,
  countConditions,
  pruneIncomplete,
  valueProblem,
  type Group,
} from '../lib/model';
import { parseRules, toWire } from '../lib/wire';
import { groupOf } from './advanced-filter';
import { RuleBuilder } from './rule-builder';

/**
 * The state of an ad-hoc rule builder that lives inside someone else's form (a saved view's "Filter Contacts"). `summary.rules` is the
 * rules as JSON text (empty when no condition is complete), the same text `AdvancedFilter` hands the list; `valid` is false while a
 * condition the person started is still missing its field, operator or value.
 */
export function useRulesDraft(initial: string) {
  const { catalog, ready } = useSegmentCatalog();
  const [draft, setDraft] = useState<Group>(() => groupOf(initial));

  // An empty builder opens with one condition ready to fill (settles after one pass, as in AdvancedFilter).
  if (ready && draft.children.length === 0 && catalog.length > 0)
    setDraft((r) => ruleReducer(r, { type: 'addCondition', groupId: r.id }, catalog));

  const dispatch = (a: RuleAction) => setDraft((r) => ruleReducer(r, a, catalog));
  const kindOf = useMemo(() => kindLookup(catalog), [catalog]);
  const problems = useMemo(() => {
    const out: Record<string, 'field' | NonNullable<ReturnType<typeof valueProblem>>> = {};
    for (const c of conditionsOf(draft)) {
      const kind = kindOf(c.field);
      if (kind === null) out[c.id] = 'field';
      else {
        const p = valueProblem(c, kind);
        if (p) out[c.id] = p;
      }
    }
    return out;
  }, [draft, kindOf]);

  const summary = useMemo(() => {
    const { tree } = pruneIncomplete(draft, kindOf);
    const count = conditionsOf(tree).length;
    const wire = count > 0 ? parseRules(toWire(draft, catalog)) : null;
    return {
      rules: wire ? JSON.stringify(wire) : '',
      count,
      valid: Object.keys(problems).length === 0,
    };
  }, [draft, kindOf, catalog, problems]);

  return { draft, dispatch, catalog, ready, problems, summary };
}

export type RulesDraft = ReturnType<typeof useRulesDraft>;

/** The AND / OR builder with its condition counter, fed by `useRulesDraft`. */
export function RulesEditor({ state, showProblems }: { state: RulesDraft; showProblems: boolean }) {
  const t = useTranslations('segments.advancedFilter');
  const tfields = useTranslations('segments.fields');
  if (!state.ready)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  return (
    <div className="space-y-2">
      <RuleBuilder
        root={state.draft}
        catalog={state.catalog}
        fieldLabel={(f: FieldDef) => ('key' in f.label ? tfields(f.label.key) : f.label.text)}
        dispatch={state.dispatch}
        warnings={new Map()}
        problems={state.problems}
        showProblems={showProblems}
        serverProblems={{}}
      />
      <p className="text-xs text-muted-foreground">
        {t('counts', { conditions: countConditions(state.draft), max: MAX_CONDITIONS })}
      </p>
    </div>
  );
}
