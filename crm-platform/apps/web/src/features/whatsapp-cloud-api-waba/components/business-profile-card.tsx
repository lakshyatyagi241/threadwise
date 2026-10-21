'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { WABA_VERTICALS, type WabaBusinessProfile } from '@crm/contracts';
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useProfile, useUpdateProfile, useUploadLogo } from '../api/hooks';
import { isLogoFile } from '../api/logo';
import { useErrorText } from './use-error-text';

/** The number's public WhatsApp business profile: logo, about, description, contact information and industry. */
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
  const upload = useUploadLogo(id);
  const [v, setV] = useState({
    about: profile.about ?? '',
    description: profile.description ?? '',
    address: profile.address ?? '',
    email: profile.email ?? '',
    website1: profile.websites[0] ?? '',
    website2: profile.websites[1] ?? '',
    vertical: profile.vertical ?? '',
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  // The picked picture's preview is an object URL: released when the picture changes or the form goes away.
  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  const pick = (file: File | undefined) => {
    setMsg(null);
    if (!file) return;
    if (!isLogoFile(file)) {
      // A refused pick also drops the picture picked before it, so a save never sends a picture the form has refused.
      clearLogo();
      setErrors({ logo: t('logoInvalid') });
      return;
    }
    setErrors({});
    setLogo(file);
    setLogoPreview(URL.createObjectURL(file));
  };
  const clearLogo = () => {
    setLogo(null);
    setLogoPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const websites = [v.website1, v.website2].map((w) => w.trim()).filter(Boolean);
    if (v.about.trim().length < 1) return setErrors({ about: t('aboutRequired') });
    if (websites.some((w) => !/^https?:\/\//i.test(w)))
      return setErrors({ websites: t('websiteScheme') });
    setErrors({});
    setMsg(null);
    try {
      // The picture goes first: Meta sets it by a handle the upload returns, then the text is saved with it. The picture leaves the
      // form only when both are saved; after a failed text save a retry sends the picture again, which Meta takes as before.
      if (logo) await upload.mutateAsync(logo);
      await update.mutateAsync({
        about: v.about.trim(),
        description: v.description.trim(),
        address: v.address.trim(),
        email: v.email.trim(),
        websites,
        ...(v.vertical ? { vertical: v.vertical as (typeof WABA_VERTICALS)[number] } : {}),
      });
      clearLogo();
      setMsg({ tone: 'success', text: t('saved') });
    } catch (err) {
      const et = errorText(err);
      const byField: Record<string, string> = {};
      for (const fe of et.fieldErrors) {
        // The API names a refused picture as `file`; the form shows it under the logo field, in the form's own words.
        if (fe.path === 'file') byField.logo = t('logoInvalid');
        else byField[fe.path] = fe.message;
      }
      if (Object.keys(byField).length) setErrors(byField);
      setMsg({ tone: 'danger', text: et.text });
    }
  };

  const shownLogo = logoPreview ?? profile.profilePictureUrl;
  const busy = update.isPending || upload.isPending;

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {msg && (
        <div className="sm:col-span-2">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <fieldset className="sm:col-span-2 space-y-2">
        <legend className="font-medium">{t('logoTitle')}</legend>
        <p className="text-xs text-muted-foreground">{t('logoHint')}</p>
        <div className="flex flex-wrap items-center gap-3">
          {shownLogo ? (
            <img
              src={shownLogo}
              alt=""
              className="size-14 rounded-full border border-border object-cover"
            />
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t('logoUpload')}
          </Button>
          <input
            ref={fileInput}
            id="wp-logo"
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            aria-label={t('logoUpload')}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {logo && (
            <Button variant="ghost" size="sm" aria-label={t('logoRemove')} onClick={clearLogo}>
              ×
            </Button>
          )}
        </div>
        {errors.logo ? (
          <p role="alert" className="text-xs text-danger">
            {errors.logo}
          </p>
        ) : logo ? (
          <p className="text-xs text-muted-foreground">{t('logoPending')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('logoTypeHint')}</p>
        )}
      </fieldset>
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
      <details
        className="sm:col-span-2 rounded-md border border-border p-3"
        open={!!profile.description || undefined}
      >
        <summary className="cursor-pointer font-medium">
          {t('description')}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {t('descriptionHint')}
          </span>
        </summary>
        <div className="mt-3">
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
      </details>
      <details
        className="sm:col-span-2 rounded-md border border-border p-3"
        open={
          !!(profile.address || profile.email || profile.websites.length || profile.vertical) ||
          undefined
        }
      >
        <summary className="cursor-pointer font-medium">
          {t('contactTitle')}
          <span className="ms-2 text-xs font-normal text-muted-foreground">{t('contactHint')}</span>
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
            <Input
              id="wp-w1"
              maxLength={256}
              value={v.website1}
              onChange={set('website1')}
              dir="ltr"
            />
          </Field>
          <Field label={t('website2')} htmlFor="wp-w2">
            <Input
              id="wp-w2"
              maxLength={256}
              value={v.website2}
              onChange={set('website2')}
              dir="ltr"
            />
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
        </div>
      </details>
      <div className="flex items-end sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
