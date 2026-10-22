'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { planAdminItemSchema, type PlanAdminItem } from '@crm/contracts';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  buildPlanRequest,
  countFeaturesOn,
  addonsSelectedCount,
  countLimitsSet,
  isPlanDraftDirty,
  newPlanDraft,
  planToDraft,
  problemsFromServer,
  withToggle,
  type PlanDraft,
  type PlanField,
  type PlanProblem,
  type PlanProblems,
} from '../lib/plan-draft';
import {
  firstProblemField,
  tabForField,
  tabsWithProblems,
  type PlanTab,
} from '../lib/plan-editor-view';
import { useCanEdit } from '../operator-context';
import { operatorFetch } from '../operator-fetch';
import { AddonsTab, type AddonOptionsState, type IncludedPacksState } from './addons-tab';
import { FeaturesTab } from './features-tab';
import { LimitsTab } from './limits-tab';
import { PlanModuleFields } from '@/features/addons-extension-registry/components/plan-module-fields';
import { PlanDetailsTab } from './plan-details-tab';
import { FORM_ID, NS, fieldId, type EditorState } from './plan-editor-shared';
import { PlanEditorTabs } from './plan-editor-tabs';
import {
  PLAN_ADDON_OPTIONS_QUERY_KEY,
  PLAN_INCLUDABLE_PACKS_QUERY_KEY,
  fetchIncludablePacks,
  fetchPlanAddonImpact,
  fetchPlanAddonOptions,
  planAddonImpactKey,
} from './plans-query';

/**
 * Create or edit one plan in a dialog with four tabs (TW-PLAN-002's steps: details and pricing, then
 * features, limits and the Marketplace add-ons the plan makes visible). The slug is derived by the
 * server on create and never changes. Validation is the same set of rules the API applies
 * (`checkPlanRules`), so most mistakes are caught before the request; whatever the API still refuses
 * is shown against its field, and the editor jumps to the first tab that holds a problem.
 */
export function PlanEditor({
  plan,
  onClose,
  onSaved,
}: {
  /** The plan being edited; null creates a new one. */
  plan: PlanAdminItem | null;
  onClose: () => void;
  onSaved: (plan: PlanAdminItem, created: boolean) => void;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const initial = useMemo(() => (plan ? planToDraft(plan) : newPlanDraft()), [plan]);
  const [draft, setDraft] = useState<PlanDraft>(initial);
  const [problems, setProblems] = useState<PlanProblems>({});
  const [failure, setFailure] = useState<ApiError | Error | null>(null);
  const [tab, setTab] = useState<PlanTab>('details');
  const [addonsTouched, setAddonsTouched] = useState(false);
  const dirty = isPlanDraftDirty(initial, draft);

  const addonQuery = useQuery({
    queryKey: PLAN_ADDON_OPTIONS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPlanAddonOptions(signal),
    refetchOnWindowFocus: false,
  });
  const addons: AddonOptionsState = {
    status: addonQuery.data ? 'success' : addonQuery.isError ? 'error' : 'pending',
    options: addonQuery.data?.data ?? [],
    retry: () => void addonQuery.refetch(),
  };

  // The plain add-on packs the plan can include (a switch per pack) and, for a saved plan, who already pays for each.
  const packQuery = useQuery({
    queryKey: PLAN_INCLUDABLE_PACKS_QUERY_KEY,
    queryFn: ({ signal }) => fetchIncludablePacks(signal),
    refetchOnWindowFocus: false,
  });
  const impactQuery = useQuery({
    queryKey: planAddonImpactKey(plan?.id ?? 'new'),
    queryFn: ({ signal }) => fetchPlanAddonImpact(plan!.id, signal),
    enabled: plan !== null,
    refetchOnWindowFocus: false,
  });
  const packs = packQuery.data?.data ?? [];
  const included: IncludedPacksState = {
    status: packQuery.data ? 'success' : packQuery.isError ? 'error' : 'pending',
    packs,
    retry: () => void packQuery.refetch(),
    // A new plan has nobody on it; for a saved plan the figure is unknown until it loads (or if it fails).
    impact: plan
      ? impactQuery.data
        ? new Map(impactQuery.data.data.map((r) => [r.packId, r.renewing]))
        : null
      : new Map(),
  };
  const canEdit = useCanEdit('plans');

  const save = useMutation({
    mutationFn: async (body: NonNullable<ReturnType<typeof buildPlanRequest>['body']>) =>
      plan
        ? operatorFetch(`/plans/${plan.id}`, {
            method: 'PATCH',
            body,
            schema: planAdminItemSchema,
          })
        : operatorFetch('/plans', { method: 'POST', body, schema: planAdminItemSchema }),
    onSuccess: (saved) => onSaved(saved, !plan),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const fromServer = problemsFromServer(err.fieldErrors);
        setProblems(fromServer);
        // Nothing the form can point at: say what the API said.
        if (Object.keys(fromServer).length === 0) setFailure(err);
        else showProblems(fromServer);
        return;
      }
      setFailure(err instanceof Error ? err : new Error(String(err)));
    },
  });

  // A reload or a closed tab would lose the draft: ask the browser to confirm, only while there is something to lose.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Jump to the first tab that holds a problem and focus its field. */
  function showProblems(p: PlanProblems) {
    const first = firstProblemField(p);
    if (!first) return;
    setTab(tabForField(first));
    // The tab's panel mounts on the next render; focus once it has.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(fieldId(first))?.focus()),
    );
  }

  function set<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => {
      if (key === 'limits') {
        // Only the caps that actually changed lose their message.
        const next = { ...p };
        for (const f of Object.keys(next) as PlanField[]) {
          if (!f.startsWith('limits.')) continue;
          const k = f.slice('limits.'.length) as keyof PlanDraft['limits'];
          if (draft.limits[k] !== (value as PlanDraft['limits'])[k]) delete next[f];
        }
        return next;
      }
      if (!(key in p)) return p;
      const { [key as PlanField]: _drop, ...rest } = p;
      return rest;
    });
  }

  function toggle(key: Parameters<typeof withToggle>[1], on: boolean) {
    setDraft((d) => withToggle(d, key, on));
    setProblems({});
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setFailure(null);
    // Send the add-on selection whenever the admin saw the real list (loaded) or edited it; when the options
    // never loaded and the tab was untouched, omit it so the stored selection is kept (see buildPlanRequest).
    const built = buildPlanRequest(draft, {
      includeAddons: addonQuery.data !== undefined || addonsTouched,
    });
    if (built.problems) {
      setProblems(built.problems);
      showProblems(built.problems);
      return;
    }
    setProblems({});
    save.mutate(built.body);
  }

  function close() {
    if (save.isPending) return;
    if (dirty && !window.confirm(t('discard'))) return;
    onClose();
  }

  const message = (p: PlanProblem | undefined): string | undefined => {
    if (!p) return undefined;
    if (p.ids) return tp('unknownAddon', { count: p.ids.length });
    if (p.code === 'server') return p.message;
    return tp(p.code, { max: p.max ?? 0, min: p.min ?? 0 });
  };
  const state: EditorState = {
    draft,
    problems,
    set,
    err: (field) => message(problems[field]),
  };
  const errorTabs = tabsWithProblems(problems);

  return (
    <Modal
      open
      onClose={close}
      title={plan ? t('editTitle', { name: plan.name }) : t('createTitle')}
      className="w-[min(46rem,calc(100vw-1.5rem))]"
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-5">
        <div className="space-y-4">
          {plan && (
            <p className="text-xs text-muted-foreground">
              {t('slugLabel')}{' '}
              <span dir="ltr" className="font-mono text-foreground">
                {plan.slug}
              </span>
              . {t('slugNote')}
            </p>
          )}

          {errorTabs.length > 0 && <Alert tone="danger">{t('errorsBanner')}</Alert>}

          <PlanEditorTabs
            active={tab}
            onChange={setTab}
            counts={{
              featuresOn: countFeaturesOn(draft.features),
              limitsSet: countLimitsSet(draft.limits),
              addons: addonsSelectedCount(draft, packs),
            }}
            errorTabs={errorTabs}
            panels={{
              details: <PlanDetailsTab state={state} toggle={toggle} />,
              features: (
                <>
                  <FeaturesTab state={state} />
                  <PlanModuleFields kind="features" state={state} />
                </>
              ),
              limits: (
                <>
                  <LimitsTab state={state} />
                  <PlanModuleFields kind="limits" state={state} />
                </>
              ),
              addons: (
                <AddonsTab
                  state={state}
                  addons={addons}
                  included={included}
                  savedFeatures={initial.features}
                  readOnly={!canEdit}
                  onTouched={() => setAddonsTouched(true)}
                />
              ),
            }}
          />

          {failure && (
            <Alert tone="danger">
              {failure instanceof ApiError && failure.status < 500 ? failure.message : t('failed')}
            </Alert>
          )}
        </div>
        {/* Stays in view while a long tab scrolls inside the dialog. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
          <Button type="button" variant="ghost" onClick={close} disabled={save.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {save.isPending ? t('saving') : plan ? t('save') : t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
