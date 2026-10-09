'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import type { CampaignConfig } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  isUnofficialDisabledError,
  offerSenders,
  submittableSenderKey,
} from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import {
  useAttributeCatalog,
  useAudienceContacts,
  useAudienceGroups,
  useAudienceSegments,
  useAudienceTags,
  type AudienceFilter,
} from '@/features/broadcasts/api/compose';
import {
  KEYS,
  createCampaign,
  download,
  updateCampaign,
  useBuilder,
  useCampaignConfig,
} from '../api/campaigns';
import {
  EMPTY_FORM,
  defaultSchedule,
  fromConfig,
  problems,
  submitKey,
  toInput,
  type BuilderForm,
  type Problem,
} from '../lib/builder-model';
import {
  WIZARD_STEPS,
  applyAiCopy,
  initialRecipientMode,
  recipientTotals,
  stepProblems,
  withRecipientMode,
  type RecipientMode,
  type WizardStep,
} from '../lib/wizard-model';
import { coerceForEngine, engineOf, senderOf, templatesFor } from '../lib/engine-gate';
import { AiModal } from './builder/ai-modal';
import { BuilderHeader } from './builder/header';
import { LivePreview } from './builder/live-preview';
import { StepCompose } from './builder/step-compose';
import { StepRecipients } from './builder/step-recipients';
import { StepReview } from './builder/step-review';
import { StepSchedule } from './builder/step-schedule';
import { StepSetup } from './builder/step-setup';
import { Stepper } from './builder/stepper';

/**
 * `/campaigns/create` and `/campaigns/:id/edit` (WD-CAMP-002 to 010): the builder, as WaDesk's five steps (Setup, Compose, Recipients,
 * Schedule, Review) with a live preview beside them.
 */
export function BuilderScreen({ id }: { id?: string }) {
  const t = useTranslations('campaigns.builder');
  const config = useCampaignConfig(id);
  const builder = useBuilder();
  const session = useSession();
  const zone = session.org.timezone ?? 'UTC';

  if (id && config.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (id && (config.isError || !config.data)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert tone="danger">{t('loadError')}</Alert>
      </div>
    );
  }
  return <Builder key={id ?? 'new'} id={id} config={config.data} builder={builder} zone={zone} />;
}

function Builder({
  id,
  config,
  builder,
  zone,
}: {
  id?: string;
  config: CampaignConfig | undefined;
  builder: ReturnType<typeof useBuilder>;
  zone: string;
}) {
  const t = useTranslations('campaigns.builder');
  // Personal numbers (the unofficial engine) are offered only while the platform has switched it on.
  const unofficial = useUnofficialWhatsapp();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canContacts = useCan('record.contacts.read');
  const canGroups = useCan('record.contact-groups.read');
  const canTags = useCan('record.tags.read');
  const canSegments = useCan('record.segments.read');
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>({});
  const contacts = useAudienceContacts(canContacts, audienceFilter);
  const segments = useAudienceSegments(canSegments);
  const groups = useAudienceGroups(canGroups);
  const tags = useAudienceTags(canTags);
  const catalog = useAttributeCatalog();

  const [stored, setForm] = useState<BuilderForm>(() =>
    config
      ? fromConfig(config, zone)
      : { ...EMPTY_FORM, type: 'custom', timezone: zone, ...defaultSchedule(new Date(), zone) },
  );
  const [step, setStep] = useState<WizardStep>('setup');
  const [mode, setMode] = useState<RecipientMode>(() => initialRecipientMode(stored));
  const [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Problem[]>([]);
  const patch = (p: Partial<BuilderForm>) => {
    setBlocked([]);
    setForm((f) => ({ ...f, ...p }));
  };
  const editing = Boolean(id);
  const minDate = useMemo(
    () => defaultSchedule(new Date(), stored.timezone).sendDate,
    [stored.timezone],
  );
  const data = builder.data;
  // What the picked number allows (see lib/engine-gate): its engine, its templates, and the form as that number can send it.
  const senders = useMemo(
    () => offerSenders(data?.senders ?? [], unofficial),
    [data?.senders, unofficial],
  );
  const sender = senderOf(stored.senderKey, senders);
  const engine = engineOf(stored.senderKey);
  const usable = useMemo(
    () => templatesFor(data?.templates ?? [], engine, sender),
    [data?.templates, engine, sender],
  );
  const form = useMemo(
    () => (data ? { ...stored, ...coerceForEngine(stored, engine, usable) } : stored),
    [data, stored, engine, usable],
  );
  const at = WIZARD_STEPS.indexOf(step);

  const submit = async (draft: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = toInput(
        {
          ...form,
          senderKey: submittableSenderKey(form.senderKey, data?.senders ?? [], unofficial),
        },
        { draft },
      );
      const res = id ? await updateCampaign(id, body) : await createCampaign(body);
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(res.message, 'success');
      router.push(`/campaigns/${res.campaign.id}`);
    } catch (e) {
      setError(
        isUnofficialDisabledError(e)
          ? t('unofficialDisabled')
          : e instanceof ApiError
            ? e.message
            : t('failed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const sampleCsv = async () => {
    try {
      const { blob, filename } = await download('/campaigns/sample-csv');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
    }
  };

  const senderLabel = sender
    ? `${sender.label}${sender.phone ? ` · ${sender.phone}` : ''}`
    : t('setup.defaultSender');
  const sizes = useMemo(
    () => ({
      groups: Object.fromEntries((data?.groups ?? []).map((g) => [g.id, g.members])),
      tags: Object.fromEntries((data?.tags ?? []).map((x) => [x.id, x.members])),
    }),
    [data?.groups, data?.tags],
  );
  const totals = recipientTotals(form, sizes);
  const scheduleLabel =
    form.scheduleType === 'now'
      ? t('review.now')
      : form.scheduleType === 'scheduled'
        ? `${form.sendDate} ${form.sendTime} · ${form.timezone}`
        : t('review.recurring', { every: t(`delivery.repeats.${form.repeatInterval}`) });

  // A step can be opened when nothing before it is missing.
  const reachable = (s: WizardStep) =>
    WIZARD_STEPS.slice(0, WIZARD_STEPS.indexOf(s)).every((x) => stepProblems(form, x).length === 0);
  const go = (s: WizardStep) => {
    setBlocked([]);
    setStep(s);
  };
  const next = () => {
    const fix = stepProblems(form, step);
    if (fix.length > 0) return setBlocked(fix);
    const to = WIZARD_STEPS[at + 1];
    if (to) go(to);
  };
  const fixAll = problems(form);

  return (
    <div className="min-h-full">
      <BuilderHeader
        editing={editing}
        backHref={id ? `/campaigns/${id}` : '/campaigns'}
        busy={busy}
        canDraft={problems(form, { draft: true }).length === 0}
        onAi={() => setAiOpen(true)}
        onDraft={() => void submit(true)}
      />
      <div className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        {error && (
          <Alert tone="danger" className="mb-4">
            {error}
          </Alert>
        )}
        {builder.isError && (
          <Alert tone="danger" className="mb-4">
            {t('builderError')}
          </Alert>
        )}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_342px]">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <Stepper current={step} reachable={reachable} onGo={go} />
            <form
              className="p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (step === 'review') {
                  if (fixAll.length === 0) void submit(false);
                } else next();
              }}
            >
              {step === 'setup' && (
                <StepSetup form={form} patch={patch} senders={senders} engine={engine} />
              )}
              {step === 'compose' && (
                <StepCompose
                  form={form}
                  patch={patch}
                  builder={data}
                  catalog={catalog.data}
                  engine={engine}
                  templates={usable}
                />
              )}
              {step === 'recipients' && (
                <StepRecipients
                  form={form}
                  patch={patch}
                  mode={mode}
                  onMode={(m) => {
                    setMode(m);
                    patch(withRecipientMode(form, m));
                  }}
                  lists={{
                    tags: tags.data?.data ?? [],
                    groups: groups.data?.data ?? [],
                    segments: segments.data?.data ?? [],
                    contacts: contacts.data?.data ?? [],
                    contactsDenied: !canContacts,
                    filter: audienceFilter,
                    onFilter: setAudienceFilter,
                  }}
                  onSample={() => void sampleCsv()}
                  onCsvTooBig={() => toast(t('audience.csvTooBig'), 'danger')}
                />
              )}
              {step === 'schedule' && <StepSchedule form={form} patch={patch} minDate={minDate} />}
              {step === 'review' && (
                <StepReview
                  form={form}
                  senderLabel={senderLabel}
                  scheduleLabel={scheduleLabel}
                  totals={totals}
                  onGo={go}
                />
              )}

              {blocked.length > 0 && (
                <ul
                  role="alert"
                  className="mt-5 list-inside list-disc rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs"
                >
                  {blocked.map((p) => (
                    <li key={p}>{t(`problems.${p}`)}</li>
                  ))}
                </ul>
              )}

              <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-full"
                  disabled={at === 0}
                  onClick={() => {
                    const to = WIZARD_STEPS[at - 1];
                    if (to) go(to);
                  }}
                >
                  {t('steps.previous')}
                </Button>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t('steps.of', { n: at + 1, total: WIZARD_STEPS.length })}
                </span>
                {step === 'review' ? (
                  <Button
                    type="submit"
                    className="rounded-full"
                    disabled={busy || fixAll.length > 0}
                  >
                    {busy ? <Spinner /> : t(`submit.${submitKey(form, editing)}`)}
                  </Button>
                ) : (
                  <Button type="submit" className="rounded-full">
                    {t('steps.next')}
                  </Button>
                )}
              </div>
            </form>
          </div>

          <LivePreview
            form={form}
            builder={data}
            engine={engine}
            senderLabel={sender ? senderLabel : null}
            recipients={totals.total}
            step={at + 1}
            stepCount={WIZARD_STEPS.length}
          />
        </div>
      </div>

      <AiModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onApply={(copy) => {
          patch({});
          setForm((f) => applyAiCopy(f, copy));
          setStep('compose');
          toast(t('ai.applied'), 'success');
        }}
      />
    </div>
  );
}
