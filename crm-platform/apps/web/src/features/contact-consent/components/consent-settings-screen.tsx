'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { ConsentSettings, TestConsentMessageResult } from '@crm/contracts';
import { Alert, Button, Field, Input, Spinner, Switch, Textarea, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useConsentSettings } from '../api/hooks';
import { consentApi, consentExportUrl } from '../api/service';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import {
  formFromSettings,
  formProblems,
  isLangCode,
  mapsFromForm,
  settingsDirty,
  toSettingsInput,
  withFooter,
  type LangBlock,
  type SettingsForm,
} from '../lib/model';

const CARD = 'rounded-xl border border-border bg-background p-4';

/** `/contact-consent`: STOP and START words, the confirmation replies, the opt-out line, and the consent policy of the workspace. */
export function ConsentSettingsScreen() {
  const t = useTranslations('contact-consent');
  const canManage = useCan('settings.consent.manage');
  const qc = useQueryClient();
  const q = useConsentSettings(canManage);
  const [conflict, setConflict] = useState(false);

  if (!canManage) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.forbidden')}
      </Alert>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
        <span>{t(`errors.${errorKey(q.error)}`)}</span>
        <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </Alert>
    );
  }
  if (!q.data) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }
  return (
    <>
      {conflict && (
        <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>{t('settings.conflict')}</span>
          <Button size="sm" variant="secondary" onClick={() => setConflict(false)}>
            {t('settings.conflictOk')}
          </Button>
        </Alert>
      )}
      <Body
        key={q.data.rowVersion ?? 'first'}
        settings={q.data}
        onSaved={() => setConflict(false)}
        onConflict={() => {
          setConflict(true);
          void qc.invalidateQueries({ queryKey: KEYS.settings });
        }}
      />
    </>
  );
}

function Body({
  settings,
  onSaved,
  onConflict,
}: {
  settings: ConsentSettings;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('contact-consent');
  const { toast } = useToast();
  const qc = useQueryClient();
  const baseline = formFromSettings(settings);
  const [form, setForm] = useState<SettingsForm>(baseline);
  const [error, setError] = useState<unknown>(null);
  const [newLang, setNewLang] = useState('');
  const dirty = settingsDirty(form, baseline);
  const problems = formProblems(form);

  const saving = useRef(false);
  const save = useMutation({
    mutationFn: () => consentApi.saveSettings(toSettingsInput(form, settings.rowVersion)),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      qc.invalidateQueries({ queryKey: KEYS.composer }).catch(() => undefined);
      onSaved();
      toast(t('settings.saved'), 'success');
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
    if (saving.current || problems.length > 0) return;
    saving.current = true;
    setError(null);
    save.mutate();
  };

  const patch = (p: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...p }));
  const patchLang = (lang: string, p: Partial<LangBlock>) =>
    setForm((f) => ({ ...f, langs: f.langs.map((b) => (b.lang === lang ? { ...b, ...p } : b)) }));
  const addLang = () => {
    const code = newLang.trim();
    if (!isLangCode(code) || form.langs.some((b) => b.lang === code)) return;
    setForm((f) => ({
      ...f,
      langs: [
        ...f.langs,
        { lang: code, optOut: '', optIn: '', optOutReply: '', optInReply: '', footer: '' },
      ],
    }));
    setNewLang('');
  };

  return (
    <section className="space-y-4" aria-labelledby="consent-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 id="consent-title" className="text-xl font-bold tracking-tight">
            {t('settings.title')}
          </h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={consentExportUrl()}
            download
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            {t('settings.exportProof')}
          </a>
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => setForm(baseline)}
          >
            {t('settings.discard')}
          </Button>
          <Button
            variant="brand"
            disabled={!dirty || save.isPending || problems.length > 0}
            onClick={send}
          >
            {save.isPending && <Spinner />}
            {t('settings.save')}
          </Button>
        </div>
      </header>

      {error !== null && (
        <Alert tone="danger" role="alert">
          {t(`errors.${errorKey(error)}`)}
        </Alert>
      )}
      {problems.includes('noOptOutWord') && (
        <Alert tone="warning">{t('settings.problems.noOptOutWord')}</Alert>
      )}
      {problems.includes('badLang') && (
        <Alert tone="warning">{t('settings.problems.badLang')}</Alert>
      )}

      {/* Policy */}
      <div className={CARD}>
        <h2 className="text-base font-semibold">{t('policy.title')}</h2>
        <ToggleRow
          id="require-consent"
          label={t('policy.requireConsent')}
          hint={t('policy.requireConsentHint')}
          checked={form.requireConsentForMarketing}
          onChange={(v) => patch({ requireConsentForMarketing: v })}
        />
        <p className="mt-2 text-xs text-muted-foreground">{t('policy.withdrawnAlways')}</p>
      </div>

      {/* Detection */}
      <div className={CARD}>
        <h2 className="text-base font-semibold">{t('detect.title')}</h2>
        <ToggleRow
          id="detect"
          label={t('detect.enabled')}
          hint={t('detect.enabledHint')}
          checked={form.detectionEnabled}
          onChange={(v) => patch({ detectionEnabled: v })}
        />
        <ToggleRow
          id="auto-reply"
          label={t('detect.autoReply')}
          hint={t('detect.autoReplyHint')}
          checked={form.autoReplyEnabled}
          disabled={!form.detectionEnabled}
          onChange={(v) => patch({ autoReplyEnabled: v })}
        />
        <p className="mt-3 text-sm text-muted-foreground">{t('detect.rule')}</p>
      </div>

      {/* Per language */}
      {form.langs.map((b) => (
        <LangCard
          key={b.lang}
          block={b}
          disabled={!form.detectionEnabled}
          canRemove={form.langs.length > 1 && b.lang !== 'en'}
          onChange={(p) => patchLang(b.lang, p)}
          onRemove={() =>
            setForm((f) => ({ ...f, langs: f.langs.filter((x) => x.lang !== b.lang) }))
          }
        />
      ))}
      <div className={`${CARD} flex flex-wrap items-end gap-2`}>
        <Field
          label={t('lang.add')}
          htmlFor="new-lang"
          hint={t('lang.addHint')}
          error={
            newLang.trim() !== '' && !isLangCode(newLang.trim()) ? t('lang.invalid') : undefined
          }
        >
          <Input
            id="new-lang"
            value={newLang}
            dir="ltr"
            maxLength={12}
            placeholder="fr"
            onChange={(e) => setNewLang(e.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          onClick={addLang}
          disabled={
            !isLangCode(newLang.trim()) || form.langs.some((b) => b.lang === newLang.trim())
          }
        >
          {t('lang.addButton')}
        </Button>
      </div>

      {/* Opt-out line */}
      <div className={CARD}>
        <h2 className="text-base font-semibold">{t('footer.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('footer.intro')}</p>
        <ToggleRow
          id="footer-default"
          label={t('footer.defaultOn')}
          hint={t('footer.defaultOnHint')}
          checked={form.footerDefaultOn}
          onChange={(v) => patch({ footerDefaultOn: v })}
        />
        <FooterPreview form={form} />
      </div>

      <TestBox form={form} />
    </section>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mt-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch
        id={id}
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function LangCard({
  block,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  block: LangBlock;
  disabled: boolean;
  canRemove: boolean;
  onChange: (p: Partial<LangBlock>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('contact-consent.lang');
  const id = (k: string) => `${block.lang}-${k}`;
  return (
    <div className={CARD} role="group" aria-label={t('groupLabel', { lang: block.lang })}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {t('title')} <span dir="ltr">{block.lang}</span>
        </h2>
        {canRemove && (
          <Button size="sm" variant="secondary" onClick={onRemove}>
            {t('remove')}
          </Button>
        )}
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <Field label={t('optOutWords')} htmlFor={id('out')} hint={t('wordsHint')}>
          <Textarea
            id={id('out')}
            rows={5}
            value={block.optOut}
            disabled={disabled}
            onChange={(e) => onChange({ optOut: e.target.value })}
          />
        </Field>
        <Field label={t('optInWords')} htmlFor={id('in')} hint={t('wordsHint')}>
          <Textarea
            id={id('in')}
            rows={5}
            value={block.optIn}
            disabled={disabled}
            onChange={(e) => onChange({ optIn: e.target.value })}
          />
        </Field>
        <Field label={t('optOutReply')} htmlFor={id('outr')} hint={t('replyHint')}>
          <Textarea
            id={id('outr')}
            rows={3}
            maxLength={600}
            value={block.optOutReply}
            onChange={(e) => onChange({ optOutReply: e.target.value })}
          />
        </Field>
        <Field label={t('optInReply')} htmlFor={id('inr')} hint={t('replyHint')}>
          <Textarea
            id={id('inr')}
            rows={3}
            maxLength={600}
            value={block.optInReply}
            onChange={(e) => onChange({ optInReply: e.target.value })}
          />
        </Field>
        <Field
          label={t('footer')}
          htmlFor={id('foot')}
          hint={t('footerHint')}
          className="md:col-span-2"
        >
          <Input
            id={id('foot')}
            maxLength={160}
            value={block.footer}
            onChange={(e) => onChange({ footer: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

/** What the recipient sees: a sample marketing message with the opt-out line under it, per language. */
function FooterPreview({ form }: { form: SettingsForm }) {
  const t = useTranslations('contact-consent.footer');
  const withLine = form.langs.filter((b) => b.footer.trim() !== '');
  if (withLine.length === 0) return <p className="mt-3 text-sm text-warning">{t('noneSet')}</p>;
  return (
    <div className="mt-3 space-y-2" aria-label={t('previewLabel')}>
      <p className="text-xs font-medium text-muted-foreground">{t('previewLabel')}</p>
      {withLine.map((b) => (
        <div
          key={b.lang}
          className="max-w-sm whitespace-pre-line rounded-lg bg-muted p-3 text-sm"
          dir="auto"
        >
          <span className="mb-1 block text-[10px] uppercase text-muted-foreground" dir="ltr">
            {b.lang}
          </span>
          {withFooter(t('sample'), b.footer, true)}
        </div>
      ))}
    </div>
  );
}

/** "Test a message": the same rule the inbound listener runs, against the words typed above (saved or not). */
function TestBox({ form }: { form: SettingsForm }) {
  const t = useTranslations('contact-consent.test');
  const [text, setText] = useState('');
  const [result, setResult] = useState<TestConsentMessageResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = useMutation({
    mutationFn: () => {
      const maps = mapsFromForm(form);
      return consentApi.test({
        text,
        optOutKeywords: maps.optOutKeywords,
        optInKeywords: maps.optInKeywords,
      });
    },
    onSuccess: (r) => {
      setError(null);
      setResult(r);
    },
    onError: (e) => setError(e),
  });
  return (
    <div className={CARD}>
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== '') run.mutate();
        }}
      >
        <Field label={t('label')} htmlFor="consent-test" className="min-w-60 flex-1">
          <Input
            id="consent-test"
            value={text}
            maxLength={2000}
            dir="auto"
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={text.trim() === '' || run.isPending}>
          {run.isPending && <Spinner />}
          {t('run')}
        </Button>
      </form>
      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {error !== null && <Alert tone="danger">{t('failed')}</Alert>}
        {result && (
          <div className="space-y-2">
            <p className="font-medium">{t(`outcome.${result.outcome}`)}</p>
            {result.keyword && (
              <p className="text-muted-foreground">
                {t('matched', { keyword: result.keyword, lang: result.lang ?? '' })}
              </p>
            )}
            {result.reply ? (
              <div className="max-w-sm rounded-lg bg-muted p-3" dir="auto">
                <span className="mb-1 block text-xs text-muted-foreground">{t('replyLabel')}</span>
                {result.reply}
              </div>
            ) : (
              result.match !== 'none' && <p className="text-muted-foreground">{t('noReply')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
