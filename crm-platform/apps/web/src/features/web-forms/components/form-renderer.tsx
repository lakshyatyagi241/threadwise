'use client';

import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { FORM_CSS } from '../lib/form-css';
import { safeHtml } from '../lib/rich-text';
import { safeRedirect } from '../lib/share';
import {
  buildPayload,
  newIdempotencyKey,
  type SubmitOutcome,
  type SubmitPayload,
} from '../lib/submit';
import { fontStylesheet, safeImageUrl, tokensToCssVars } from '../lib/theme';
import { validateAnswers } from '../lib/validate';
import {
  CONSENT_KEY,
  type AnswerValue,
  type Answers,
  type Block,
  type FieldBlock,
  type FieldIssue,
  type RenderableForm,
} from '../lib/types';

/** What the renderer needs of the CAPTCHA widget: it is mounted by the page (`useCaptcha`), not by the renderer. */
export interface CaptchaSlot {
  enabled: boolean;
  widget: ReactNode;
  /** The answer to send as `captchaToken`, or undefined when there is none (v2 not ticked, v3 could not run). */
  token: () => Promise<string | undefined>;
  /** A v2 checkbox still has to be ticked. */
  needsInteraction: boolean;
}

export interface FormRendererProps {
  form: RenderableForm;
  /** `preview` never sends anything: the builder's live view. */
  mode: 'live' | 'preview';
  embed?: boolean;
  /** Sends the submission; resolves with the outcome. Required for `live`. */
  onSubmit?: (payload: SubmitPayload) => Promise<SubmitOutcome>;
  /** Analytics beacons; they never carry personal data. */
  onEvent?: (kind: 'start' | 'step' | 'submit' | 'complete', step?: number) => void;
  /** Redirect after a successful submit; in a frame the page asks the host to navigate, otherwise it navigates itself. */
  onRedirect?: (url: string) => void;
  onSubmitted?: () => void;
  /** Called whenever the rendered height changes (embed auto-resize). */
  onResize?: (height: number) => void;
  captcha?: CaptchaSlot;
  /** The "Powered by" line (decision D8); the brand is data, never hard-coded. */
  poweredBy?: string | null;
  /** The honeypot input's name, rendered hidden from people and assistive tech; null or absent when the form has none. */
  honeypotField?: string | null;
  /** The builder previews `auto` mode both ways. */
  forceMode?: 'light' | 'dark';
}

function Rich({ html, className }: { html: string; className?: string }) {
  // `safeHtml` rebuilds the markup from an allowlist (see `lib/rich-text.ts`): nothing the API sent is trusted as markup.
  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />;
}

/**
 * The form as a visitor sees it. One component for the hosted page, the embed frame and the builder's preview, so what the owner
 * designs is what is served. The visitor's answers are checked here for the person's sake and again on the server for the product's.
 * Styling is the tokens' CSS variables on the wrapper and nothing else.
 */
export function FormRenderer(props: FormRendererProps) {
  const { form, mode, embed = false } = props;
  const t = useTranslations('web-forms.public');
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number>(0);
  const startedSent = useRef(false);
  const idempotency = useRef<string>('');
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { message: string; redirect: string | null }>(null);
  const [hp, setHp] = useState('');

  useEffect(() => {
    startedAt.current = Date.now();
    idempotency.current = newIdempotencyKey();
  }, []);

  const lastStep = form.steps.length - 1;
  const theme = form.theme;
  const vars = useMemo(() => tokensToCssVars(theme) as CSSProperties, [theme]);
  const dir = form.settings.dir ?? (form.settings.locale === 'ar' ? 'rtl' : 'ltr');
  const mark = props.forceMode ?? theme.mode;

  const { onResize } = props;
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onResize || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => onResize(el.scrollHeight));
    ro.observe(el);
    onResize(el.scrollHeight);
    return () => ro.disconnect();
  }, [onResize]);

  const issueFor = useCallback((id: string) => issues.find((i) => i.fieldId === id), [issues]);
  const { onEvent } = props;
  const setValue = useCallback(
    (id: string, v: AnswerValue) => {
      if (!startedSent.current) {
        startedSent.current = true;
        onEvent?.('start');
      }
      setAnswers((a) => ({ ...a, [id]: v }));
      setIssues((list) => list.filter((i) => i.fieldId !== id));
    },
    [onEvent],
  );

  const focusControl = (id: string) =>
    window.setTimeout(() => {
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(id)}"] [data-control]`)
        ?.focus();
    }, 0);

  const showIssues = (list: FieldIssue[]) => {
    setIssues(list);
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const stepOfIssue = (list: FieldIssue[]): number => {
    const first = list[0];
    if (!first || first.fieldId === CONSENT_KEY) return lastStep;
    const at = form.steps.findIndex((s) => s.blocks.some((b) => b.id === first.fieldId));
    return at >= 0 ? at : step;
  };

  const next = () => {
    const found = validateAnswers(form, answers, step);
    if (found.length > 0) {
      showIssues(found);
      return;
    }
    setIssues([]);
    setStep((s) => Math.min(lastStep, s + 1));
    onEvent?.('step', step + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (step < lastStep) {
      next();
      return;
    }
    const found = validateAnswers(form, answers);
    if (found.length > 0) {
      setStep(stepOfIssue(found));
      showIssues(found);
      return;
    }
    setBanner(null);
    if (mode === 'preview' || !props.onSubmit) {
      setDone({ message: form.settings.successMessage ?? '', redirect: null });
      return;
    }
    if (props.captcha?.enabled && props.captcha.needsInteraction) {
      setBanner(t('captchaNeeded'));
      return;
    }
    setBusy(true);
    onEvent?.('submit');
    const captchaToken = props.captcha?.enabled ? await props.captcha.token() : undefined;
    const payload = buildPayload(form, answers, {
      idempotencyKey: idempotency.current,
      hp,
      startedAt: startedAt.current,
      page: {
        search: window.location.search,
        referrer: document.referrer,
        href: window.location.href,
      },
      captchaToken,
    });
    let outcome: SubmitOutcome;
    try {
      outcome = await props.onSubmit(payload);
    } catch {
      outcome = { ok: false, kind: 'error' };
    }
    setBusy(false);
    if (outcome.ok) {
      onEvent?.('complete');
      props.onSubmitted?.();
      const target =
        outcome.next.type === 'redirect' && form.settings.successMode === 'redirect'
          ? safeRedirect(outcome.next.url)
          : null;
      const message =
        outcome.next.type === 'message'
          ? outcome.next.message
          : (form.settings.successMessage ?? '');
      if (target) {
        if (props.onRedirect) props.onRedirect(target);
        else window.location.assign(target);
      }
      setDone({ message, redirect: target });
      return;
    }
    if (outcome.kind === 'validation') {
      setStep(stepOfIssue(outcome.issues));
      showIssues(outcome.issues);
      if (outcome.issues[0]) focusControl(outcome.issues[0].fieldId);
      return;
    }
    setBanner(
      outcome.kind === 'rate_limited'
        ? t('rateLimited')
        : outcome.kind === 'closed'
          ? t('closed')
          : t('genericError'),
    );
  };

  const message = (issue: FieldIssue, f: FieldBlock | null): string => {
    const v = f?.validation;
    switch (issue.code) {
      case 'too_small':
        return t('errors.too_small', { min: v?.min ?? 0 });
      case 'too_large':
        return t('errors.too_large', { max: v?.max ?? 0 });
      case 'too_short':
        return t('errors.too_short', { min: v?.minLen ?? 0 });
      case 'too_long':
        return t('errors.too_long', { max: v?.maxLen ?? 0 });
      default:
        return t(`errors.${issue.code}`);
    }
  };

  const fieldOf = (id: string): FieldBlock | null => {
    for (const s of form.steps)
      for (const b of s.blocks) if (b.id === id && b.type === 'field') return b;
    return null;
  };

  const renderBlock = (b: Block): ReactNode => {
    switch (b.type) {
      case 'heading':
        return (
          <h3 key={b.id} className="wf-block wf-heading">
            {b.text}
          </h3>
        );
      case 'paragraph':
        return <Rich key={b.id} className="wf-block wf-para" html={b.html} />;
      case 'divider':
        return <hr key={b.id} className="wf-block wf-divider" />;
      case 'field':
        if (b.kind === 'hidden') return null;
        return (
          <FieldView
            key={b.id}
            f={b}
            uid={uid}
            value={answers[b.id]}
            issue={issueFor(b.id)}
            message={(i) => message(i, b)}
            onChange={(v) => setValue(b.id, v)}
          />
        );
    }
  };

  const shell = (children: ReactNode) => (
    <div
      ref={rootRef}
      className="wf-root"
      style={vars}
      data-mode={mark}
      data-embed={embed ? '1' : '0'}
      data-layout={theme.layout}
      data-labels={theme.labelPosition === 'left' ? 'left' : 'top'}
      data-button={theme.buttonStyle}
      data-button-width={theme.buttonWidth}
      data-radius={theme.radius}
      dir={dir}
      lang={form.settings.locale}
    >
      <FontLink font={theme.fontFamily} />
      <style>{FORM_CSS}</style>
      {children}
    </div>
  );

  if (done) {
    return shell(
      <div className="wf-shell">
        <div className="wf-card">
          <div className="wf-success" role="status" data-testid="form-success">
            <span className="wf-tick" aria-hidden="true">
              &#10003;
            </span>
            <h2>{t('successTitle')}</h2>
            {done.message && <Rich html={done.message} />}
            {done.redirect && (
              <p>
                <a href={done.redirect} rel="noopener noreferrer">
                  {t('continue')}
                </a>
              </p>
            )}
          </div>
        </div>
      </div>,
    );
  }

  const current = form.steps[step] ?? form.steps[0];
  const cover = safeImageUrl(theme.coverImage);
  const logo = safeImageUrl(theme.logo);
  const shown = issues.filter(
    (i) =>
      i.fieldId === CONSENT_KEY || form.steps.some((s) => s.blocks.some((b) => b.id === i.fieldId)),
  );

  return shell(
    <div className="wf-shell">
      {cover && theme.layout === 'split' && (
        <div
          className="wf-cover"
          style={{ backgroundImage: `url("${cover}")` }}
          aria-hidden="true"
        />
      )}
      <div className="wf-card">
        {logo && theme.layout !== 'minimal' && <img className="wf-logo" src={logo} alt="" />}
        <h1 className="wf-title">{form.title}</h1>
        {form.description && <Rich className="wf-desc" html={form.description} />}
        {mode === 'preview' && (
          <div className="wf-banner" role="note">
            {t('previewNotice')}
          </div>
        )}
        {lastStep > 0 && (
          <>
            <ol className="wf-steps" aria-hidden="true">
              {form.steps.map((s, i) => (
                <li key={s.id} data-done={i <= step ? '1' : '0'} />
              ))}
            </ol>
            <p className="wf-sr" aria-live="polite">
              {t('stepOf', { n: step + 1, total: form.steps.length })}
            </p>
          </>
        )}
        {shown.length > 0 && (
          <div ref={summaryRef} className="wf-summary" role="alert" tabIndex={-1}>
            <strong>{t('summaryTitle', { count: shown.length })}</strong>
            <ul>
              {shown.map((i) => {
                const f = fieldOf(i.fieldId);
                const name =
                  i.fieldId === CONSENT_KEY ? form.consent.text : (f?.label ?? i.fieldId);
                return (
                  <li key={i.fieldId}>
                    <a
                      href={`#${uid}-${i.fieldId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusControl(i.fieldId);
                      }}
                    >
                      {name}
                    </a>
                    {`: ${message(i, f)}`}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {banner && (
          <div className="wf-summary" role="alert">
            {banner}
          </div>
        )}
        <form onSubmit={(e) => void submit(e)} noValidate aria-label={form.title}>
          {current?.title && <h2 className="wf-step-title">{current.title}</h2>}
          <div className="wf-grid">{current?.blocks.map(renderBlock)}</div>
          {step === lastStep && form.consent.enabled && (
            <ConsentView
              uid={uid}
              text={form.consent.text}
              privacyUrl={form.consent.privacyUrl}
              required={form.consent.required}
              checked={answers[CONSENT_KEY] === true}
              issue={issueFor(CONSENT_KEY)}
              message={message}
              onChange={(v) => setValue(CONSENT_KEY, v)}
            />
          )}
          {props.honeypotField && (
            <div className="wf-hp" aria-hidden="true">
              <label>
                {t('honeypot')}
                <input
                  type="text"
                  name={props.honeypotField}
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                />
              </label>
            </div>
          )}
          {step === lastStep && props.captcha?.enabled && (
            <div className="wf-captcha">{props.captcha.widget}</div>
          )}
          <div className="wf-actions">
            {step > 0 && (
              <button
                type="button"
                className="wf-btn"
                data-kind="secondary"
                onClick={() => {
                  setIssues([]);
                  setStep((s) => Math.max(0, s - 1));
                }}
              >
                {t('back')}
              </button>
            )}
            <button type="submit" className="wf-btn" data-kind="primary" disabled={busy}>
              {busy ? t('sending') : step < lastStep ? t('next') : form.settings.submitLabel}
            </button>
          </div>
        </form>
        {props.poweredBy && (
          <p className="wf-brand">{t('poweredBy', { brand: props.poweredBy })}</p>
        )}
      </div>
    </div>,
  );
}

/** A web font is fetched only when the owner chose one; the address is built from a closed list (`fontStylesheet`). */
function FontLink({ font }: { font: RenderableForm['theme']['fontFamily'] }) {
  const href = fontStylesheet(font);
  return href ? <link rel="stylesheet" href={href} /> : null;
}

function ConsentView({
  uid,
  text,
  privacyUrl,
  required,
  checked,
  issue,
  message,
  onChange,
}: {
  uid: string;
  text: string;
  privacyUrl?: string;
  required: boolean;
  checked: boolean;
  issue: FieldIssue | undefined;
  message: (i: FieldIssue, f: FieldBlock | null) => string;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations('web-forms.public');
  const id = `${uid}-${CONSENT_KEY}`;
  return (
    <div
      className="wf-field wf-consent"
      data-field-id={CONSENT_KEY}
      data-invalid={issue ? '1' : '0'}
    >
      <label className="wf-choice" htmlFor={id}>
        <input
          id={id}
          data-control=""
          type="checkbox"
          checked={checked}
          aria-required={required || undefined}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          {text}
          {required ? (
            <span className="wf-req" aria-hidden="true">
              *
            </span>
          ) : null}
          {privacyUrl && /^https:\/\//i.test(privacyUrl) ? (
            <>
              {' '}
              <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
                {t('privacyPolicy')}
              </a>
            </>
          ) : null}
        </span>
      </label>
      {issue && (
        <div id={`${id}-err`} className="wf-error">
          {message(issue, null)}
        </div>
      )}
    </div>
  );
}

function FieldView({
  f,
  uid,
  value,
  issue,
  message,
  onChange,
}: {
  f: FieldBlock;
  uid: string;
  value: AnswerValue | undefined;
  issue: FieldIssue | undefined;
  message: (i: FieldIssue) => string;
  onChange: (v: AnswerValue) => void;
}) {
  const t = useTranslations('web-forms.public');
  const id = `${uid}-${f.id}`;
  const helpId = f.help ? `${id}-help` : undefined;
  const errId = issue ? `${id}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;
  const text = typeof value === 'string' ? value : '';
  const common = {
    id,
    'data-control': '',
    'aria-invalid': issue ? (true as const) : undefined,
    'aria-describedby': describedBy,
    'aria-required': f.required || undefined,
  };

  const label = (
    <span className="wf-label-text">
      {f.label}
      {f.required ? (
        <span className="wf-req" aria-hidden="true">
          *
        </span>
      ) : (
        <span className="wf-sr">{` (${t('optional')})`}</span>
      )}
    </span>
  );

  let control: ReactNode;
  let simple = false;
  switch (f.kind) {
    case 'short_text':
    case 'email':
    case 'phone':
    case 'number':
    case 'currency':
    case 'date': {
      simple = true;
      const numeric = f.kind === 'number' || f.kind === 'currency';
      const type =
        f.kind === 'email'
          ? 'email'
          : f.kind === 'phone'
            ? 'tel'
            : numeric
              ? 'number'
              : f.kind === 'date'
                ? 'date'
                : 'text';
      control = (
        <input
          {...common}
          className="wf-input"
          type={type}
          inputMode={numeric ? 'decimal' : undefined}
          step={f.kind === 'currency' ? '0.01' : numeric ? 'any' : undefined}
          min={numeric ? f.validation?.min : undefined}
          max={numeric ? f.validation?.max : undefined}
          maxLength={type === 'text' ? f.validation?.maxLen : undefined}
          autoComplete={f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : undefined}
          placeholder={f.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    }
    case 'long_text':
      simple = true;
      control = (
        <textarea
          {...common}
          className="wf-textarea"
          maxLength={f.validation?.maxLen}
          placeholder={f.placeholder}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'dropdown':
      simple = true;
      control = (
        <select
          {...common}
          className="wf-select"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{f.placeholder || t('selectPlaceholder')}</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'radio':
      control = (
        <fieldset
          className="wf-choices"
          aria-describedby={describedBy}
          aria-required={f.required || undefined}
        >
          <legend>{label}</legend>
          {(f.options ?? []).map((o, i) => (
            <label key={o.value} className="wf-choice">
              <input
                type="radio"
                name={id}
                value={o.value}
                checked={text === o.value}
                data-control={i === 0 ? '' : undefined}
                onChange={() => onChange(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      );
      break;
    case 'checkbox_group': {
      const list = Array.isArray(value) ? value : [];
      control = (
        <fieldset
          className="wf-choices"
          aria-describedby={describedBy}
          aria-required={f.required || undefined}
        >
          <legend>{label}</legend>
          {(f.options ?? []).map((o, i) => (
            <label key={o.value} className="wf-choice">
              <input
                type="checkbox"
                checked={list.includes(o.value)}
                data-control={i === 0 ? '' : undefined}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value),
                  )
                }
              />
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
      );
      break;
    }
    case 'checkbox':
      control = (
        <label className="wf-choice" htmlFor={id}>
          <input
            {...common}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            {f.label}
            {f.required ? (
              <span className="wf-req" aria-hidden="true">
                *
              </span>
            ) : null}
          </span>
        </label>
      );
      break;
    case 'rating': {
      const min = f.validation?.min ?? 1;
      const max = Math.min(10, f.validation?.max ?? 5);
      const points = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
      control = (
        <fieldset
          className="wf-choices"
          aria-describedby={describedBy}
          aria-required={f.required || undefined}
        >
          <legend>{label}</legend>
          <div className="wf-rating">
            {points.map((n, i) => (
              <label key={n}>
                <input
                  type="radio"
                  name={id}
                  value={String(n)}
                  checked={text === String(n)}
                  data-control={i === 0 ? '' : undefined}
                  onChange={() => onChange(String(n))}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
      break;
    }
    case 'hidden':
      return null;
  }

  return (
    <div
      className="wf-block wf-field"
      data-width={f.width}
      data-field-id={f.id}
      data-invalid={issue ? '1' : '0'}
      data-simple={simple ? '1' : '0'}
    >
      {simple && (
        <label className="wf-label" htmlFor={id}>
          {label}
        </label>
      )}
      {simple ? <div className="wf-control">{control}</div> : control}
      {f.help && (
        <div id={helpId} className="wf-help">
          {f.help}
        </div>
      )}
      {issue && (
        <div id={errId} className="wf-error">
          {message(issue)}
        </div>
      )}
    </div>
  );
}
