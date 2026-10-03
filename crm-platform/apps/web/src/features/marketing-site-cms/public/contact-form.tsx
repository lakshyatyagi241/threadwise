'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CMS_CONTACT_TOPICS, cmsContactSubmitResponseSchema } from '@crm/contracts';
import {
  useCaptcha,
  type CaptchaConfig,
} from '@/features/auth-registration-security/guest/captcha';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

const TOPIC_KEY = {
  sales: 'topicSales',
  support: 'topicSupport',
  partnership: 'topicPartnership',
  other: 'topicOther',
} as const;

/** The editable texts of the form (registry keys of the contact page's `form` section). */
export interface ContactLabels {
  name_label: string;
  email_label: string;
  company_label: string;
  topic_label: string;
  message_label: string;
  sla: string;
  submit_label: string;
  success_title: string;
  success_text: string;
  error_text: string;
}

/**
 * The public contact form (TW-CMS-005/006). The hidden `website` field is the honeypot: people never fill it. When the
 * platform has reCAPTCHA on, the widget (v2) or the invisible token (v3, action `contact`) rides along as `captchaToken`.
 * In the editor preview the form is shown but never sends.
 */
export function ContactForm({
  labels,
  captcha: captchaConfig,
  preview = false,
}: {
  labels: ContactLabels;
  captcha: CaptchaConfig | null;
  preview?: boolean;
}) {
  const t = useTranslations('marketing-site-cms.site');
  const captcha = useCaptcha(captchaConfig, 'contact');
  const [captchaMissing, setCaptchaMissing] = useState(false);
  const [f, setF] = useState({
    name: '',
    email: '',
    company: '',
    topic: 'sales' as string,
    message: '',
    website: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const send = useMutation({
    mutationFn: async () => {
      const captchaToken = await captcha.token();
      return apiFetch('/public/cms/contact', {
        method: 'POST',
        body: {
          name: f.name,
          email: f.email,
          company: f.company || null,
          topic: f.topic,
          message: f.message,
          website: f.website,
          ...(captchaToken ? { captchaToken } : {}),
        },
        schema: cmsContactSubmitResponseSchema,
      });
    },
    onError: () => captcha.reset(),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (preview) return;
    if (captcha.needsInteraction) {
      setCaptchaMissing(true);
      return;
    }
    setCaptchaMissing(false);
    send.mutate();
  };
  if (send.isSuccess) {
    return (
      <div
        id="contact-sent"
        className="cms-alert"
        data-tone="ok"
        role="status"
        style={{ marginTop: '1.5rem' }}
      >
        <strong>{labels.success_title}</strong>
        <p style={{ margin: '0.25rem 0 0' }}>{labels.success_text}</p>
      </div>
    );
  }
  const err = send.error;
  return (
    <form onSubmit={submit} className="cms-form">
      {(err || captchaMissing) && (
        <div className="cms-alert" data-tone="bad" role="alert">
          {captchaMissing
            ? t('captchaMissing')
            : err instanceof ApiError && err.status === 429
              ? t('tooMany')
              : labels.error_text}
        </div>
      )}
      <label>
        {labels.name_label}
        <input
          value={f.name}
          onChange={(e) => set('name', e.target.value)}
          required
          maxLength={120}
          autoComplete="name"
        />
      </label>
      <label>
        {labels.email_label}
        <input
          type="email"
          value={f.email}
          onChange={(e) => set('email', e.target.value)}
          required
          maxLength={190}
          autoComplete="email"
          dir="ltr"
        />
      </label>
      <label>
        {labels.company_label}
        <input
          value={f.company}
          onChange={(e) => set('company', e.target.value)}
          maxLength={160}
          autoComplete="organization"
        />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.35rem' }}>
          {labels.topic_label}
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.25rem' }}>
          {CMS_CONTACT_TOPICS.map((k) => (
            <label
              key={k}
              style={{ display: 'inline-flex', gridAutoFlow: 'column', gap: '0.4rem' }}
            >
              <input
                type="radio"
                name="topic"
                value={k}
                checked={f.topic === k}
                onChange={() => set('topic', k)}
              />
              <span style={{ fontWeight: 400 }}>{t(TOPIC_KEY[k])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        {labels.message_label}
        <textarea
          rows={6}
          value={f.message}
          onChange={(e) => set('message', e.target.value)}
          required
          maxLength={5000}
        />
      </label>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          insetInlineStart: '-9999px',
          height: 0,
          width: 0,
          overflow: 'hidden',
        }}
      >
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={f.website}
            onChange={(e) => set('website', e.target.value)}
          />
        </label>
      </div>
      {captcha.widget}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
        <button type="submit" className="cms-btn" disabled={send.isPending}>
          {send.isPending ? t('sending') : labels.submit_label}
        </button>
        {labels.sla && <span className="cms-small">{labels.sla}</span>}
      </div>
    </form>
  );
}
