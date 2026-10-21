'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Checkbox, Field, Input, Select, Spinner, Textarea, cn } from '@crm/ui';
import { publicApi } from '../api/service';
import type { PublicBooking as PublicBookingData, PublicType } from '../api/schemas';
import { errorKind, fieldErrors } from '../lib/errors';
import { formatMoney } from '../lib/money';
import { safeColor } from '../lib/format';
import {
  EMPTY_DETAILS,
  LIMITS,
  askedQuestions,
  buildBookInput,
  phoneRequired,
  placeServerErrors,
  priceLines,
  validateAnswers,
  validateDetails,
  type AskedQuestion,
  type BuiltBooking,
  type Details,
  type DetailField,
  type FieldProblem,
  type PriceLines,
  type ServerProblems,
} from '../lib/public-booking';
import type { Slot } from '../lib/slots';
import { browserZone } from '../lib/zone';
import {
  AlertIcon,
  ArrowLeftIcon,
  ChevronLeftIcon,
  ClockIcon,
  CoinIcon,
  InfoIcon,
  flip,
} from './icons';
import { PublicBooked } from './public-booked';
import {
  Banner,
  InfoRow,
  LocationIcon,
  ProblemCard,
  PublicSkeleton,
  WhenRows,
  useDurationLabel,
} from './public-parts';
import { PublicShell } from './public-shell';
import { useBookingTheme } from './public-theme';
import { SlotPicker } from './slot-picker';

/**
 * `/book/<org>/<service>`: choose a time in your own time zone, tell us who you are and answer the service's questions,
 * confirm, and land on the page that holds your calendar entry and manage link. The server decides whether the time is still
 * free; a lost race sends the visitor back to the times with the form still filled in.
 */
/** The address of the privacy link, as the visitor reads it; the link itself was checked to be https when the line was saved. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function PublicBooking({ org, slug }: { org: string; slug: string }) {
  const q = useQuery({
    queryKey: ['appointments', 'public', 'type', org, slug],
    queryFn: ({ signal }) => publicApi.type(org, slug, signal),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <PublicShell orgName={q.data?.org.name} org={q.data?.org.slug ?? org} theme={q.data?.theme}>
      {q.isPending ? (
        <PublicSkeleton />
      ) : q.isError ? (
        <ProblemCard
          error={q.error}
          context="service"
          onRetry={() => void q.refetch()}
          backHref={`/book/${encodeURIComponent(org)}`}
        />
      ) : (
        <Service org={org} slug={slug} orgName={q.data.org.name} type={q.data.type} />
      )}
    </PublicShell>
  );
}

type Step = 'time' | 'details' | 'done';
type Notice = 'slotTaken' | 'validation' | 'rateLimited' | 'network' | 'unavailable';

/** One attempt of the form: a retried send (after a dropped connection) reuses its key, so the visitor is booked once. */
interface Attempt {
  body: string;
  key: string;
}

/** What the editor's preview swaps in so the real page runs without a server: its own times, and a confirm that books nothing. */
export interface ServicePreview {
  loadSlots: (range: { from: string; to: string }) => Promise<Slot[]>;
}

export function Service({
  org,
  slug,
  orgName,
  type,
  preview,
}: {
  org: string;
  slug: string;
  orgName: string;
  type: PublicType;
  preview?: ServicePreview;
}) {
  const t = useTranslations('appointments.public');
  const theme = useBookingTheme();
  const qc = useQueryClient();
  const scope = preview ? `preview:${slug}` : `public:${org}:${slug}`;
  const [zone, setZone] = useState(() => browserZone());
  const [step, setStep] = useState<Step>('time');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [values, setValues] = useState<Record<number, string>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState<ServerProblems | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [consentTicked, setConsentTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<PublicBookingData | null>(null);
  const busyRef = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const base = useId();

  // Moving between steps moves the keyboard and the screen reader to the new step's heading.
  useEffect(() => {
    if (step !== 'time') headingRef.current?.focus();
  }, [step]);

  const asked = askedQuestions(type.questions);
  const detailProblems = validateDetails(details, type.questions);
  const answerProblems = validateAnswers(type.questions, values);
  const price = priceLines(type);

  const show = (key: string) => submitted || touched.has(key);
  const touch = (key: string) => setTouched((s) => (s.has(key) ? s : new Set(s).add(key)));

  function changeDetail(field: DetailField, value: string) {
    setDetails((d) => ({ ...d, [field]: value }));
    setServer((s) =>
      s?.details[field] ? { ...s, details: { ...s.details, [field]: undefined } } : s,
    );
  }
  function changeAnswer(index: number, value: string) {
    setValues((v) => ({ ...v, [index]: value }));
    setServer((s) => {
      if (!s?.answers[index]) return s;
      const { [index]: _gone, ...rest } = s.answers;
      return { ...s, answers: rest };
    });
  }

  function chooseAnotherTime() {
    // The times the picker holds are out of date: ask again, keep what was typed.
    void qc.invalidateQueries({ queryKey: ['appointments', 'picker', scope] });
    setSlot(null);
    setStep('time');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    // The editor's preview shows the form and its validation, but never sends anything.
    if (preview) return;
    if (busyRef.current || !slot) return;
    setSubmitted(true);
    const firstBad = (['name', 'email', 'phone'] as const).find((f) => detailProblems[f]);
    const firstAnswer = asked.find((a) => answerProblems[a.index]);
    if (firstBad || firstAnswer) {
      document
        .getElementById(firstBad ? `${base}-${firstBad}` : `${base}-q${firstAnswer!.index}`)
        ?.focus();
      return;
    }
    const built: BuiltBooking = buildBookInput({
      startsAt: slot.start,
      zone,
      details,
      questions: type.questions,
      values,
      ...(type.consent && consentTicked ? { consentVersion: type.consent.version } : {}),
    });
    const body = JSON.stringify(built.input);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await publicApi.book(org, slug, built.input, attempt.current.key);
      setBooked(res.booking);
      setStep('done');
      // The time just taken must not be offered again to the next person who opens this page in this browser.
      void qc.invalidateQueries({ queryKey: ['appointments', 'picker', scope] });
    } catch (err) {
      const kind = errorKind(err);
      if (kind === 'slotTaken') {
        attempt.current = null;
        setNotice('slotTaken');
        chooseAnotherTime();
      } else if (kind === 'validation') {
        attempt.current = null;
        const placed = placeServerErrors(fieldErrors(err), built, type.questions);
        if (placed.startsAt) {
          setNotice('slotTaken');
          chooseAnotherTime();
        } else {
          setServer(placed);
          setNotice('validation');
        }
      } else if (kind === 'rateLimited') setNotice('rateLimited');
      else if (kind === 'notFound' || kind === 'gone' || kind === 'planDisabled')
        setNotice('unavailable');
      else setNotice('network');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (step === 'done' && booked) {
    return <PublicBooked org={org} orgName={orgName} booking={booked} visitorZone={zone} />;
  }

  return (
    <div className="space-y-4">
      {theme.welcomeText && (
        <p
          className="whitespace-pre-line break-words rounded-xl border border-border bg-background p-4 text-sm shadow-sm"
          dir="auto"
          data-testid="booking-welcome"
        >
          {theme.welcomeText}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-start">
        <ServiceInfo org={org} type={type} price={price} />

        <section
          className="min-w-0 rounded-xl border border-border bg-background p-4 shadow-sm sm:p-5"
          aria-labelledby={`${base}-step`}
        >
          {step === 'time' ? (
            <div className="space-y-4">
              <h2 id={`${base}-step`} className="text-base font-semibold">
                {t('step.time')}
              </h2>
              {notice === 'slotTaken' && (
                <Banner
                  tone="warning"
                  icon={<AlertIcon className="size-5" />}
                  title={t('book.slotTaken')}
                >
                  {t('book.slotTakenHint')}
                </Banner>
              )}
              <SlotPicker
                scope={scope}
                load={async (range, signal) =>
                  preview
                    ? preview.loadSlots(range)
                    : (await publicApi.typeSlots(org, slug, range, signal)).slots
                }
                zone={zone}
                onZoneChange={setZone}
                value={slot?.start ?? null}
                onChange={(s) => {
                  setSlot(s);
                  if (s) setNotice(null);
                }}
                horizonDays={type.maxAdvanceDays}
                typeZone={type.timezone}
              />
              <div className="border-t border-border pt-4">
                {slot ? (
                  <div className="space-y-3" aria-live="polite">
                    <div className="space-y-2 rounded-lg bg-muted/60 p-3">
                      <WhenRows
                        startsAt={slot.start}
                        endsAt={slot.end}
                        visitorZone={zone}
                        serviceZone={type.timezone}
                      />
                    </div>
                    <Button
                      className="h-11 w-full"
                      variant="brand"
                      onClick={() => setStep('details')}
                    >
                      {t('step.continue')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {t('step.pickHint')}
                  </p>
                )}
              </div>
            </div>
          ) : (
            slot && (
              <form
                onSubmit={(e) => void submit(e)}
                noValidate
                className="space-y-5"
                aria-busy={busy}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={chooseAnotherTime}
                    disabled={busy}
                    aria-label={t('step.changeTime')}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-50"
                  >
                    <ChevronLeftIcon className={flip} />
                  </button>
                  <h2
                    id={`${base}-step`}
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-base font-semibold outline-none"
                  >
                    {t('step.details')}
                  </h2>
                </div>

                <div className="space-y-2 rounded-lg bg-muted/60 p-3">
                  <WhenRows
                    startsAt={slot.start}
                    endsAt={slot.end}
                    visitorZone={zone}
                    serviceZone={type.timezone}
                  />
                </div>

                {type.introMessage && (
                  <div className="flex gap-3 rounded-lg border border-border p-3 text-sm">
                    <InfoIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <p className="min-w-0 whitespace-pre-line break-words" dir="auto">
                      {type.introMessage}
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  <DetailFields
                    base={base}
                    details={details}
                    problems={detailProblems}
                    server={server}
                    show={show}
                    touch={touch}
                    onChange={changeDetail}
                    phoneRequired={phoneRequired(type.questions)}
                  />
                  {asked.map((a) => (
                    <QuestionField
                      key={a.index}
                      id={`${base}-q${a.index}`}
                      asked={a}
                      value={values[a.index] ?? ''}
                      problem={show(`q${a.index}`) ? (answerProblems[a.index] ?? null) : null}
                      serverFlagged={Boolean(server?.answers[a.index])}
                      onBlur={() => touch(`q${a.index}`)}
                      onChange={(v) => changeAnswer(a.index, v)}
                    />
                  ))}
                  {type.consent && (
                    <Checkbox
                      id={`${base}-consent`}
                      checked={consentTicked}
                      onChange={(e) => setConsentTicked(e.target.checked)}
                      disabled={busy}
                      label={
                        <span dir="auto" className="text-sm">
                          {type.consent.text}
                          {type.consent.url && (
                            <>
                              {' '}
                              <a
                                href={type.consent.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                {hostOf(type.consent.url)}
                              </a>
                            </>
                          )}
                        </span>
                      }
                    />
                  )}
                </div>

                {price && <PriceSummary lines={price} />}

                {type.requiresApproval && (
                  <InfoRow icon={<InfoIcon />} className="text-muted-foreground">
                    {t('service.approvalNote')}
                  </InfoRow>
                )}

                <div aria-live="polite">
                  {notice && notice !== 'slotTaken' && <NoticeBanner notice={notice} />}
                </div>

                <Button type="submit" variant="brand" className="h-11 w-full" disabled={busy}>
                  {busy && <Spinner label={t('book.sending')} />}
                  {type.requiresApproval
                    ? t('book.request')
                    : theme.buttonLabel || t('book.confirm')}
                </Button>
              </form>
            )
          )}
        </section>
      </div>
    </div>
  );
}

function NoticeBanner({ notice }: { notice: Exclude<Notice, 'slotTaken'> }) {
  const t = useTranslations('appointments.public.book.notice');
  return (
    <Banner tone="danger" icon={<AlertIcon className="size-5" />} title={t(`${notice}.title`)}>
      {t(`${notice}.message`)}
    </Banner>
  );
}

// ---- left panel ----------------------------------------------------------------------------------------------------------

function ServiceInfo({
  org,
  type,
  price,
}: {
  org: string;
  type: PublicType;
  price: PriceLines | null;
}) {
  const t = useTranslations('appointments.public');
  const locale = useLocale();
  const duration = useDurationLabel();
  return (
    <aside className="min-w-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <span
        aria-hidden="true"
        className="block h-1.5"
        style={{ backgroundColor: safeColor(type.color) }}
      />
      <div className="space-y-3 p-4 sm:p-5">
        <Link
          href={`/book/${encodeURIComponent(org)}`}
          className="inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className={cn('size-3.5', flip)} />
          {t('service.allServices')}
        </Link>
        <h1 className="text-xl font-semibold" dir="auto">
          {type.name}
        </h1>
        {type.description && (
          <p className="whitespace-pre-line break-words text-sm text-muted-foreground" dir="auto">
            {type.description}
          </p>
        )}
        <div className="space-y-2 pt-1">
          <InfoRow icon={<ClockIcon />}>{duration(type.durationMinutes)}</InfoRow>
          <InfoRow icon={<LocationIcon type={type.locationType} />}>
            <span>{t(`location.${type.locationType}`)}</span>
            {type.locationType === 'address' && type.locationValue && (
              <span
                className="mt-0.5 block whitespace-pre-line break-words text-muted-foreground"
                dir="auto"
              >
                {type.locationValue}
              </span>
            )}
          </InfoRow>
          {price && (
            <InfoRow icon={<CoinIcon />}>
              <span className="font-medium">
                {formatMoney(price.totalMinor, price.currency, locale)}
              </span>
              {price.taxMinor > 0 && (
                <span className="ms-1 text-xs text-muted-foreground">
                  {t('price.inclTax', { pct: price.taxPct })}
                </span>
              )}
            </InfoRow>
          )}
          {type.requiresApproval && (
            <InfoRow icon={<InfoIcon />} className="text-muted-foreground">
              {t('service.approvalNote')}
            </InfoRow>
          )}
        </div>
      </div>
    </aside>
  );
}

// ---- the form ------------------------------------------------------------------------------------------------------------

const problemText = (
  t: (key: string) => string,
  p: FieldProblem | null,
  invalidKey: string,
): string | undefined =>
  p === 'required'
    ? t('form.required')
    : p === 'tooLong'
      ? t('form.tooLong')
      : p === 'invalid'
        ? t(invalidKey)
        : undefined;

function Label({ text, required }: { text: string; required: boolean }) {
  const t = useTranslations('appointments.public.form');
  return (
    <>
      {text}{' '}
      {required ? (
        <span aria-hidden="true" className="ms-0.5 text-danger">
          *
        </span>
      ) : (
        <span className="ms-1.5 text-xs font-normal text-muted-foreground">{t('optional')}</span>
      )}
    </>
  );
}

function DetailFields({
  base,
  details,
  problems,
  server,
  show,
  touch,
  onChange,
  phoneRequired,
}: {
  base: string;
  details: Details;
  problems: Partial<Record<DetailField, FieldProblem>>;
  server: ServerProblems | null;
  show: (key: string) => boolean;
  touch: (key: string) => void;
  onChange: (field: DetailField, value: string) => void;
  phoneRequired: boolean;
}) {
  const t = useTranslations('appointments.public');
  const err = (f: DetailField, invalidKey: string): string | undefined =>
    (show(f)
      ? problemText(t as unknown as (k: string) => string, problems[f] ?? null, invalidKey)
      : undefined) ?? (server?.details[f] ? t('form.serverInvalid') : undefined);
  const nameError = err('name', 'form.invalid.text');
  const emailError = err('email', 'form.invalid.email');
  const phoneError = err('phone', 'form.invalid.phone');
  return (
    <>
      <Field
        label={<Label text={t('form.name')} required />}
        htmlFor={`${base}-name`}
        error={nameError}
      >
        <Input
          id={`${base}-name`}
          value={details.name}
          autoComplete="name"
          maxLength={LIMITS.name + 20}
          invalid={Boolean(nameError)}
          aria-required="true"
          onBlur={() => touch('name')}
          onChange={(e) => onChange('name', e.target.value)}
        />
      </Field>
      <Field
        label={<Label text={t('form.email')} required />}
        htmlFor={`${base}-email`}
        error={emailError}
      >
        <Input
          id={`${base}-email`}
          type="email"
          inputMode="email"
          dir="ltr"
          value={details.email}
          autoComplete="email"
          invalid={Boolean(emailError)}
          aria-required="true"
          onBlur={() => touch('email')}
          onChange={(e) => onChange('email', e.target.value)}
        />
      </Field>
      <Field
        label={<Label text={t('form.phone')} required={phoneRequired} />}
        htmlFor={`${base}-phone`}
        error={phoneError}
      >
        <Input
          id={`${base}-phone`}
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={details.phone}
          autoComplete="tel"
          invalid={Boolean(phoneError)}
          aria-required={phoneRequired || undefined}
          onBlur={() => touch('phone')}
          onChange={(e) => onChange('phone', e.target.value)}
        />
      </Field>
    </>
  );
}

function QuestionField({
  id,
  asked,
  value,
  problem,
  serverFlagged,
  onBlur,
  onChange,
}: {
  id: string;
  asked: AskedQuestion;
  value: string;
  problem: FieldProblem | null;
  serverFlagged: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('appointments.public');
  const { question } = asked;
  const error =
    problemText(t as unknown as (k: string) => string, problem, `form.invalid.${question.type}`) ??
    (serverFlagged ? t('form.serverInvalid') : undefined);
  const common = {
    id,
    value,
    invalid: Boolean(error),
    'aria-required': question.required ? ('true' as const) : undefined,
    onBlur,
  };
  let control: ReactNode;
  switch (question.type) {
    case 'textarea':
      control = (
        <Textarea
          {...common}
          rows={4}
          dir="auto"
          maxLength={LIMITS.textarea + 100}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'select':
      control = (
        <Select {...common} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('form.choose')}</option>
          {question.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
      break;
    case 'number':
      control = (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          dir="ltr"
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'email':
      control = (
        <Input
          {...common}
          type="email"
          inputMode="email"
          dir="ltr"
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'phone':
      control = (
        <Input
          {...common}
          type="tel"
          inputMode="tel"
          dir="ltr"
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'date':
      control = (
        <Input {...common} type="date" dir="ltr" onChange={(e) => onChange(e.target.value)} />
      );
      break;
    default:
      control = (
        <Input
          {...common}
          type="text"
          dir="auto"
          maxLength={LIMITS.text + 50}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <Field
      label={<Label text={question.label} required={question.required} />}
      htmlFor={id}
      error={error}
    >
      {control}
    </Field>
  );
}

// ---- price ---------------------------------------------------------------------------------------------------------------

/** Fee, tax, total and what a deposit would be. Nothing is collected here: the note says so plainly. */
function PriceSummary({ lines }: { lines: PriceLines }) {
  const t = useTranslations('appointments.public.price');
  const locale = useLocale();
  const money = (minor: number) => formatMoney(minor, lines.currency, locale);
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <h3 className="mb-2 font-semibold">{t('title')}</h3>
      <dl className="space-y-1.5">
        <Row label={t('fee')} value={money(lines.feeMinor)} />
        {lines.taxMinor > 0 && (
          <Row label={t('tax', { pct: lines.taxPct })} value={money(lines.taxMinor)} />
        )}
        <Row label={t('total')} value={money(lines.totalMinor)} strong />
        {lines.dueNowMinor > 0 && <Row label={t('dueNow')} value={money(lines.dueNowMinor)} />}
      </dl>
      <p className="mt-3 flex gap-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5" />
        <span>{t('notCollected')}</span>
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3',
        strong && 'border-t border-border pt-1.5 font-semibold',
      )}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd dir="ltr">{value}</dd>
    </div>
  );
}
