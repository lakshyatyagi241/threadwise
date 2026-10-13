'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { GROWTH_FEATURES, type GrowthFeature, type GrowthSettings } from '@crm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useSaveGrowthSettings } from '../api/hooks';
import {
  PHRASE_INTENTS,
  controlsDirty,
  formFromSettings,
  toSettingsInput,
  type ControlsForm,
} from '../lib/controls-model';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import { LoadError, SectionCard } from './parts';

/** The switches grouped as a person thinks of them. Every key of GROWTH_FEATURES is in exactly one group (a test checks it). */
export const FEATURE_GROUPS: ReadonlyArray<{ id: string; features: readonly GrowthFeature[] }> = [
  {
    id: 'measure',
    features: ['campaign_response', 'send_times', 'propensity', 'quality', 'daily_digest'],
  },
  {
    id: 'audiences',
    features: ['engagement_audiences', 'engagement_stage_rules', 'service_rules', 'enrichment'],
  },
  {
    id: 'chats',
    features: [
      'intent_fields',
      'language_detect',
      'auto_notes',
      'hot_lead_alerts',
      'unanswered_watch',
      'handover_summary',
      'purchase_routing',
      'registration_check',
      'status_reply',
      'optout_detection',
    ],
  },
  { id: 'assist', features: ['broadcast_assistant', 'auto_stage'] },
];

/** Switches and thresholds of the pilot. Saving sends only what changed; turning on a lookup of outside data asks first. */
export function ControlsTab({ settings }: { settings: GrowthSettings }) {
  const t = useTranslations('growth.controls');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = useCan('lsc.settings.manage');
  const baseline = formFromSettings(settings);
  const [form, setForm] = useState<ControlsForm>(baseline);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmEnrich, setConfirmEnrich] = useState(false);
  const dirty = controlsDirty(form, baseline);
  const save = useSaveGrowthSettings();
  const saving = useRef(false);

  const send = () => {
    if (saving.current) return;
    const built = toSettingsInput(form, baseline, settings);
    if (!built.ok) {
      setProblem(
        built.problem.field === 'numbers'
          ? t('problem.numbers')
          : t(`problem.${built.problem.field}`, {
              line: 'line' in built.problem ? built.problem.line : 0,
            }),
      );
      return;
    }
    setProblem(null);
    setError(null);
    saving.current = true;
    save.mutate(built.input, {
      onSuccess: () => toast(t('saved'), 'success'),
      onError: (e) => {
        if (isRowVersionConflict(e)) void qc.invalidateQueries({ queryKey: KEYS.settings });
        setError(e);
      },
      onSettled: () => {
        saving.current = false;
      },
    });
  };
  const enrichNewlyOn = form.features.enrichment && !baseline.features.enrichment;
  const set = <K extends keyof ControlsForm>(k: K, v: ControlsForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof ControlsForm, label: string, hint?: string) => (
    <Field label={label} htmlFor={`growth-${k}`} hint={hint}>
      <Input
        id={`growth-${k}`}
        inputMode="decimal"
        value={String(form[k])}
        disabled={!canManage}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}
      {error !== null && <LoadError errorKey={errorKey(error)} error={error} />}
      {problem !== null && <Alert tone="danger">{problem}</Alert>}

      {FEATURE_GROUPS.map((g) => (
        <SectionCard
          key={g.id}
          id={`growth-group-${g.id}`}
          title={t(`groups.${g.id}.title`)}
          hint={t(`groups.${g.id}.hint`)}
        >
          <ul className="space-y-4">
            {g.features.map((k) => (
              <li key={k} className="flex items-start gap-3">
                <Switch
                  id={`growth-f-${k}`}
                  checked={form.features[k]}
                  disabled={!canManage}
                  label={t(`features.${k}.label`)}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, features: { ...f.features, [k]: v } }))
                  }
                />
                <div className="min-w-0 text-sm">
                  <label htmlFor={`growth-f-${k}`} className="font-medium">
                    {t(`features.${k}.label`)}
                  </label>
                  <p className="mt-0.5 text-muted-foreground">{t(`features.${k}.hint`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}

      <SectionCard id="growth-thresholds" title={t('thresholds.title')} hint={t('thresholds.hint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {num(
            'hotLeadConfidence',
            t('thresholds.hotLeadConfidence'),
            t('thresholds.hotLeadConfidenceHint'),
          )}
          {num(
            'unansweredHours',
            t('thresholds.unansweredHours'),
            t('thresholds.unansweredHoursHint'),
          )}
          {num('lapsedDays', t('thresholds.lapsedDays'), t('thresholds.lapsedDaysHint'))}
          {num('engagedOpens', t('thresholds.engagedOpens'), t('thresholds.engagedOpensHint'))}
          {num('stageMinOpens', t('thresholds.stageMinOpens'))}
          {num('stageWindowDays', t('thresholds.stageWindowDays'))}
          {num(
            'autoMinConfidence',
            t('thresholds.autoMinConfidence'),
            t('thresholds.autoMinConfidenceHint'),
          )}
          {num('autoDailyCap', t('thresholds.autoDailyCap'), t('thresholds.autoDailyCapHint'))}
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id="growth-stage-group"
            checked={form.stageRequireGroup}
            disabled={!canManage}
            label={t('thresholds.requireGroup')}
            onCheckedChange={(v) => set('stageRequireGroup', v)}
          />
          <label htmlFor="growth-stage-group" className="text-sm font-medium">
            {t('thresholds.requireGroup')}
          </label>
        </div>
      </SectionCard>

      <SectionCard id="growth-rules" title={t('rules.title')} hint={t('rules.hint')}>
        <Field
          label={t('rules.statusFields')}
          htmlFor="growth-statusFields"
          hint={t('rules.statusFieldsHint')}
        >
          <Textarea
            id="growth-statusFields"
            rows={3}
            disabled={!canManage}
            value={form.statusFields}
            onChange={(e) => set('statusFields', e.target.value)}
          />
        </Field>
        <Field
          label={t('rules.serviceRules')}
          htmlFor="growth-serviceRules"
          hint={t('rules.serviceRulesHint')}
        >
          <Textarea
            id="growth-serviceRules"
            rows={3}
            disabled={!canManage}
            value={form.serviceRules}
            placeholder={t('rules.serviceRulesExample')}
            onChange={(e) => set('serviceRules', e.target.value)}
          />
        </Field>
        <Field
          label={t('rules.customPhrases')}
          htmlFor="growth-customPhrases"
          hint={t('rules.customPhrasesHint', { intents: PHRASE_INTENTS.join(', ') })}
        >
          <Textarea
            id="growth-customPhrases"
            rows={4}
            disabled={!canManage}
            value={form.customPhrases}
            placeholder={t('rules.customPhrasesExample')}
            onChange={(e) => set('customPhrases', e.target.value)}
          />
        </Field>
        <Field
          label={t('rules.extraMaskTerms')}
          htmlFor="growth-extraMaskTerms"
          hint={t('rules.extraMaskTermsHint')}
        >
          <Textarea
            id="growth-extraMaskTerms"
            rows={3}
            disabled={!canManage}
            value={form.extraMaskTerms}
            onChange={(e) => set('extraMaskTerms', e.target.value)}
          />
        </Field>
      </SectionCard>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setForm(baseline);
              setProblem(null);
            }}
          >
            {t('discard')}
          </Button>
          <Button
            variant="brand"
            disabled={!dirty || save.isPending}
            onClick={() => (enrichNewlyOn ? setConfirmEnrich(true) : send())}
          >
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmEnrich}
        title={t('confirmEnrich.title')}
        message={t('confirmEnrich.body')}
        confirmLabel={t('confirmEnrich.yes')}
        cancelLabel={t('confirmEnrich.no')}
        busy={save.isPending}
        onClose={() => setConfirmEnrich(false)}
        onConfirm={() => {
          setConfirmEnrich(false);
          send();
        }}
      />
    </div>
  );
}

/** For the messages test: every switch the contract knows is placed in a group. */
export const GROUPED_FEATURES: readonly GrowthFeature[] = FEATURE_GROUPS.flatMap((g) => g.features);
export const ALL_FEATURES: readonly GrowthFeature[] = GROWTH_FEATURES;
