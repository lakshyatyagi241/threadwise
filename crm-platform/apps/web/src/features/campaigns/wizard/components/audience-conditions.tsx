'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SegmentGroup, WizardAudienceCount } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { useSegmentCatalog } from '@/features/segments/api/lookups';
import { ruleReducer, type RuleAction } from '@/features/segments/lib/builder';
import { invalidConditions, type FieldDef } from '@/features/segments/lib/fields';
import { conditionsOf, valueProblem } from '@/features/segments/lib/model';
import { summarize } from '@/features/segments/lib/summary';
import { conditionAtPath } from '@/features/segments/lib/wire';
import { findField } from '@/features/segments/lib/fields';
import { useSummaryContext } from '@/features/segments/components/use-summary';
import { RuleBuilder, type ConditionWarning } from '@/features/segments/components/rule-builder';
import { editorFromRules, incompleteCount, rulesFromEditor } from '../lib/audience';
import { Skeleton } from './parts';

/**
 * The "Filter conditions" of step 2: the segments' own AND/OR builder over the same field catalog, so what can be filtered here is
 * what a segment can hold. The tree is edited with local ids; only the complete conditions go to the draft.
 */
export function AudienceConditions({
  rules,
  invalid,
  showProblems,
  disabled,
  onRules,
}: {
  rules: SegmentGroup | null;
  /** The server's flags of conditions that point at something deleted (from the count). */
  invalid: WizardAudienceCount['invalidConditions'];
  showProblems: boolean;
  disabled?: boolean;
  onRules: (rules: SegmentGroup | null) => void;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const tf = useTranslations('segments.fields');
  const lookups = useSegmentCatalog();
  const { catalog } = lookups;
  const [root, setRoot] = useState(() => editorFromRules(rules));
  const summaryCtx = useSummaryContext(catalog);

  const dispatch = (a: RuleAction) => {
    const next = ruleReducer(root, a, catalog);
    if (next === root) return;
    setRoot(next);
    onRules(rulesFromEditor(next, catalog));
  };

  const warnings = useMemo(() => {
    const out = new Map<string, ConditionWarning>();
    for (const [id, reason] of invalidConditions(root, catalog, lookups.ready)) out.set(id, reason);
    for (const bad of invalid) {
      const c = conditionAtPath(root, bad.path);
      if (c && !out.has(c.id)) out.set(c.id, { type: 'server', reason: bad.reason });
    }
    return out;
  }, [root, catalog, lookups.ready, invalid]);

  const problems = useMemo(() => {
    const out: Record<string, NonNullable<ReturnType<typeof valueProblem>> | 'field'> = {};
    for (const c of conditionsOf(root)) {
      const f: FieldDef | undefined = findField(catalog, c.field);
      if (!f) out[c.id] = 'field';
      else {
        const p = valueProblem(c, f.kind);
        if (p) out[c.id] = p;
      }
    }
    return out;
  }, [root, catalog]);

  if (!lookups.ready) return <Skeleton label={t('loadingFields')} lines={4} />;

  const sentence = summarize(root, summaryCtx);
  const skipped = incompleteCount(root, catalog);
  return (
    <div className="space-y-3">
      {lookups.failed && <Alert tone="warning">{t('fieldsPartial')}</Alert>}
      <p
        aria-live="polite"
        className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
      >
        {sentence ? (
          <>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('conditionsSummary')}
            </span>
            {sentence}
          </>
        ) : (
          <span className="text-muted-foreground">{t('noConditions')}</span>
        )}
      </p>
      <RuleBuilder
        root={root}
        catalog={catalog}
        fieldLabel={(f: FieldDef) => ('key' in f.label ? tf(f.label.key) : f.label.text)}
        dispatch={dispatch}
        warnings={warnings}
        problems={problems}
        showProblems={showProblems}
        serverProblems={{}}
        disabled={disabled}
      />
      {skipped > 0 && <Alert tone="info">{t('incomplete', { count: skipped })}</Alert>}
    </div>
  );
}
