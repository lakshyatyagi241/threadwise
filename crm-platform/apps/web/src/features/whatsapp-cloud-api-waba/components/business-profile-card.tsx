'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { WABA_VERTICALS, type WabaBusinessProfile } from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useProfile, useUpdateProfile } from '../api/hooks';
import { useErrorText } from './use-error-text';

/** The number's public WhatsApp business profile (about, description, address, email, websites, industry). */
export function BusinessProfileCard({ id }: { id: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.profile');
  const errorText = useErrorText();
  const q = useProfile(id);
  return (
    <Card className="p-4 md:col-span-2">
      <h3 className="mb-3 font-semibold">{t('title')}</h3>
      {q.isPending ? (
        <Spinner label={t('loading')} />
      ) : q.isError ? (
        <Alert tone="warning">{errorText(q.error).text}</Alert>
      ) : (
        <ProfileForm id={id} profile={q.data} />
      )}
    </Card>
  );
}

function ProfileForm({ id, profile }: { id: string; profile: WabaBusinessProfile }) {
  const t = useTranslations('whatsapp-cloud-api-waba.profile');
  const errorText = useErrorText();
  const update = useUpdateProfile(id);
  const [v, setV] = useState({
    about: profile.about ?? '',
    description: profile.description ?? '',
    address: profile.address ?? '',
    email: profile.email ?? '',
    website1: profile.websites[0] ?? '',
    website2: profile.websites[1] ?? '',
    vertical: profile.vertical ?? '',
  });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const websites = [v.website1, v.website2].map((w) => w.trim()).filter(Boolean);
    if (v.about.trim().length < 1) return setErrors({ about: t('aboutRequired') });
    if (websites.some((w) => !/^https?:\/\//i.test(w)))
      return setErrors({ websites: t('websiteScheme') });
    setErrors({});
    update.mutate(
      {
        about: v.about.trim(),
        description: v.description.trim(),
        address: v.address.trim(),
        email: v.email.trim(),
        websites,
        ...(v.vertical ? { vertical: v.vertical as (typeof WABA_VERTICALS)[number] } : {}),
      },
      {
        onSuccess: () => setMsg({ tone: 'success', text: t('saved') }),
        onError: (err) => {
          const et = errorText(err);
          const byField: Record<string, string> = {};
          for (const fe of et.fieldErrors) byField[fe.path] = fe.message;
          if (Object.keys(byField).length) setErrors(byField);
          setMsg({ tone: 'danger', text: et.text });
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {msg && (
        <div className="sm:col-span-2">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <div className="sm:col-span-2">
        <Field label={t('about')} htmlFor="wp-about" hint={t('aboutHint')} error={errors.about}>
          <Input
            id="wp-about"
            maxLength={139}
            value={v.about}
            onChange={set('about')}
            invalid={!!errors.about}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={t('description')} htmlFor="wp-desc" error={errors.description}>
          <Textarea
            id="wp-desc"
            maxLength={512}
            rows={3}
            value={v.description}
            onChange={set('description')}
          />
        </Field>
      </div>
      <Field label={t('address')} htmlFor="wp-addr" error={errors.address}>
        <Input id="wp-addr" maxLength={256} value={v.address} onChange={set('address')} />
      </Field>
      <Field label={t('email')} htmlFor="wp-email" error={errors.email}>
        <Input
          id="wp-email"
          type="email"
          maxLength={128}
          value={v.email}
          onChange={set('email')}
          dir="ltr"
        />
      </Field>
      <Field label={t('website1')} htmlFor="wp-w1" error={errors.websites}>
        <Input id="wp-w1" maxLength={256} value={v.website1} onChange={set('website1')} dir="ltr" />
      </Field>
      <Field label={t('website2')} htmlFor="wp-w2">
        <Input id="wp-w2" maxLength={256} value={v.website2} onChange={set('website2')} dir="ltr" />
      </Field>
      <Field label={t('vertical')} htmlFor="wp-vert">
        <Select id="wp-vert" value={v.vertical} onChange={set('vertical')}>
          <option value="">{t('verticalNone')}</option>
          {WABA_VERTICALS.map((x) => (
            <option key={x} value={x}>
              {x.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
