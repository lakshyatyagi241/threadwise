'use client';

import { useMemo, type Dispatch } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';
import type { AssignmentSubject } from '@crm/contracts';
import {
  MAX_CONDITIONS,
  RuleBuilder,
  countConditions,
  invalidConditions,
  type FieldDef,
  type FieldGroup,
  type Group,
  type RuleAction,
} from '@/features/segments';
import type { ConditionProblems } from '../lib/tree';
import { useRa } from './use-ra';

export interface ConditionsEditorProps {
  subject: AssignmentSubject;
  root: Group;
  catalog: readonly FieldDef[];
  /** The lookups behind the catalog answered; until then the builder waits and nothing is judged deleted. */
  ready: boolean;
  /** A lookup failed: say so, the builder still works with what loaded. */
  failed: boolean;
  dispatch: Dispatch<RuleAction>;
  problems: ConditionProblems;
  showProblems: boolean;
  serverProblems: Record<string, string>;
  disabled?: boolean;
}

/**
 * The conditions of a rule: the segments rule builder (field, then operator, then a typed value; AND / OR groups up to three levels)
 * over the fields of the rule's module. No condition at all is a valid rule: it matches everything and runs last (the fallback).
 */
export function ConditionsEditor({
  subject,
  root,
  catalog,
  ready,
  failed,
  dispatch,
  problems,
  showProblems,
  serverProblems,
  disabled,
}: ConditionsEditorProps) {
  const { t } = useRa();
  const tfields = useTranslations('segments.fields');
  const tgroups = useTranslations('segments.fieldGroups');
  const warnings = useMemo(() => invalidConditions(root, catalog, ready), [root, catalog, ready]);

  if (!ready)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('editor.conditions.loading')}
      </p>
    );

  const empty = root.children.length === 0;
  return (
    <div className="space-y-2" data-testid="ra-conditions">
      {failed && (
        <p role="status" className="text-xs text-warning">
          {t('editor.conditions.partial')}
        </p>
      )}
      {empty ? (
        <div className="space-y-3 rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-sm font-medium">{t('editor.conditions.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('editor.conditions.emptyBody')}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || catalog.length === 0}
            onClick={() => dispatch({ type: 'addCondition', groupId: root.id })}
          >
            {t('editor.conditions.add')}
          </Button>
        </div>
      ) : (
        <>
          <RuleBuilder
            root={root}
            catalog={catalog}
            fieldLabel={(f: FieldDef) => ('key' in f.label ? tfields(f.label.key) : f.label.text)}
            groupLabel={(g: FieldGroup) =>
              g === 'record' ? t(`editor.group.${subject}`) : tgroups(g)
            }
            dispatch={dispatch}
            warnings={warnings}
            problems={problems}
            showProblems={showProblems}
            serverProblems={serverProblems}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {t('editor.conditions.counts', {
              conditions: countConditions(root),
              max: MAX_CONDITIONS,
            })}
          </p>
        </>
      )}
    </div>
  );
}
