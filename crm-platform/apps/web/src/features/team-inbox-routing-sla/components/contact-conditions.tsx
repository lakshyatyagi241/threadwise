'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { RuleBuilder, type ConditionWarning } from '@/features/segments/components/rule-builder';
import { useSummaryContext } from '@/features/segments/components/use-summary';
import { ruleReducer, type RuleAction } from '@/features/segments/lib/builder';
import { findField, invalidConditions, type FieldDef } from '@/features/segments/lib/fields';
import { conditionsOf, valueProblem, type Group } from '@/features/segments/lib/model';
import { summarize } from '@/features/segments/lib/summary';

/**
 * "The contact matches": the segments' own AND/OR builder over the same field catalog (tags, owner, stage, custom properties...), so what a
 * rule can test about the contact is what a segment can hold. The tree is edited here; the form keeps it and the save sends the complete
 * conditions only.
 */
export function ContactConditions({
  root,
  showProblems,
  disabled,
  onChange,
  catalog,
  ready,
  failed,
}: {
  root: Group;
  showProblems: boolean;
  disabled?: boolean;
  onChange: (root: Group) => void;
  catalog: readonly FieldDef[];
  ready: boolean;
  failed: boolean;
}) {
  const t = useTranslations('team-inbox-routing-sla.form.contact');
  const tf = useTranslations('segments.fields');
  const summaryCtx = useSummaryContext(catalog);

  const dispatch = (a: RuleAction) => {
    const next = ruleReducer(root, a, catalog);
    if (next !== root) onChange(next);
  };

  const warnings = useMemo(() => {
    const out = new Map<string, ConditionWarning>();
    for (const [id, reason] of invalidConditions(root, catalog, ready)) out.set(id, reason);
    return out;
  }, [root, catalog, ready]);

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

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t('loading')}
      </p>
    );
  }
  const sentence = summarize(root, summaryCtx);
  return (
    <div className="space-y-3">
      {failed && <Alert tone="warning">{t('partial')}</Alert>}
      <p
        aria-live="polite"
        className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
      >
        {sentence ? (
          <>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('summary')}
            </span>
            {sentence}
          </>
        ) : (
          <span className="text-muted-foreground">{t('none')}</span>
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
    </div>
  );
}
