'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CMS_CONTACT_TOPICS, cmsContactSubmitResponseSchema } from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Textarea } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

const TOPIC_KEY = {
  sales: 'topicSales',
  support: 'topicSupport',
  partnership: 'topicPartnership',
  other: 'topicOther',
} as const;

/** The public contact form (TW-CMS-005/006). The hidden `website` field is the honeypot: people never fill it. */
export function ContactForm() {
  const t = useTranslations('marketing-site-cms.site');
  const [f, setF] = useState({
    name: '',
    email: '',
    company: '',
    topic: 'sales',
    message: '',
    website: '',
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const send = useMutation({
    mutationFn: () =>
      apiFetch('/public/cms/contact', {
        method: 'POST',
        body: {
          name: f.name,
          email: f.email,
          company: f.company || null,
          topic: f.topic,
          message: f.message,
          website: f.website,
        },
        schema: cmsContactSubmitResponseSchema,
      }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };
  if (send.isSuccess) return <Alert tone="success">{t('thanks')}</Alert>;
  const err = send.error;
  return (
    <form onSubmit={submit} className="space-y-4">
      {err && (
        <Alert tone="danger">
          {err instanceof ApiError && err.status === 429 ? t('tooMany') : t('failed')}
        </Alert>
      )}
      <Field label={t('name')} htmlFor="c-name">
        <Input
          id="c-name"
          value={f.name}
          onChange={(e) => set('name', e.target.value)}
          required
          maxLength={120}
          autoComplete="name"
        />
      </Field>
      <Field label={t('email')} htmlFor="c-email">
        <Input
          id="c-email"
          type="email"
          value={f.email}
          onChange={(e) => set('email', e.target.value)}
          required
          maxLength={190}
          autoComplete="email"
          dir="ltr"
        />
      </Field>
      <Field label={t('company')} htmlFor="c-company">
        <Input
          id="c-company"
          value={f.company}
          onChange={(e) => set('company', e.target.value)}
          maxLength={160}
          autoComplete="organization"
        />
      </Field>
      <Field label={t('topic')} htmlFor="c-topic">
        <Select id="c-topic" value={f.topic} onChange={(e) => set('topic', e.target.value)}>
          {CMS_CONTACT_TOPICS.map((k) => (
            <option key={k} value={k}>
              {t(TOPIC_KEY[k])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('message')} htmlFor="c-message">
        <Textarea
          id="c-message"
          rows={6}
          value={f.message}
          onChange={(e) => set('message', e.target.value)}
          required
          maxLength={5000}
        />
      </Field>
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
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
      <Button type="submit" disabled={send.isPending}>
        {send.isPending ? t('sending') : t('send')}
      </Button>
    </form>
  );
}
