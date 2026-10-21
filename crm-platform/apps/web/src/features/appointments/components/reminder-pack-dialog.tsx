'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  BOOKING_TIMED_STEPS_MAX,
  ERROR_CODES,
  type ReminderPack,
  type ReminderPackAdoptResult,
  type ReminderPackKey,
  type ReminderPackLanguage,
  type ReminderPackPreviewStep,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { Alert, Badge, Button, Checkbox, Input, Modal, Spinner, cn } from '@crm/ui';
import { KEYS, usePackPreview, useReminderPacks } from '../api/hooks';
import { sequencesApi } from '../api/sequences-service';
import { errorKind } from '../lib/errors';
import {
  PACK_LANGUAGES,
  SAMPLE_KEYS,
  applyBlock,
  defaultSample,
  fillSample,
  newTemplates,
  packStepWhen,
  previewCounts,
  waitingTemplates,
  type SampleValues,
} from '../lib/reminder-packs';
import { WA_TONE, type WhatsappState } from '../lib/reminder-timeline';
import { chipClass } from './editor-shared';
import { ChevronDownIcon } from './icons';
import { ErrorLine, ToneChip } from './parts';
import { UpgradeHint, useSequencePlan } from './reminder-step-parts';

/** The names of the message languages, each in its own script (the same on every screen language). */
const LANGUAGE_NAME: Record<ReminderPackLanguage, string> = { en: 'English', hi: 'हिन्दी' };

export interface ReminderPackDialogProps {
  open: boolean;
  onClose: () => void;
  /** The booking type the pack is applied to. */
  type: { id: string; name: string };
  /** The type's steps have unsaved changes on this screen: applying is held until they are saved or discarded. */
  dirty: boolean;
  canEdit: boolean;
  /** The pack was applied and the type's steps changed on the server: the screen takes the new ones. */
  onApplied: () => void | Promise<void>;
}

/**
 * Ready-made reminder sequences (BL-424): choose a pack for a booking type, read its messages with sample values in English or Hindi, see
 * what applying it adds, replaces or leaves, apply it (which creates the email messages and sends the WhatsApp templates to Meta for
 * approval) and watch the approval state of each template. Until a template is approved the step goes out by email.
 */
export function ReminderPackDialog(props: ReminderPackDialogProps) {
  const t = useTranslations('appointments.reminders.packs');
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="lg"
      eyebrow={t('eyebrow', { name: props.type.name })}
      title={t('title')}
      closeLabel={t('close')}
    >
      {props.open && <DialogBody {...props} />}
    </Modal>
  );
}

function DialogBody({ onClose, type, dirty, canEdit, onApplied }: ReminderPackDialogProps) {
  const t = useTranslations('appointments.reminders.packs');
  const qc = useQueryClient();
  const packs = useReminderPacks(true);
  const [key, setKey] = useState<ReminderPackKey | null>(null);
  const [language, setLanguage] = useState<ReminderPackLanguage>('en');
  const [sample, setSample] = useState<SampleValues>(() => defaultSample('en', type.name));
  const [confirmed, setConfirmed] = useState(false);
  const [submitToMeta, setSubmitToMeta] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ReminderPackAdoptResult | null>(null);
  /** One key per attempt: pressing Apply again after a lost answer must not apply twice. */
  const attempt = useRef<string | null>(null);

  const preview = usePackPreview(key, type.id, language);
  const pack = packs.data?.find((p) => p.key === key);
  const block = applyBlock({ canEdit, dirty, preview: preview.data, confirmed });

  function choose(next: ReminderPackKey) {
    setKey(next);
    setConfirmed(false);
    setError(null);
  }
  function chooseLanguage(next: ReminderPackLanguage) {
    setLanguage(next);
    setSample(defaultSample(next, type.name));
    setConfirmed(false);
  }

  async function apply() {
    if (!key || block !== null || busy) return;
    setBusy(true);
    setError(null);
    attempt.current ??= crypto.randomUUID();
    try {
      const done = await sequencesApi.adoptPack(
        key,
        { bookingTypeId: type.id, language, confirmReplace: confirmed, submitToMeta },
        attempt.current,
      );
      attempt.current = null;
      setResult(done);
      await qc.invalidateQueries({ queryKey: KEYS.types });
      await qc.invalidateQueries({ queryKey: KEYS.library });
      await onApplied();
    } catch (e) {
      // A definite answer ends the attempt; a lost connection keeps the key so pressing Apply again cannot apply twice.
      if (e instanceof ApiError) attempt.current = null;
      setError(e);
      // The steps changed under the preview (somebody else edited them): read it again before anything is overwritten.
      if (e instanceof ApiError && e.code === ERROR_CODES.CONFLICT) void preview.refetch();
    } finally {
      setBusy(false);
    }
  }

  if (result && key) {
    return (
      <ResultView
        result={result}
        packKey={key}
        typeId={type.id}
        language={language}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {packs.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : packs.isError ? (
        <ErrorLine error={packs.error} onRetry={() => void packs.refetch()} />
      ) : (
        <PackList packs={packs.data} value={key} onChange={choose} />
      )}

      {key && pack && (
        <div className="space-y-4 border-t border-border pt-4">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">{t('language')}</legend>
            <div role="radiogroup" aria-label={t('language')} className="flex flex-wrap gap-2">
              {PACK_LANGUAGES.filter((l) => pack.languages.includes(l)).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={language === l}
                  onClick={() => chooseLanguage(l)}
                  className={cn(
                    chipClass,
                    language === l && 'border-primary bg-primary/10 text-primary',
                  )}
                >
                  {LANGUAGE_NAME[l]}
                </button>
              ))}
            </div>
            {pack.machineDrafted.includes(language) && (
              <Alert tone="warning" className="text-xs">
                {t('machineDraft')}
              </Alert>
            )}
          </fieldset>

          {preview.isPending ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('previewLoading')}
            </div>
          ) : preview.isError ? (
            <ErrorLine error={preview.error} onRetry={() => void preview.refetch()} />
          ) : (
            <PreviewView
              pack={pack}
              data={preview.data}
              language={language}
              sample={sample}
              onSample={setSample}
              confirmed={confirmed}
              onConfirmed={setConfirmed}
              submitToMeta={submitToMeta}
              onSubmitToMeta={setSubmitToMeta}
            />
          )}
        </div>
      )}

      {error !== null && <ApplyError error={error} />}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {key && block && block !== 'loading' && (
          <p className="me-auto text-xs text-muted-foreground">{t(`block.${block}`)}</p>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button disabled={!key || block !== null || busy} onClick={() => void apply()}>
          {busy ? t('applying') : t('apply')}
        </Button>
      </div>
    </div>
  );
}

function ApplyError({ error }: { error: unknown }) {
  const t = useTranslations('appointments.reminders.packs');
  if (error instanceof ApiError && error.code === ERROR_CODES.CONFLICT) {
    return <Alert tone="warning">{t('errors.needsConfirm')}</Alert>;
  }
  if (errorKind(error) === 'validation') return <Alert tone="danger">{t('errors.cap')}</Alert>;
  return <ErrorLine error={error} />;
}

function PackList({
  packs,
  value,
  onChange,
}: {
  packs: readonly ReminderPack[];
  value: ReminderPackKey | null;
  onChange: (key: ReminderPackKey) => void;
}) {
  const t = useTranslations('appointments.reminders.packs');
  return (
    <div role="radiogroup" aria-label={t('choose')} className="grid gap-2 sm:grid-cols-2">
      {packs.map((p) => (
        <button
          key={p.key}
          type="button"
          role="radio"
          aria-checked={value === p.key}
          onClick={() => onChange(p.key)}
          className={cn(
            'rounded-lg border p-3 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            value === p.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{p.name}</span>
            <span className="text-xs text-muted-foreground">
              {t('stepsCount', { count: p.steps.length })}
            </span>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{p.description}</span>
        </button>
      ))}
    </div>
  );
}

function PreviewView({
  pack,
  data,
  language,
  sample,
  onSample,
  confirmed,
  onConfirmed,
  submitToMeta,
  onSubmitToMeta,
}: {
  pack: ReminderPack;
  data: NonNullable<ReturnType<typeof usePackPreview>['data']>;
  language: ReminderPackLanguage;
  sample: SampleValues;
  onSample: (next: SampleValues) => void;
  confirmed: boolean;
  onConfirmed: (v: boolean) => void;
  submitToMeta: boolean;
  onSubmitToMeta: (v: boolean) => void;
}) {
  const t = useTranslations('appointments.reminders.packs');
  const counts = previewCounts(data);
  const fresh = newTemplates(data);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('previewTitle')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('summary', { add: counts.add, replace: counts.replace, unchanged: counts.unchanged })}
          {' · '}
          {t('timedOf', { count: data.timedSteps, max: data.timedStepsMax })}
        </p>
      </div>

      {data.blocked === 'cap_exceeded' && (
        <Alert tone="danger">{t('blocked', { max: BOOKING_TIMED_STEPS_MAX })}</Alert>
      )}
      {data.needsConfirm && (
        <Alert tone="warning" className="space-y-2">
          <p className="font-medium">{t('confirmTitle')}</p>
          <p className="text-xs">{t('confirmBody', { count: counts.replace })}</p>
          <Checkbox
            id="pack-confirm"
            checked={confirmed}
            onChange={(e) => onConfirmed(e.target.checked)}
            label={t('confirmCheck')}
          />
        </Alert>
      )}

      <ul className="space-y-2">
        {data.steps.map((s) => (
          <PackStepItem
            key={s.step.stepKind}
            item={s}
            pack={pack}
            language={language}
            sample={sample}
          />
        ))}
      </ul>

      {data.kept.length > 0 && (
        <p className="text-xs text-muted-foreground">{t('kept', { count: data.kept.length })}</p>
      )}

      <SampleEditor
        sample={sample}
        onChange={onSample}
        language={language}
        typeName={data.bookingType.name}
      />

      <div className="space-y-1">
        <Checkbox
          id="pack-submit"
          checked={submitToMeta}
          onChange={(e) => onSubmitToMeta(e.target.checked)}
          label={t('submitToMeta')}
        />
        <p className="ps-6 text-xs text-muted-foreground">
          {fresh > 0 ? t('submitHint', { count: fresh }) : t('submitHintNone')}
        </p>
      </div>
    </div>
  );
}

function PackStepItem({
  item,
  pack,
  language,
  sample,
}: {
  item: ReminderPackPreviewStep;
  pack: ReminderPack;
  language: ReminderPackLanguage;
  sample: SampleValues;
}) {
  const t = useTranslations('appointments.reminders.packs');
  const tr = useTranslations('appointments.reminders');
  const plan = useSequencePlan();
  const [open, setOpen] = useState(false);
  const { step } = item;
  const when = packStepWhen(step);
  const status = item.whatsapp.status;
  const fill = (text: string) => fillSample(text, sample, { pack: pack.key, language });
  const ctx = { id: `pack-${pack.key}-${step.stepKind}` };
  return (
    <li className="rounded-lg border border-border p-3" data-step={step.stepKind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{tr(`timeline.step.${step.stepKind}`)}</p>
          <p className="text-xs text-muted-foreground">
            {when.side === 'event'
              ? tr(`timeline.stepHint.${step.stepKind}`)
              : tr(when.side === 'before' ? 'timeline.when.before' : 'timeline.when.after', {
                  amount: tr(`timeline.amount.${when.unit}`, { count: when.count }),
                })}
            {step.onlineOnly ? ` · ${t('onlineOnly')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            tone={
              item.action === 'add' ? 'success' : item.action === 'replace' ? 'warning' : 'neutral'
            }
          >
            {t(`action.${item.action}`)}
          </Badge>
          <Badge>{step.isActive ? t('starts.on') : t('starts.off')}</Badge>
          <Badge>{t(`category.${step.metaCategory}`)}</Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ToneChip
          tone={status === 'new' ? 'info' : WA_TONE[status as WhatsappState]}
          label={status === 'new' ? t('wa.new') : tr(`timeline.wa.${status}`)}
        />
        {step.buttons && <Badge>{t('hasButtons')}</Badge>}
      </div>
      {item.action === 'replace' && item.existing?.hasOwnText && (
        <p className="mt-1 text-xs text-warning">{t('replaceOwnText')}</p>
      )}
      {step.stepKind === 'rebook' && !plan.rebook && (
        <UpgradeHint>{t('planNotes.rebook')}</UpgradeHint>
      )}
      {step.buttons && !plan.buttons && <UpgradeHint>{t('planNotes.buttons')}</UpgradeHint>}

      <button
        type="button"
        aria-expanded={open}
        aria-controls={ctx.id}
        onClick={() => setOpen((v) => !v)}
        className={cn(chipClass, 'mt-2 h-7')}
      >
        <ChevronDownIcon className={cn('size-3', open && 'rotate-180')} />
        {open ? t('hideMessages') : t('showMessages')}
      </button>
      {open && (
        <div id={ctx.id} className="mt-2 grid gap-3 md:grid-cols-2">
          <div className="space-y-1 rounded-md bg-muted/50 p-3">
            <p className="text-xs font-semibold">{tr('channels.email')}</p>
            <p className="text-sm font-medium">{fill(item.email.subject)}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{fill(item.email.body)}</p>
          </div>
          <div className="space-y-1 rounded-md bg-muted/50 p-3">
            <p className="text-xs font-semibold">{tr('channels.whatsapp')}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{fill(item.whatsapp.body)}</p>
            {item.whatsapp.buttons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {item.whatsapp.buttons.map((b) => (
                  <span
                    key={b}
                    className="rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                  >
                    {b}
                  </span>
                ))}
              </div>
            )}
            <p className="pt-1 font-mono text-[11px] text-muted-foreground" dir="ltr">
              {item.whatsapp.templateName}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

function SampleEditor({
  sample,
  onChange,
  language,
  typeName,
}: {
  sample: SampleValues;
  onChange: (next: SampleValues) => void;
  language: ReminderPackLanguage;
  typeName: string;
}) {
  const t = useTranslations('appointments.reminders.packs');
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-start text-sm font-medium"
      >
        {t('sample.title')}
        <ChevronDownIcon className={cn('size-3.5', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{t('sample.hint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLE_KEYS.map((k) => (
              <label key={k} className="space-y-1 text-xs font-medium">
                {t(`sample.labels.${k}`)}
                <Input
                  value={sample[k]}
                  dir={k.endsWith('_link') ? 'ltr' : undefined}
                  onChange={(e) => onChange({ ...sample, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange(defaultSample(language, typeName))}
          >
            {t('sample.reset')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ResultView({
  result,
  packKey,
  typeId,
  language,
  onClose,
}: {
  result: ReminderPackAdoptResult;
  packKey: ReminderPackKey;
  typeId: string;
  language: ReminderPackLanguage;
  onClose: () => void;
}) {
  const t = useTranslations('appointments.reminders.packs');
  const tr = useTranslations('appointments.reminders');
  // The live state of each template: asked again on demand, because Meta decides later than the answer to "Apply".
  const live = usePackPreview(packKey, typeId, language);
  const status = (name: string, fallback: WhatsappState): WhatsappState => {
    const s = live.data?.steps.find((x) => x.whatsapp.templateName === name)?.whatsapp.status;
    return s && s !== 'new' ? s : fallback;
  };
  const waiting = waitingTemplates(result.templates.map((x) => status(x.name, x.status)));
  return (
    <div className="space-y-4">
      <Alert tone="success">
        <p className="font-medium">{t('result.title')}</p>
        <p className="text-xs">
          {t('result.summary', { added: result.added, replaced: result.replaced })}
        </p>
      </Alert>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('result.templatesTitle')}</h3>
          <Button
            variant="secondary"
            size="sm"
            disabled={live.isFetching}
            onClick={() => void live.refetch()}
          >
            {live.isFetching ? t('result.refreshing') : t('result.refresh')}
          </Button>
        </div>
        {result.templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('result.templatesNone')}</p>
        ) : (
          <ul className="space-y-1.5">
            {result.templates.map((x) => {
              const s = status(x.name, x.status);
              return (
                <li
                  key={x.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block break-all font-mono text-xs" dir="ltr">
                      {x.name}
                    </span>
                    {x.metaError && (
                      <span className="block text-xs text-danger">
                        {t('result.metaError', { error: x.metaError })}
                      </span>
                    )}
                  </span>
                  <ToneChip tone={WA_TONE[s]} label={tr(`timeline.wa.${s}`)} />
                </li>
              );
            })}
          </ul>
        )}
        {waiting > 0 && <p className="text-xs text-muted-foreground">{t('result.waiting')}</p>}
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>{t('close')}</Button>
      </div>
    </div>
  );
}
