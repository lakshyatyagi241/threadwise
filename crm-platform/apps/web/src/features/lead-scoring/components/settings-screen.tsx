'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { LscSettings } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Spinner, StatTile, Switch, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useBackfill, useLscSettings } from '../api/hooks';
import { lscApi } from '../api/service';
import { formatCostUsd, formatCount } from '../lib/cost';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import {
  formFromSettings,
  readiness,
  settingsDirty,
  toSettingsInput,
  type SettingsForm,
} from '../lib/settings-model';
import {
  LinkButton,
  LoadError,
  NoAccess,
  PageHeader,
  SectionCard,
  SkeletonRows,
  SparkleIcon,
} from './parts';
import { RunsLog } from './runs-log';
import { SuggestionsPanel } from './suggestions-panel';

/** Contacts one "Score unscored contacts now" queues; the rest wait for the next click. */
export const BACKFILL_LIMIT = 500;

/** `/lead-scoring`: the workspace's opt-in, what it costs, scoring the backlog, and the log of every attempt. */
export function SettingsScreen() {
  const t = useTranslations('lead-scoring.settings');
  const canRead = useCan('lsc.runs.read');
  const qc = useQueryClient();
  const q = useLscSettings(canRead);
  const [conflict, setConflict] = useState(false);

  if (!canRead) return <NoAccess permission="lsc.runs.read" />;
  if (q.isError)
    return (
      <LoadError errorKey={errorKey(q.error)} error={q.error} onRetry={() => void q.refetch()} />
    );
  if (!q.data) return <SkeletonRows rows={5} />;
  return (
    <>
      {conflict && (
        <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>{t('conflict')}</span>
          <Button size="sm" variant="secondary" onClick={() => setConflict(false)}>
            {t('conflictOk')}
          </Button>
        </Alert>
      )}
      {/* A new version of the settings (after a save or a reload) starts a fresh form on it. */}
      <SettingsBody
        key={q.data.rowVersion ?? 'first'}
        settings={q.data}
        onSaved={() => setConflict(false)}
        onConflict={() => {
          // Someone saved first: read what is stored now, so the form restarts from it, and say so.
          setConflict(true);
          void qc.invalidateQueries({ queryKey: KEYS.settings });
        }}
      />
    </>
  );
}

function SettingsBody({
  settings,
  onSaved,
  onConflict,
}: {
  settings: LscSettings;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('lead-scoring.settings');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = useCan('lsc.settings.manage');
  const baseline = formFromSettings(settings);
  const [form, setForm] = useState<SettingsForm>(baseline);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState<null | 'enable' | 'chat'>(null);
  const dirty = settingsDirty(form, baseline);
  const disabled = !canManage;
  const state = readiness(settings);

  // A double click must send one request: `isPending` only turns true after the next render.
  const saving = useRef(false);
  const save = useMutation({
    mutationFn: () => lscApi.saveSettings(toSettingsInput(form, settings)),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      // Every screen that draws a contact's score follows this switch.
      qc.setQueryData(KEYS.status, { enabled: saved.enabled });
      onSaved();
      toast(t('saved'), 'success');
    },
    onError: (e) => {
      if (isRowVersionConflict(e)) onConflict();
      else setError(e);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const send = () => {
    if (saving.current) return;
    saving.current = true;
    setError(null);
    save.mutate();
  };
  // Turning scoring on sends contact facts to an AI vendor, and turning the chat reading on sends masked conversation text, so each
  // of those saves asks first (the second question only after the first was answered).
  const chatNewlyOn = settings.chatDigestAvailable && form.chatDigest && !settings.chatDigest;
  const requestSave = () => {
    if (form.enabled && !settings.enabled) setConfirming('enable');
    else if (chatNewlyOn) setConfirming('chat');
    else send();
  };

  return (
    <section className="space-y-4">
      <PageHeader
        icon={<SparkleIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canManage && (
            <>
              <Button
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={() => setForm(baseline)}
              >
                {t('discard')}
              </Button>
              <Button variant="brand" disabled={!dirty || save.isPending} onClick={requestSave}>
                {save.isPending && <Spinner />}
                {t('save')}
              </Button>
            </>
          )
        }
      />

      {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}
      <StatusBanner state={state} keySource={settings.keySource} model={settings.model} />
      {error !== null && <LoadError errorKey={errorKey(error)} error={error} />}

      <SectionCard id="lsc-enable" title={t('enable.title')} hint={t('enable.hint')}>
        <div className="flex items-start gap-3">
          <Switch
            id="lsc-enabled"
            checked={form.enabled}
            disabled={disabled}
            label={t('enable.label')}
            onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
          />
          <div className="min-w-0 text-sm">
            <label htmlFor="lsc-enabled" className="font-medium">
              {form.enabled ? t('enable.on') : t('enable.off')}
            </label>
            <p className="mt-1 text-muted-foreground">{t('enable.what')}</p>
          </div>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="font-medium">{t('sent.title')}</h3>
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
              {(
                ['stage', 'source', 'tags', 'deals', 'activity', 'engagement', 'company'] as const
              ).map((k) => (
                <li key={k}>{t(`sent.${k}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">{t('notSent.title')}</h3>
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
              {(
                [
                  'name',
                  'email',
                  'phone',
                  settings.chatDigestAvailable ? 'messagesChat' : 'messages',
                ] as const
              ).map((k) => (
                <li key={k}>{t(`notSent.${k}`)}</li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">{t('manualRule')}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 border-t border-border pt-4">
          <Switch
            id="lsc-auto"
            checked={form.autoScore}
            disabled={disabled}
            label={t('auto.label')}
            onCheckedChange={(v) => setForm((f) => ({ ...f, autoScore: v }))}
          />
          <div className="min-w-0 text-sm">
            <label htmlFor="lsc-auto" className="font-medium">
              {t('auto.label')}
            </label>
            <p className="mt-1 text-muted-foreground">
              {form.autoScore ? t('auto.onBody') : t('auto.offBody')}
            </p>
          </div>
        </div>
      </SectionCard>

      {settings.chatDigestAvailable && (
        <ChatCard form={form} setForm={setForm} disabled={disabled} />
      )}
      {settings.chatDigestAvailable && settings.chatDigest && settings.stageSuggestions && (
        <SuggestionsPanel />
      )}

      <BackfillCard settings={settings} ready={state === 'ready'} />
      <CostCard settings={settings} />
      <RunsLog enabled />

      <ConfirmDialog
        open={confirming === 'enable'}
        title={t('confirm.title')}
        message={t('confirm.body')}
        confirmLabel={t('confirm.yes')}
        cancelLabel={t('confirm.no')}
        busy={save.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (chatNewlyOn) setConfirming('chat');
          else {
            setConfirming(null);
            send();
          }
        }}
      />
      <ConfirmDialog
        open={confirming === 'chat'}
        title={t('chat.confirm.title')}
        message={t('chat.confirm.body')}
        confirmLabel={t('chat.confirm.yes')}
        cancelLabel={t('chat.confirm.no')}
        busy={save.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          send();
        }}
      />
    </section>
  );
}

/** Reading conversations (a pilot): the two switches and exactly how personal data is treated before anything is sent. */
function ChatCard({
  form,
  setForm,
  disabled,
}: {
  form: SettingsForm;
  setForm: (fn: (f: SettingsForm) => SettingsForm) => void;
  disabled: boolean;
}) {
  const t = useTranslations('lead-scoring.settings.chat');
  return (
    <SectionCard id="lsc-chat" title={t('title')} hint={t('hint')}>
      <div className="flex items-start gap-3">
        <Switch
          id="lsc-chat-digest"
          checked={form.chatDigest}
          disabled={disabled || !form.enabled}
          label={t('label')}
          onCheckedChange={(v) =>
            setForm((f) => ({ ...f, chatDigest: v, stageSuggestions: v && f.stageSuggestions }))
          }
        />
        <div className="min-w-0 text-sm">
          <label htmlFor="lsc-chat-digest" className="font-medium">
            {t('label')}
          </label>
          <p className="mt-1 text-muted-foreground">
            {form.chatDigest ? t('onBody') : t('offBody')}
          </p>
          {!form.enabled && <p className="mt-1 text-muted-foreground">{t('needsScoring')}</p>}
        </div>
      </div>
      <div className="flex items-start gap-3 border-t border-border pt-4">
        <Switch
          id="lsc-stage-suggestions"
          checked={form.stageSuggestions}
          disabled={disabled || !form.chatDigest}
          label={t('stageLabel')}
          onCheckedChange={(v) => setForm((f) => ({ ...f, stageSuggestions: v }))}
        />
        <div className="min-w-0 text-sm">
          <label htmlFor="lsc-stage-suggestions" className="font-medium">
            {t('stageLabel')}
          </label>
          <p className="mt-1 text-muted-foreground">{t('stageBody')}</p>
        </div>
      </div>
      <fieldset
        className="border-t border-border pt-4 text-sm"
        disabled={disabled || !form.chatDigest || !form.stageSuggestions}
      >
        <legend className="font-medium">{t('stageMode.title')}</legend>
        {(['auto', 'manual'] as const).map((mode) => (
          <label key={mode} className="mt-2 flex items-start gap-2">
            <input
              type="radio"
              name="lsc-stage-mode"
              data-testid={`lsc-stage-mode-${mode}`}
              className="mt-1"
              checked={form.stageAutoApply === (mode === 'auto')}
              onChange={() => setForm((f) => ({ ...f, stageAutoApply: mode === 'auto' }))}
            />
            <span>
              <span className="font-medium">{t(`stageMode.${mode}.label`)}</span>
              <span className="block text-muted-foreground">{t(`stageMode.${mode}.body`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
        <div>
          <h3 className="font-medium">{t('masked.title')}</h3>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {(['phone', 'email', 'card', 'name'] as const).map((k) => (
              <li key={k}>{t(`masked.${k}`)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-medium">{t('rules.title')}</h3>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-muted-foreground">
            {(['quiet', 'enough', 'person', 'closing'] as const).map((k) => (
              <li key={k}>{t(`rules.${k}`)}</li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}

function StatusBanner({
  state,
  keySource,
  model,
}: {
  state: ReturnType<typeof readiness>;
  keySource: LscSettings['keySource'];
  model: string;
}) {
  const t = useTranslations('lead-scoring.settings.banner');
  const canKeys = useCan('aiadm.keys.read');
  if (state === 'platformOff') return <Alert tone="danger">{t('platformOff')}</Alert>;
  if (state === 'noKey')
    return (
      <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
        <span>{t('noKey')}</span>
        {canKeys && <LinkButton href="/ai-keys">{t('openKeys')}</LinkButton>}
      </Alert>
    );
  if (state === 'off') return <Alert tone="info">{t('off')}</Alert>;
  return (
    <Alert tone="success">
      {t('ready', { model, key: t(keySource === 'workspace' ? 'keyWorkspace' : 'keyAdmin') })}
    </Alert>
  );
}

function BackfillCard({ settings, ready }: { settings: LscSettings; ready: boolean }) {
  const t = useTranslations('lead-scoring.settings.backfill');
  const locale = useLocale();
  const canScore = useCan('lsc.contacts.score');
  const backfill = useBackfill();
  const waiting = Math.max(0, settings.eligibleContacts - settings.scoredContacts);
  const blocked = !canScore ? 'noRight' : !ready ? 'notReady' : null;
  return (
    <SectionCard id="lsc-backfill" title={t('title')} hint={t('hint', { limit: BACKFILL_LIMIT })}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('eligible')} value={formatCount(settings.eligibleContacts, locale)} />
        <StatTile label={t('scored')} value={formatCount(settings.scoredContacts, locale)} />
        <StatTile label={t('waiting')} value={formatCount(waiting, locale)} />
      </div>
      <p className="text-xs text-muted-foreground">{t('eligibleNote')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={blocked !== null || backfill.isPending}
          aria-describedby={blocked ? 'lsc-backfill-why' : undefined}
          onClick={() => backfill.mutate(BACKFILL_LIMIT)}
        >
          {backfill.isPending ? <Spinner /> : <SparkleIcon className="size-4" />}
          {t('button')}
        </Button>
        {blocked && (
          <p id="lsc-backfill-why" className="text-sm text-muted-foreground">
            {t(blocked)}
          </p>
        )}
      </div>
      {backfill.isSuccess && (
        <p role="status" className="text-sm">
          {backfill.data.queued > 0
            ? t('queued', { count: backfill.data.queued })
            : t('nothingToScore')}
        </p>
      )}
      {backfill.isError && <LoadError errorKey={errorKey(backfill.error)} error={backfill.error} />}
    </SectionCard>
  );
}

function CostCard({ settings }: { settings: LscSettings }) {
  const t = useTranslations('lead-scoring.settings.cost');
  const locale = useLocale();
  const c = settings.last30d;
  const tokens = c.promptTokens + c.completionTokens;
  const platformCost = Number(c.platformCostUsd);
  return (
    <SectionCard id="lsc-cost" title={t('title')} hint={t('hint')}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('scores')} value={formatCount(c.scores, locale)} />
        <StatTile label={t('tokens')} value={formatCount(tokens, locale)} />
        <StatTile label={t('total')} value={formatCostUsd(c.costUsd, locale)} />
        <StatTile
          label={t('average')}
          value={c.avgCostPerScoreUsd === null ? '—' : formatCostUsd(c.avgCostPerScoreUsd, locale)}
          hint={t('averageHint')}
        />
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t('model')}</dt>
          <dd className="font-mono">{settings.model}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('payer')}</dt>
          <dd>{t(`payerBy.${settings.keySource}`)}</dd>
        </div>
        {c.failed > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">{t('failed')}</dt>
            <dd className="tabular-nums">{formatCount(c.failed, locale)}</dd>
          </div>
        )}
        {platformCost > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">{t('platformPart')}</dt>
            <dd className="tabular-nums">{formatCostUsd(c.platformCostUsd, locale)}</dd>
          </div>
        )}
      </dl>
    </SectionCard>
  );
}
