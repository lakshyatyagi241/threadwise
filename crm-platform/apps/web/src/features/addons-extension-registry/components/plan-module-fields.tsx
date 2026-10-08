'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Input, Switch } from '@crm/ui';
import type { EditorState } from '@/features/auth-registration-security/platform/plans/plan-editor-shared';
import { fetchGrantFields, KEYS } from '../api';

/**
 * The flags and caps that installed modules add to a plan (WD-ADD-013), under the core ones on the plan form's Features and Limits tabs.
 * They come from the same list the add-on pack form uses; a module that is off contributes none, and the plan keeps what it stored.
 */
export function PlanModuleFields({
  kind,
  state,
}: {
  kind: 'features' | 'limits';
  state: EditorState;
}) {
  const t = useTranslations('addons-extension-registry.planFields');
  const { draft, set } = state;
  const fields = useQuery({
    queryKey: KEYS.fields,
    queryFn: ({ signal }) => fetchGrantFields(signal),
  });
  const rows = (fields.data?.[kind] ?? []).filter((f) => f.source !== 'core');
  if (rows.length === 0) return null;

  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="mt-4 space-y-4" data-testid={`plan-module-${kind}`}>
      {groups.map((group) => (
        <section key={group} className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group} <span className="font-normal normal-case">({t('fromModule')})</span>
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows
              .filter((r) => r.group === group)
              .map((r) =>
                kind === 'features' ? (
                  <div
                    key={r.key}
                    className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <label
                      htmlFor={`plan-module-${r.key}`}
                      className="min-w-0 cursor-pointer text-sm font-medium"
                    >
                      {r.label}
                    </label>
                    <Switch
                      id={`plan-module-${r.key}`}
                      checked={draft.features[r.key] === true}
                      onCheckedChange={(v) => set('features', { ...draft.features, [r.key]: v })}
                      label={r.label}
                    />
                  </div>
                ) : (
                  <div
                    key={r.key}
                    className="min-w-0 space-y-2 rounded-md border border-border p-3"
                  >
                    <label htmlFor={`plan-module-${r.key}`} className="block text-sm font-medium">
                      {r.label}
                    </label>
                    <Input
                      id={`plan-module-${r.key}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={draft.limits[r.key] ?? ''}
                      placeholder={t('unlimited')}
                      onChange={(e) => set('limits', { ...draft.limits, [r.key]: e.target.value })}
                      className="font-mono"
                    />
                  </div>
                ),
              )}
          </div>
        </section>
      ))}
    </div>
  );
}
