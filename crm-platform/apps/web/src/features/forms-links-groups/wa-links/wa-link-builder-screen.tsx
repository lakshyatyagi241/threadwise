'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { SaveWaChatLinkInput, WaChatLink, WaChatLinkStatus } from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useCreateWaChatLink, useSaveWaChatLink, useWaChatLink } from '../api/wa-chat-links-hooks';
import { useErrorText } from '../components/use-error-text';

const STEPS = ['destination', 'message', 'tracking'] as const;
type Step = (typeof STEPS)[number];

/** `/wa-links/new`: a fresh link, no fetch. */
export function WaLinkCreateScreen() {
  return <WaLinkBuilderForm mode="create" />;
}

/** `/wa-links/[id]`: loads the link, then hands off to the form keyed by (id, rowVersion) — see the Forms builder for why. */
export function WaLinkEditScreen({ id }: { id: string }) {
  const t = useTranslations('forms-links-groups.links');
  const errorText = useErrorText();
  const link = useWaChatLink(id);

  if (link.isPending) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (link.isError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Alert tone="danger">{errorText(link.error).text}</Alert>
      </div>
    );
  }

  return (
    <WaLinkBuilderForm
      key={`${link.data.id}:${link.data.rowVersion}`}
      mode="edit"
      id={id}
      initial={link.data}
    />
  );
}

function WaLinkBuilderForm({
  mode,
  id,
  initial,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: WaChatLink;
}) {
  const t = useTranslations('forms-links-groups.links');
  const errorText = useErrorText();
  const create = useCreateWaChatLink();
  // Always called (Rules of Hooks): in 'create' mode `id` is empty and this mutation is simply never triggered.
  const save = useSaveWaChatLink(id ?? '');

  const [step, setStep] = useState<Step>('destination');
  const [name, setName] = useState(initial?.name ?? '');
  const [status, setStatus] = useState<WaChatLinkStatus>(initial?.status ?? 'active');
  const [countryCode, setCountryCode] = useState(initial?.countryCode ?? '+1');
  const [phoneNumber, setPhoneNumber] = useState(initial?.phoneNumber ?? '');
  const [welcomeMessage, setWelcomeMessage] = useState(initial?.welcomeMessage ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt?.slice(0, 10) ?? '');
  const [utmSource, setUtmSource] = useState(initial?.utmSource ?? '');
  const [utmMedium, setUtmMedium] = useState(initial?.utmMedium ?? '');
  const [utmCampaign, setUtmCampaign] = useState(initial?.utmCampaign ?? '');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [minted, setMinted] = useState<WaChatLink | null>(
    mode === 'edit' ? (initial ?? null) : null,
  );

  const stepIndex = STEPS.indexOf(step);
  const stepValid = (s: Step): boolean => {
    if (s === 'destination')
      return name.trim().length > 0 && phoneNumber.replace(/\D/g, '').length >= 4;
    if (s === 'tracking') return slug === '' || /^[a-z0-9-]*$/.test(slug);
    return true;
  };

  const input = (): SaveWaChatLinkInput => ({
    name,
    countryCode,
    phoneNumber,
    welcomeMessage: welcomeMessage || undefined,
    slug: mode === 'create' ? slug || undefined : undefined,
    utmSource: utmSource || undefined,
    utmMedium: utmMedium || undefined,
    utmCampaign: utmCampaign || undefined,
    // `new Date("YYYY-MM-DD")` parses as UTC midnight, which is already past for most timezones east of UTC —
    // appending a bare (no `Z`) end-of-day time makes the Date constructor read it as local time instead, so the
    // link stays live through the end of the calendar day the person actually picked.
    expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
    status,
    rowVersion: initial?.rowVersion,
  });

  const onMint = () => {
    if (!stepValid('destination') || !stepValid('tracking')) {
      setNotice({ tone: 'danger', text: t('builder.fixErrors') });
      return;
    }
    if (mode === 'create') {
      create.mutate(input(), {
        onSuccess: (link) => setMinted(link),
        onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
      });
    } else {
      save.mutate(input(), {
        onSuccess: (link) => {
          setMinted(link);
          setNotice({ tone: 'success', text: t('notice.saved') });
        },
        onError: (err) => setNotice({ tone: 'danger', text: errorText(err).text }),
      });
    }
  };

  const busy = create.isPending || save.isPending;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <a href="/wa-links" className="text-sm text-muted-foreground hover:underline">
        {t('builder.back')}
      </a>
      <h1 className="mt-1 text-2xl font-semibold">
        {mode === 'create' ? t('builder.newHeading') : name}
      </h1>

      <div className="mt-4 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => (i <= stepIndex || stepValid(step) ? setStep(s) : undefined)}
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${
              s === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {i + 1}. {t(`builder.step.${s}`)}
          </button>
        ))}
      </div>

      {notice && (
        <Alert tone={notice.tone} className="mt-4">
          {notice.text}
        </Alert>
      )}

      <Card className="mt-5 space-y-4 p-5">
        {step === 'destination' && (
          <>
            <Field label={t('builder.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={140} />
            </Field>
            <Field label={t('builder.status')}>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as WaChatLinkStatus)}
              >
                <option value="active">{t('status.live')}</option>
                <option value="paused">{t('status.paused')}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-[100px_1fr] gap-3">
              <Field label={t('builder.countryCode')}>
                <Input
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  maxLength={8}
                />
              </Field>
              <Field label={t('builder.phoneNumber')}>
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  maxLength={24}
                />
              </Field>
            </div>
          </>
        )}

        {step === 'message' && (
          <Field label={t('builder.welcomeMessage')} hint={t('builder.welcomeMessageHint')}>
            <Textarea
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              maxLength={4000}
              rows={4}
            />
          </Field>
        )}

        {step === 'tracking' && (
          <>
            {mode === 'create' && (
              <Field label={t('builder.slug')} hint={t('builder.slugHint')}>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  maxLength={64}
                  placeholder={t('builder.slugPlaceholder')}
                />
              </Field>
            )}
            <Field label={t('builder.expiresAt')}>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
            <Field label={t('builder.utmSource')}>
              <Input
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label={t('builder.utmMedium')}>
              <Input
                value={utmMedium}
                onChange={(e) => setUtmMedium(e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label={t('builder.utmCampaign')}>
              <Input
                value={utmCampaign}
                onChange={(e) => setUtmCampaign(e.target.value)}
                maxLength={80}
              />
            </Field>
          </>
        )}
      </Card>

      <div className="mt-5 flex justify-between">
        <Button
          variant="secondary"
          disabled={stepIndex === 0}
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
        >
          {t('builder.previous')}
        </Button>
        {stepIndex < STEPS.length - 1 ? (
          <Button disabled={!stepValid(step)} onClick={() => setStep(STEPS[stepIndex + 1])}>
            {t('builder.next')}
          </Button>
        ) : (
          <Button disabled={busy} onClick={onMint}>
            {busy ? t('builder.saving') : mode === 'create' ? t('builder.mint') : t('builder.save')}
          </Button>
        )}
      </div>

      {minted && (
        <Card className="mt-6 space-y-3 p-5">
          <h2 className="text-sm font-semibold">{t('builder.mintedHeading')}</h2>
          <Field label={t('builder.shortUrl')}>
            <Input
              readOnly
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}${minted.shortPath}`}
            />
          </Field>
          <Field label={t('builder.waUrl')}>
            <Input readOnly value={minted.waUrl} />
          </Field>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(
              typeof window !== 'undefined'
                ? `${window.location.origin}${minted.shortPath}`
                : minted.shortPath,
            )}`}
            alt={t('builder.qrAlt')}
            width={160}
            height={160}
          />
        </Card>
      )}
    </div>
  );
}
