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
 * The public contact form (WD-CMS-005/006). The hidden `website` field is the honeypot: people never fill it. When the
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
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-wa-green/40 bg-wa-bubble px-5 py-4"
      >
        <svg
          viewBox="0 0 16 16"
          className="mt-0.5 h-5 w-5 shrink-0 text-wa-deep"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8.2 7 10l4-4.5" />
        </svg>
        <div>
          <div className="text-[14px] font-semibold text-wa-deep">{labels.success_title}</div>
          <p className="mt-0.5 text-[12.5px] text-ink-700">{labels.success_text}</p>
        </div>
      </div>
    );
  }
  const err = send.error;
  const label = 'mono mb-2 block text-[10px] uppercase tracking-widest text-ink-500';
  const field =
    'w-full rounded-xl border border-paper-200 bg-paper-50 px-4 py-3 text-[13px] focus:border-wa-deep focus:outline-none';
  return (
    <>
      {(err || captchaMissing) && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-accent-coral/30 bg-accent-coral/10 px-5 py-4 text-[12.5px] text-accent-coral"
        >
          {captchaMissing
            ? t('captchaMissing')
            : err instanceof ApiError && err.status === 429
              ? t('tooMany')
              : labels.error_text}
        </div>
      )}
      <form onSubmit={submit} className="hairline space-y-5 rounded-3xl bg-white p-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="cf-name">
              {labels.name_label}
            </label>
            <input
              id="cf-name"
              className={field}
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              required
              maxLength={120}
              autoComplete="name"
              placeholder={t('nameHint')}
            />
          </div>
          <div>
            <label className={label} htmlFor="cf-email">
              {labels.email_label}
            </label>
            <input
              id="cf-email"
              className={field}
              type="email"
              value={f.email}
              onChange={(e) => set('email', e.target.value)}
              required
              maxLength={190}
              autoComplete="email"
              dir="ltr"
              placeholder={t('emailHint')}
            />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="cf-company">
            {labels.company_label}
          </label>
          <input
            id="cf-company"
            className={field}
            value={f.company}
            onChange={(e) => set('company', e.target.value)}
            maxLength={160}
            autoComplete="organization"
            placeholder={t('companyHint')}
          />
        </div>
        <fieldset>
          <legend className={label}>{labels.topic_label}</legend>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {CMS_CONTACT_TOPICS.map((k) => (
              <label
                key={k}
                className="hairline flex cursor-pointer items-center gap-2 rounded-lg bg-paper-50 px-3 py-2 text-[12px] hover:border-wa-deep"
              >
                <input
                  type="radio"
                  name="topic"
                  value={k}
                  checked={f.topic === k}
                  onChange={() => set('topic', k)}
                  className="accent-wa-deep"
                />
                {t(TOPIC_KEY[k])}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className={label} htmlFor="cf-message">
            {labels.message_label}
          </label>
          <textarea
            id="cf-message"
            className={`${field} resize-none`}
            rows={5}
            value={f.message}
            onChange={(e) => set('message', e.target.value)}
            required
            maxLength={5000}
            placeholder={t('messageHint')}
          />
        </div>
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
        {captcha.widget && <div className="pt-1">{captcha.widget}</div>}
        <div className="hairline-t flex flex-wrap items-center justify-between gap-3 pt-5">
          <div className="flex items-center gap-2 text-[11.5px] text-ink-600">
            <span className="pulse-dot h-2 w-2 rounded-full bg-wa-green" />
            {labels.sla}
          </div>
          <button
            type="submit"
            disabled={send.isPending}
            className="flex items-center gap-2 rounded-full bg-wa-deep px-6 py-3 text-[13px] font-semibold text-paper-0 hover:bg-wa-teal disabled:opacity-60"
          >
            {send.isPending ? t('sending') : labels.submit_label}
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M5 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </form>
    </>
  );
}
