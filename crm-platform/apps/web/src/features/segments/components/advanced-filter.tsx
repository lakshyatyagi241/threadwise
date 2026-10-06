'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@crm/ui';
import { useSegmentCatalog } from '../api/lookups';
import { ruleReducer, type RuleAction } from '../lib/builder';
import { kindLookup, type FieldDef } from '../lib/fields';
import {
  MAX_CONDITIONS,
  conditionsOf,
  countConditions,
  emptyRoot,
  pruneIncomplete,
  valueProblem,
  type Group,
} from '../lib/model';
import { fromWire, parseRules, toWire } from '../lib/wire';
import { RuleBuilder } from './rule-builder';

/** The rules of a saved `rules=` value (JSON text), or an empty tree for none or text that does not parse. */
function groupOf(text: string): Group {
  if (!text) return emptyRoot();
  try {
    const parsed = parseRules(JSON.parse(text));
    return parsed ? fromWire(parsed) : emptyRoot();
  } catch {
    return emptyRoot();
  }
}

/** How many conditions an applied `rules=` value holds (the badge on the button). */
export function appliedConditionCount(text: string): number {
  return text ? countConditions(groupOf(text)) : 0;
}

/**
 * The Contact Hub's "Add condition": the segment rule builder (AND/OR groups of conditions) as an ad-hoc filter. Nothing
 * is saved: Apply hands the rules as JSON text to the list, Clear removes them. `value` is what is applied now.
 */
export function AdvancedFilter({
  value,
  onApply,
  className,
}: {
  value: string;
  onApply: (rulesJson: string) => void;
  className?: string;
}) {
  const t = useTranslations('segments.advancedFilter');
  const tfields = useTranslations('segments.fields');
  const { catalog, ready } = useSegmentCatalog();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Group>(() => groupOf(value));
  const [showProblems, setShowProblems] = useState(false);
  const applied = appliedConditionCount(value);

  // An empty builder opens with one condition ready to fill, so the person sees field, operator and value at once.
  useEffect(() => {
    if (open && ready && draft.children.length === 0 && catalog.length > 0)
      setDraft((r) => ruleReducer(r, { type: 'addCondition', groupId: r.id }, catalog));
  }, [open, ready, draft.children.length, catalog]);

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

  function apply() {
    setShowProblems(true);
    if (Object.keys(problems).length > 0) return;
    const { tree } = pruneIncomplete(draft, kindOf);
    if (conditionsOf(tree).length === 0) {
      onApply('');
      setOpen(false);
      return;
    }
    const rules = parseRules(toWire(draft, catalog));
    if (!rules) return;
    onApply(JSON.stringify(rules));
    setOpen(false);
  }

  function clear() {
    setDraft(emptyRoot());
    setShowProblems(false);
    onApply('');
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="hub-advanced-filter"
        onClick={() => {
          if (!open) setDraft(groupOf(value));
          setOpen((o) => !o);
        }}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
          className,
        )}
      >
        {applied > 0 ? t('triggerOn') : t('trigger')}
        {applied > 0 && (
          <span className="rounded-full bg-brand px-1.5 text-[11px] leading-5 text-brand-foreground">
            {applied}
          </span>
        )}
      </button>
      {open && (
        <section
          id="hub-advanced-filter"
          aria-label={t('title')}
          className="basis-full space-y-3 rounded-xl border border-border bg-background p-4"
        >
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('title')}</h2>
              <p className="text-xs text-muted-foreground">{t('hint')}</p>
            </div>
          </header>
          {!ready ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('loading')}
            </p>
          ) : (
            <RuleBuilder
              root={draft}
              catalog={catalog}
              fieldLabel={(f: FieldDef) => ('key' in f.label ? tfields(f.label.key) : f.label.text)}
              dispatch={dispatch}
              warnings={new Map()}
              problems={problems}
              showProblems={showProblems}
              serverProblems={{}}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t('counts', { conditions: countConditions(draft), max: MAX_CONDITIONS })}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={clear}>
                {t('clear')}
              </Button>
              <Button type="button" size="sm" onClick={apply} disabled={!ready}>
                {t('apply')}
              </Button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
