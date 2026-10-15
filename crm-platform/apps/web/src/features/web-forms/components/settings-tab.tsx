'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import {
  consentChannels,
  FORM_CAPTCHA_MODES,
  FORM_CONSENT_CHANNELS,
  lifecycleStageSchema,
  type FormConsentChannel,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  MultiSelect,
  Select,
  Switch,
  Textarea,
} from '@crm/ui';
import { safeRedirect } from '../lib/share';
import {
  MAX_CONSENT_TEXT,
  MAX_NOTIFY_EMAILS,
  MAX_NOTIFY_USERS,
  MAX_OWNER_USERS,
  MAX_SUBMIT_LABEL,
  MAX_SUCCESS_MESSAGE,
  MAX_TAGS,
  RATE_LIMIT_RANGES,
  RETENTION_RANGE,
  checkEmail,
  checkTag,
  consentStatement,
  DEFAULT_CONSENT_TEXT,
  consentWithText,
  toggleConsentChannel,
  emailsIssue,
  ownerRuleForMode,
  ownerRuleIssue,
  parseBoundedInt,
  privacyUrlIssue,
  redirectIssue,
  retentionAfterToggle,
  submitLabelIssue,
} from '../lib/settings-model';
import type { Definition, FormCaptchaMode } from '../lib/types';
import type { BuilderTabProps } from './builder-types';
import { useFormProtection } from '../api/forms';
import { useComplianceLinks } from '@/features/compliance-center/api/hooks';
import { useFormUsers } from './forms-users';
import { PaymentPanel } from './payment-panel';

const CONTROL_ERROR = 'text-xs text-danger';
const HINT = 'text-xs text-muted-foreground';
const OWNER_MODES = ['unassigned', 'fixed', 'round_robin'] as const;
const COMPANY_MATCHES = ['none', 'email_domain', 'name_or_domain'] as const;
const NAME_MAX = 120;

// --- small building blocks ------------------------------------------------------------------------------------------------------

interface ControlA11y {
  id: string;
  'aria-describedby': string | undefined;
  invalid: boolean;
}

/** A label tied to its control by id, with the hint or the error tied back by `aria-describedby`. */
export function FieldBox({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (a: ControlA11y) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  const message = error || hint;
  return (
    <div className={`min-w-0 space-y-1.5 text-sm ${className ?? ''}`}>
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children({ id, 'aria-describedby': message ? msgId : undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={msgId} role="alert" className={CONTROL_ERROR}>
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className={HINT}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5 text-sm">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className={HINT}>
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        label={label}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card className="p-0">
      <section aria-labelledby={id} className="space-y-4 p-4 sm:p-5">
        <header className="space-y-1">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          <p className={HINT}>{description}</p>
        </header>
        {children}
      </section>
    </Card>
  );
}

/**
 * A list built one entry at a time (tags, emails, allowed origins): a box with an Add button, the entries as removable chips, and
 * the reason an entry was refused shown under the box. `onAdd` returns that reason, or null when it took the entry.
 */
export function ChipEditor({
  label,
  hint,
  placeholder,
  values,
  onAdd,
  onRemove,
  addLabel,
  removeLabel,
  emptyLabel,
  countLabel,
  disabled,
  ltr,
  inputType = 'text',
  maxLength,
}: {
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  values: readonly string[];
  onAdd: (raw: string) => string | null;
  onRemove: (value: string) => void;
  addLabel: string;
  removeLabel: (value: string) => string;
  emptyLabel: string;
  countLabel?: string;
  disabled: boolean;
  ltr?: boolean;
  inputType?: string;
  maxLength?: number;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const msgId = `${id}-msg`;
  const add = () => {
    const problem = onAdd(text);
    setError(problem);
    if (!problem) setText('');
  };
  return (
    <div className="min-w-0 space-y-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        {countLabel && <span className={HINT}>{countLabel}</span>}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type={inputType}
          dir={ltr ? 'ltr' : undefined}
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          invalid={Boolean(error)}
          aria-describedby={error || hint ? msgId : undefined}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Enter adds the entry; it must not submit a surrounding form.
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={add} disabled={disabled}>
          {addLabel}
        </Button>
      </div>
      {error ? (
        <p id={msgId} role="alert" className={CONTROL_ERROR}>
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className={HINT}>
          {hint}
        </p>
      ) : null}
      {values.length === 0 ? (
        <p className={HINT}>{emptyLabel}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li
              key={v}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted py-1 ps-2 pe-1"
            >
              <span dir={ltr ? 'ltr' : undefined} className="min-w-0 break-all text-xs">
                {v}
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={removeLabel(v)}
                onClick={() => onRemove(v)}
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <svg
                  viewBox="0 0 12 12"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A whole number kept as text while it is typed, handed up only when it is inside the range, so a half-typed "3" never becomes a
 * saved retention of 3 days. `value` null means the setting is off (the box is empty and read only).
 */
function NumberSetting({
  label,
  hint,
  rangeError,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  rangeError: string;
  value: number | null;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // A value that changed from outside (a reload, the keep-forever box) replaces what is typed; our own commits already match.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value === null) setText('');
    else if (parseBoundedInt(text, min, max) !== value) setText(String(value));
  }
  const invalid = value !== null && parseBoundedInt(text, min, max) === null;
  return (
    <FieldBox label={label} hint={hint} error={invalid ? rangeError : undefined}>
      {(a) => (
        <Input
          {...a}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          className="max-w-40"
          value={text}
          disabled={disabled || value === null}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseBoundedInt(e.target.value, min, max);
            if (n !== null) onCommit(n);
          }}
        />
      )}
    </FieldBox>
  );
}

// --- the tab -------------------------------------------------------------------------------------------------------------------

/** "What happens next": the form's own settings, the thank-you, consent, what lands in the CRM, who is told, and the protections. */
export function SettingsTab(props: BuilderTabProps) {
  const { form, draft, setDraft, live, patchLive, name, setName, canEdit } = props;
  const t = useTranslations('web-forms.settings');
  const users = useFormUsers();
  const protection = useFormProtection();
  const disabled = !canEdit;
  const published = form.publishedVersion !== null;
  const saved = form.draft;
  const keepId = useId();
  // What the number was before keep-forever was ticked, so unticking brings it back.
  const [lastRetention, setLastRetention] = useState<number | null>(live.retentionDays);

  const userOptions = (users.data ?? []).map((u) => ({
    value: u.id,
    label: `${u.name} (${u.email})`,
  }));
  const knownUser = (id: string) => userOptions.some((o) => o.value === id);

  const setSettings = (patch: Partial<Definition['settings']>) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setConsent = (patch: Partial<Definition['consent']>) =>
    setDraft((d) => ({ ...d, consent: { ...d.consent, ...patch } }));
  const setAfter = (patch: Partial<Definition['after']>) =>
    setDraft((d) => ({ ...d, after: { ...d.after, ...patch } }));

  const s = draft.settings;
  const consent = draft.consent;
  const locale = useLocale();
  const channels = consentChannels(consent);
  const channelNames = {
    whatsapp: t('consent.channelNames.whatsapp'),
    sms: t('consent.channelNames.sms'),
    email: t('consent.channelNames.email'),
  };
  const statementFor = (chs: readonly FormConsentChannel[]) =>
    consentStatement(t('consent.statement', { channels: '{channels}' }), chs, channelNames, locale);
  const suggested = statementFor(channels);
  const applyText = (text: string) =>
    setDraft((d) => ({
      ...d,
      consent: consentWithText(d.consent, text, saved.consent, published),
    }));
  /**
   * Ticking a channel writes it into the sentence. The sentence is rewritten only while it is still the generated one (or empty or the
   * default); wording the owner wrote by hand is kept, and the button offers the generated one.
   */
  const setChannels = (next: FormConsentChannel[]) => {
    const generated =
      consent.text.trim() === '' ||
      consent.text.trim() === statementFor(channels) ||
      consent.text.trim() === DEFAULT_CONSENT_TEXT;
    setDraft((d) => {
      const withChannels = { ...d.consent, channels: next };
      return {
        ...d,
        consent: generated
          ? consentWithText(withChannels, statementFor(next), saved.consent, published)
          : withChannels,
      };
    });
  };
  const after = draft.after;
  const ownerIssue = ownerRuleIssue(live.ownerRule);
  const storedEmailIssue = emailsIssue(live.notify.emails);

  const nameIssue = name.trim().length === 0 ? 'nameRequired' : null;
  const labelIssue = submitLabelIssue(s.submitLabel);
  const redirectProblem = redirectIssue(s.successMode, s.redirectUrl);
  const privacyProblem = consent.enabled ? privacyUrlIssue(consent.privacyUrl) : null;
  const termsProblem = consent.enabled ? privacyUrlIssue(consent.termsUrl) : null;
  // The workspace links (Compliance center) are offered, never filled in: a role without access to them simply gets no buttons.
  const workspaceLinks = useComplianceLinks(canEdit);
  const consentTextEmpty = consent.enabled && consent.text.trim().length === 0;
  const rangeText = { min: RETENTION_RANGE.min, max: RETENTION_RANGE.max };

  return (
    <div className="space-y-4">
      {!canEdit && <Alert tone="info">{t('readOnly')}</Alert>}
      {users.isError && <Alert tone="warning">{t('usersFailed')}</Alert>}

      <Section title={t('form.title')} description={t('form.description')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label={t('form.name')}
            hint={t('form.nameHint')}
            error={nameIssue ? t(`form.issues.${nameIssue}`) : undefined}
            className="sm:col-span-2"
          >
            {(a) => (
              <Input
                {...a}
                value={name}
                maxLength={NAME_MAX}
                disabled={disabled}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </FieldBox>
          <FieldBox label={t('form.language')} hint={t('form.languageHint')}>
            {(a) => (
              <Select
                {...a}
                value={s.locale}
                disabled={disabled}
                onChange={(e) => {
                  const locale = e.target.value === 'ar' ? 'ar' : 'en';
                  // The reading direction follows the language, so a person never ends up with Arabic laid out left to right.
                  setSettings({ locale, dir: locale === 'ar' ? 'rtl' : 'ltr' });
                }}
              >
                <option value="en">{t('form.languages.en')}</option>
                <option value="ar">{t('form.languages.ar')}</option>
              </Select>
            )}
          </FieldBox>
          <FieldBox
            label={t('form.submitLabel')}
            hint={t('form.submitLabelHint', { max: MAX_SUBMIT_LABEL })}
            error={
              labelIssue
                ? t(`form.issues.submit_${labelIssue}`, { max: MAX_SUBMIT_LABEL })
                : undefined
            }
          >
            {(a) => (
              <Input
                {...a}
                value={s.submitLabel}
                maxLength={MAX_SUBMIT_LABEL + 20}
                disabled={disabled}
                onChange={(e) => setSettings({ submitLabel: e.target.value })}
              />
            )}
          </FieldBox>
        </div>
      </Section>

      <Section title={t('after.title')} description={t('after.description')}>
        <FieldBox label={t('after.mode')} hint={t(`after.modeHints.${s.successMode}`)}>
          {(a) => (
            <Select
              {...a}
              value={s.successMode}
              disabled={disabled}
              onChange={(e) =>
                setSettings({ successMode: e.target.value === 'redirect' ? 'redirect' : 'message' })
              }
            >
              <option value="message">{t('after.modes.message')}</option>
              <option value="redirect">{t('after.modes.redirect')}</option>
            </Select>
          )}
        </FieldBox>
        {s.successMode === 'message' ? (
          <FieldBox
            label={t('after.message')}
            hint={t('after.messageHint', { max: MAX_SUCCESS_MESSAGE })}
            error={
              s.successMessage.length > MAX_SUCCESS_MESSAGE
                ? t('after.messageTooLong', { max: MAX_SUCCESS_MESSAGE })
                : undefined
            }
          >
            {(a) => (
              <Textarea
                {...a}
                rows={4}
                value={s.successMessage}
                disabled={disabled}
                onChange={(e) => setSettings({ successMessage: e.target.value })}
              />
            )}
          </FieldBox>
        ) : (
          <FieldBox
            label={t('after.redirect')}
            hint={t('after.redirectHint')}
            error={redirectProblem ? t(`after.redirectIssues.${redirectProblem}`) : undefined}
          >
            {(a) => (
              <Input
                {...a}
                type="url"
                dir="ltr"
                placeholder="https://example.com/thank-you"
                value={s.redirectUrl ?? ''}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value;
                  setSettings({ redirectUrl: v.trim() === '' ? undefined : v });
                }}
              />
            )}
          </FieldBox>
        )}
        {s.successMode === 'redirect' && safeRedirect(s.redirectUrl) && (
          <p className={HINT}>{t('after.redirectKeepsMessage')}</p>
        )}
      </Section>

      <PaymentPanel draft={draft} setDraft={setDraft} disabled={disabled} />

      <Section title={t('consent.title')} description={t('consent.description')}>
        <SwitchRow
          label={t('consent.enabled')}
          hint={t('consent.enabledHint')}
          checked={consent.enabled}
          disabled={disabled}
          onChange={(enabled) => setConsent({ enabled })}
        />
        {consent.enabled && (
          <div className="space-y-4">
            <FieldBox
              label={t('consent.text')}
              hint={t('consent.textHint', { max: MAX_CONSENT_TEXT })}
              error={
                consentTextEmpty
                  ? t('consent.textRequired')
                  : consent.text.length > MAX_CONSENT_TEXT
                    ? t('consent.textTooLong', { max: MAX_CONSENT_TEXT })
                    : undefined
              }
            >
              {(a) => (
                <Textarea
                  {...a}
                  rows={3}
                  value={consent.text}
                  disabled={disabled}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      consent: consentWithText(d.consent, e.target.value, saved.consent, published),
                    }))
                  }
                />
              )}
            </FieldBox>
            <p className={`${HINT} flex flex-wrap items-center gap-2`}>
              <Badge tone={consent.version !== saved.consent.version ? 'warning' : 'neutral'}>
                {t('consent.version', { version: consent.version })}
              </Badge>
              <span>
                {published ? t('consent.versionHintPublished') : t('consent.versionHintDraft')}
              </span>
            </p>
            <FieldBox
              label={t('consent.privacyUrl')}
              hint={t('consent.privacyUrlHint')}
              error={privacyProblem ? t('consent.privacyUrlHttps') : undefined}
            >
              {(a) => (
                <Input
                  {...a}
                  type="url"
                  dir="ltr"
                  placeholder="https://example.com/privacy"
                  value={consent.privacyUrl ?? ''}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConsent({ privacyUrl: v.trim() === '' ? undefined : v });
                  }}
                />
              )}
            </FieldBox>
            {workspaceLinks.data?.privacyUrl &&
              consent.privacyUrl !== workspaceLinks.data.privacyUrl && (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      setConsent({ privacyUrl: workspaceLinks.data?.privacyUrl ?? undefined })
                    }
                  >
                    {t('consent.useWorkspacePrivacy')}
                  </Button>
                </div>
              )}
            <FieldBox
              label={t('consent.termsUrl')}
              hint={t('consent.termsUrlHint')}
              error={termsProblem ? t('consent.privacyUrlHttps') : undefined}
            >
              {(a) => (
                <Input
                  {...a}
                  type="url"
                  dir="ltr"
                  placeholder="https://example.com/terms"
                  value={consent.termsUrl ?? ''}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConsent({ termsUrl: v.trim() === '' ? undefined : v });
                  }}
                />
              )}
            </FieldBox>
            {workspaceLinks.data?.termsUrl && consent.termsUrl !== workspaceLinks.data.termsUrl && (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() =>
                    setConsent({ termsUrl: workspaceLinks.data?.termsUrl ?? undefined })
                  }
                >
                  {t('consent.useWorkspaceTerms')}
                </Button>
              </div>
            )}
            <SwitchRow
              label={t('consent.required')}
              hint={t('consent.requiredHint')}
              checked={consent.required}
              disabled={disabled}
              onChange={(required) => setConsent({ required })}
            />
            <SwitchRow
              label={t('consent.marketing')}
              hint={t('consent.marketingHint')}
              checked={consent.marketing}
              disabled={disabled}
              onChange={(marketing) => setConsent({ marketing })}
            />
            {!consent.marketing && <p className={HINT}>{t('consent.serviceHint')}</p>}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('consent.channelsLabel')}</legend>
              <p className={HINT}>{t('consent.channelsHint')}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {FORM_CONSENT_CHANNELS.map((ch) => (
                  <Checkbox
                    key={ch}
                    label={channelNames[ch]}
                    checked={channels.includes(ch)}
                    disabled={disabled || (channels.length === 1 && channels[0] === ch)}
                    onChange={(e) =>
                      setChannels(toggleConsentChannel(channels, ch, e.target.checked))
                    }
                  />
                ))}
              </div>
              {consent.text.trim() !== suggested && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => applyText(suggested)}
                >
                  {t('consent.channelsUse')}
                </Button>
              )}
            </fieldset>
          </div>
        )}
      </Section>

      <Section title={t('crm.title')} description={t('crm.description')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBox
            label={t('crm.company')}
            hint={t(`crm.companyHints.${draft.mapping.company.match}`)}
          >
            {(a) => (
              <Select
                {...a}
                value={draft.mapping.company.match}
                disabled={disabled}
                onChange={(e) => {
                  const match = COMPANY_MATCHES.find((m) => m === e.target.value) ?? 'none';
                  setDraft((d) => ({ ...d, mapping: { ...d.mapping, company: { match } } }));
                }}
              >
                {COMPANY_MATCHES.map((m) => (
                  <option key={m} value={m}>
                    {t(`crm.companyOptions.${m}`)}
                  </option>
                ))}
              </Select>
            )}
          </FieldBox>
          <FieldBox label={t('crm.lifecycle')} hint={t('crm.lifecycleHint')}>
            {(a) => (
              <Select
                {...a}
                value={after.lifecycleStage ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  setAfter({ lifecycleStage: e.target.value === '' ? undefined : e.target.value })
                }
              >
                <option value="">{t('crm.lifecycleNone')}</option>
                {lifecycleStageSchema.options.map((st) => (
                  <option key={st} value={st}>
                    {t(`crm.stages.${st}`)}
                  </option>
                ))}
                {after.lifecycleStage &&
                  !lifecycleStageSchema.safeParse(after.lifecycleStage).success && (
                    <option value={after.lifecycleStage}>{after.lifecycleStage}</option>
                  )}
              </Select>
            )}
          </FieldBox>
        </div>

        <ChipEditor
          label={t('crm.tags')}
          hint={t('crm.tagsHint', { max: MAX_TAGS })}
          placeholder={t('crm.tagsPlaceholder')}
          values={after.tags}
          countLabel={t('crm.tagsCount', { count: after.tags.length, max: MAX_TAGS })}
          addLabel={t('crm.tagAdd')}
          removeLabel={(v) => t('crm.tagRemove', { value: v })}
          emptyLabel={t('crm.tagsNone')}
          disabled={disabled}
          maxLength={80}
          onAdd={(raw) => {
            const r = checkTag(raw, after.tags);
            if (!r.ok) return t(`crm.tagIssues.${r.issue}`, { max: MAX_TAGS });
            setAfter({ tags: [...after.tags, r.value] });
            return null;
          }}
          onRemove={(v) => setAfter({ tags: after.tags.filter((x) => x !== v) })}
        />

        <fieldset className="min-w-0 space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('crm.owner')}</legend>
          <p className={HINT}>{t('crm.ownerHint')}</p>
          <FieldBox
            label={t('crm.ownerMode')}
            hint={t(`crm.ownerModeHints.${live.ownerRule.mode}`)}
          >
            {(a) => (
              <Select
                {...a}
                value={live.ownerRule.mode}
                disabled={disabled}
                onChange={(e) => {
                  const mode = OWNER_MODES.find((m) => m === e.target.value) ?? 'unassigned';
                  patchLive({ ownerRule: ownerRuleForMode(mode, live.ownerRule.userIds) });
                }}
              >
                {OWNER_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`crm.ownerModes.${m}`)}
                  </option>
                ))}
              </Select>
            )}
          </FieldBox>
          {live.ownerRule.mode === 'unassigned' && ownerIssue && (
            <p role="alert" className={CONTROL_ERROR}>
              {t(`crm.ownerIssues.${ownerIssue}`)}
            </p>
          )}
          {live.ownerRule.mode === 'fixed' && (
            <FieldBox
              label={t('crm.ownerFixed')}
              error={ownerIssue ? t(`crm.ownerIssues.${ownerIssue}`) : undefined}
            >
              {(a) => (
                <Select
                  {...a}
                  value={live.ownerRule.userIds[0] ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    patchLive({
                      ownerRule: {
                        mode: 'fixed',
                        userIds: e.target.value ? [e.target.value] : [],
                      },
                    })
                  }
                >
                  <option value="">{t('crm.chooseUser')}</option>
                  {userOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {live.ownerRule.userIds[0] &&
                    !knownUser(live.ownerRule.userIds[0]) &&
                    !users.isPending && (
                      <option value={live.ownerRule.userIds[0]}>{t('crm.unknownUser')}</option>
                    )}
                </Select>
              )}
            </FieldBox>
          )}
          {live.ownerRule.mode === 'round_robin' && (
            <FieldBox
              label={t('crm.ownerRoundRobin')}
              hint={t('crm.ownerRoundRobinHint')}
              error={ownerIssue ? t(`crm.ownerIssues.${ownerIssue}`) : undefined}
            >
              {(a) => (
                <MultiSelect
                  id={a.id}
                  label={t('crm.ownerRoundRobin')}
                  options={userOptions}
                  value={live.ownerRule.userIds}
                  disabled={disabled}
                  placeholder={t('crm.pickUsers')}
                  emptyLabel={t('crm.noUsers')}
                  removeLabel={(n) => t('crm.removeUser', { name: n })}
                  onChange={(ids) =>
                    patchLive({
                      ownerRule: { mode: 'round_robin', userIds: ids.slice(0, MAX_OWNER_USERS) },
                    })
                  }
                />
              )}
            </FieldBox>
          )}
        </fieldset>
      </Section>

      <Section title={t('notify.title')} description={t('notify.description')}>
        <SwitchRow
          label={t('notify.owner')}
          hint={t('notify.ownerHint')}
          checked={live.notify.owner}
          disabled={disabled}
          onChange={(owner) => patchLive({ notify: { ...live.notify, owner } })}
        />
        <FieldBox label={t('notify.users')} hint={t('notify.usersHint', { max: MAX_NOTIFY_USERS })}>
          {(a) => (
            <MultiSelect
              id={a.id}
              label={t('notify.users')}
              options={userOptions}
              value={live.notify.userIds}
              disabled={disabled}
              placeholder={t('crm.pickUsers')}
              emptyLabel={t('crm.noUsers')}
              removeLabel={(n) => t('crm.removeUser', { name: n })}
              onChange={(ids) =>
                patchLive({ notify: { ...live.notify, userIds: ids.slice(0, MAX_NOTIFY_USERS) } })
              }
            />
          )}
        </FieldBox>
        <ChipEditor
          label={t('notify.emails')}
          hint={storedEmailIssue ? undefined : t('notify.emailsHint', { max: MAX_NOTIFY_EMAILS })}
          placeholder={t('notify.emailPlaceholder')}
          values={live.notify.emails}
          countLabel={t('notify.emailsCount', {
            count: live.notify.emails.length,
            max: MAX_NOTIFY_EMAILS,
          })}
          addLabel={t('notify.emailAdd')}
          removeLabel={(v) => t('notify.emailRemove', { value: v })}
          emptyLabel={t('notify.emailsNone')}
          disabled={disabled}
          inputType="email"
          ltr
          maxLength={254}
          onAdd={(raw) => {
            const r = checkEmail(raw, live.notify.emails);
            if (!r.ok) return t(`notify.emailIssues.${r.issue}`, { max: MAX_NOTIFY_EMAILS });
            patchLive({ notify: { ...live.notify, emails: [...live.notify.emails, r.value] } });
            return null;
          }}
          onRemove={(v) =>
            patchLive({
              notify: { ...live.notify, emails: live.notify.emails.filter((x) => x !== v) },
            })
          }
        />
        {storedEmailIssue && (
          <p role="alert" className={CONTROL_ERROR}>
            {t(`notify.emailIssues.${storedEmailIssue}`, { max: MAX_NOTIFY_EMAILS })}
          </p>
        )}
      </Section>

      <Section title={t('protection.title')} description={t('protection.description')}>
        <SwitchRow
          label={t('protection.honeypot')}
          hint={t('protection.honeypotHint')}
          checked={live.honeypot}
          disabled={disabled}
          onChange={(honeypot) => patchLive({ honeypot })}
        />
        <FieldBox
          label={t('protection.captcha')}
          hint={t(`protection.captchaHints.${live.captchaMode}`)}
        >
          {(a) => (
            <Select
              {...a}
              value={live.captchaMode}
              disabled={disabled}
              onChange={(e) => {
                const mode: FormCaptchaMode =
                  FORM_CAPTCHA_MODES.find((m) => m === e.target.value) ?? 'inherit';
                patchLive({ captchaMode: mode });
              }}
            >
              {FORM_CAPTCHA_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`protection.captchaOptions.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </FieldBox>
        {protection.isError && <Alert tone="warning">{t('protection.captchaStatus.failed')}</Alert>}
        {protection.data &&
          (protection.data.captcha.available ? (
            <p className={HINT} data-testid="captcha-status">
              {t('protection.captchaStatus.available', {
                version: protection.data.captcha.version ?? '',
              })}
            </p>
          ) : (
            <Alert
              tone={live.captchaMode === 'on' ? 'warning' : 'info'}
              data-testid="captcha-status"
            >
              {live.captchaMode === 'on'
                ? t('protection.captchaStatus.noneOn')
                : t('protection.captchaStatus.none')}
            </Alert>
          ))}
        {protection.data && (
          <div className="space-y-1" data-testid="spam-caught">
            <p className={HINT}>
              {t('protection.caught.blocked', { count: protection.data.blockedThisMonth })}
            </p>
            {protection.data.heldAsSpam > 0 && (
              <p className={HINT}>
                {t('protection.caught.held', { count: protection.data.heldAsSpam })}{' '}
                <Link
                  href={`/forms/${form.id}/submissions?tab=spam`}
                  className="underline focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t('protection.caught.review')}
                </Link>
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <NumberSetting
            label={t('protection.retention')}
            hint={t('protection.retentionHint')}
            rangeError={t('protection.range', rangeText)}
            value={live.retentionDays}
            min={RETENTION_RANGE.min}
            max={RETENTION_RANGE.max}
            disabled={disabled}
            onCommit={(n) => patchLive({ retentionDays: n })}
          />
          <Checkbox
            id={keepId}
            label={t('protection.keepForever')}
            checked={live.retentionDays === null}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.checked) setLastRetention(live.retentionDays);
              patchLive({ retentionDays: retentionAfterToggle(e.target.checked, lastRetention) });
            }}
          />
          <p className={HINT}>{t('protection.keepForeverHint')}</p>
        </div>

        <details className="rounded-md border border-border">
          <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary">
            {t('protection.advanced')}
          </summary>
          <div className="space-y-4 border-t border-border p-3">
            <p className={HINT}>{t('protection.advancedHint')}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {(['perIpPerMinute', 'perFormPerMinute', 'perContactPerHour'] as const).map((key) => (
                <NumberSetting
                  key={key}
                  label={t(`protection.rate.${key}`)}
                  hint={t(`protection.rate.${key}Hint`)}
                  rangeError={t('protection.range', RATE_LIMIT_RANGES[key])}
                  value={live.rateLimits[key]}
                  min={RATE_LIMIT_RANGES[key].min}
                  max={RATE_LIMIT_RANGES[key].max}
                  disabled={disabled}
                  onCommit={(n) => patchLive({ rateLimits: { ...live.rateLimits, [key]: n } })}
                />
              ))}
            </div>
          </div>
        </details>
      </Section>
    </div>
  );
}
