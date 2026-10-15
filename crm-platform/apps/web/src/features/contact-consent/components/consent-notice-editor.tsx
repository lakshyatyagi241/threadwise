'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { CONSENT_NOTICE_TEXT_MAX, type ConsentNoticeScope } from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useComplianceLinks } from '@/features/compliance-center/api/hooks';
import { KEYS, useConsentNotice } from '../api/hooks';
import { consentApi } from '../api/service';
import { errorKey } from '../lib/errors';

/**
 * The consent line of an intake point: the wording a person sees next to a tick box (the website chat widget, a booking page) or that a
 * store's own marketing checkbox stands for (Shopify, WooCommerce), its link, and an on/off switch. Every change that matters is a new
 * numbered version, so the proof of a grant names the exact wording the person agreed to. A grant is written only when the person ticks
 * the box; the line being on never grants anything by itself.
 *
 * Settings screens embed it with the scope and the id of what it belongs to (`widget` + widget id, `booking` + booking type id,
 * `commerce` + `shopify:<id>` or `woocommerce:<id>`; the workspace default notice, scope `workspace`, takes a language code). Hidden
 * from people who may not manage consent. It offers the workspace's privacy and terms links and default wording (Compliance center) with
 * one click each; nothing is filled in by itself.
 */
export function ConsentNoticeEditor({
  scope,
  refId,
  disabled,
  heading,
}: {
  scope: ConsentNoticeScope;
  refId: string;
  /** The parent form is read-only or the record is not saved yet. */
  disabled?: boolean;
  /** Replaces the default title (the workspace notice names its language). */
  heading?: string;
}) {
  const t = useTranslations('contact-consent.notice');
  const te = useTranslations('contact-consent.errors');
  const allowed = useCan('settings.consent.manage');
  const q = useConsentNotice(scope, refId, allowed && !disabled);
  // Quiet on failure: the editor works without the offer (a role without the Compliance center simply gets no buttons).
  const links = useComplianceLinks(allowed && !disabled);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [termsUrl, setTermsUrl] = useState('');
  const [whatsapp, setWhatsapp] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setText(q.data.text);
    setUrl(q.data.url ?? '');
    setTermsUrl(q.data.termsUrl ?? '');
    setWhatsapp(q.data.channels.includes('whatsapp'));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      consentApi.saveNotice(scope, refId, {
        enabled,
        text: text.trim(),
        url: url.trim() || null,
        termsUrl: termsUrl.trim() || null,
        channels: scope === 'commerce' && whatsapp ? ['whatsapp'] : [],
      }),
    onSuccess: (saved) => {
      setError(null);
      qc.setQueryData(KEYS.notice(scope, refId), saved);
      toast(t('saved', { version: saved.version }), 'success');
    },
    onError: (e) => setError(e),
  });

  if (!allowed) return null;
  if (disabled) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="notice-save-first">
        {t('saveFirst')}
      </p>
    );
  }
  if (q.isPending) return <Spinner />;
  if (q.isError) {
    return <Alert tone="danger">{te(errorKey(q.error))}</Alert>;
  }

  const dirty =
    enabled !== q.data.enabled ||
    text.trim() !== q.data.text ||
    (url.trim() || null) !== q.data.url ||
    (termsUrl.trim() || null) !== (q.data.termsUrl ?? null) ||
    (scope === 'commerce' && whatsapp !== q.data.channels.includes('whatsapp'));
  const missingText = enabled && text.trim() === '';
  const idp = `notice-${scope}`;

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-background p-4"
      aria-labelledby={`${idp}-title`}
      data-testid="consent-notice-editor"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`${idp}-title`} className="text-sm font-semibold">
            {heading ?? t(`title.${scope}`)}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`intro.${scope}`)}</p>
        </div>
        <Switch
          id={`${idp}-enabled`}
          checked={enabled}
          onCheckedChange={setEnabled}
          label={t('enabled')}
        />
      </div>

      <Field
        label={t('text')}
        htmlFor={`${idp}-text`}
        hint={t('textHint', { max: CONSENT_NOTICE_TEXT_MAX })}
        error={missingText ? t('textRequired') : undefined}
      >
        <Textarea
          id={`${idp}-text`}
          value={text}
          maxLength={CONSENT_NOTICE_TEXT_MAX}
          rows={3}
          dir="auto"
          invalid={missingText}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {scope !== 'workspace' && links.data?.noticeText && text.trim() !== links.data.noticeText && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setText(links.data?.noticeText ?? '')}
          data-testid="use-workspace-text"
        >
          {t('useWorkspaceText')}
        </Button>
      )}
      <Field label={t('url')} htmlFor={`${idp}-url`} hint={t('urlHint')}>
        <Input
          id={`${idp}-url`}
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
        {links.data?.privacyUrl && url.trim() !== links.data.privacyUrl && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setUrl(links.data?.privacyUrl ?? '')}
            data-testid="use-workspace-privacy"
          >
            {t('useWorkspacePrivacy')}
          </Button>
        )}
      </Field>
      <Field label={t('termsUrl')} htmlFor={`${idp}-terms`} hint={t('termsUrlHint')}>
        <Input
          id={`${idp}-terms`}
          type="url"
          inputMode="url"
          value={termsUrl}
          placeholder="https://"
          onChange={(e) => setTermsUrl(e.target.value)}
        />
        {links.data?.termsUrl && termsUrl.trim() !== links.data.termsUrl && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setTermsUrl(links.data?.termsUrl ?? '')}
            data-testid="use-workspace-terms"
          >
            {t('useWorkspaceTerms')}
          </Button>
        )}
      </Field>

      {scope === 'commerce' && (
        <Checkbox
          id={`${idp}-whatsapp`}
          checked={whatsapp}
          label={t('whatsappToo')}
          onChange={(e) => setWhatsapp(e.target.checked)}
        />
      )}

      {error !== null && <Alert tone="danger">{te(errorKey(error))}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {q.data.version > 0 ? t('version', { version: q.data.version }) : t('noVersion')}
        </p>
        <Button
          onClick={() => save.mutate()}
          disabled={!dirty || missingText || save.isPending}
          data-testid="notice-save"
        >
          {save.isPending && <Spinner />}
          {t('save')}
        </Button>
      </div>
    </section>
  );
}
