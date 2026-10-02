'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button, Field, Input, Textarea } from '@crm/ui';
import { LIMITS, profileOf } from '../lib/profile-form';
import { Section, type EditorCtx } from './business-profile-ui';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Branding: the logo (a URL), the brand colour, the title wording and the footer note printed on every invoice. */
export function BrandingSection({ form, set, err, readOnly }: EditorCtx) {
  const t = useTranslations('invoicing.settings.branding');
  const uid = useId();
  const logo = form.logoUrl.trim();
  const logoOk = !err('logoUrl') && logo.startsWith('https://');
  const colour = form.brandColor.trim();
  const colourOk = HEX.test(colour);
  const suggestedTitle = profileOf(form.sellerCountry)?.documentTitles['tax_invoice'];

  return (
    <Section id="branding" title={t('title')} description={t('description')}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-4">
          <Field label={t('logo')} htmlFor={`${uid}-logo`} hint={t('logoHint')} error={err('logoUrl')}>
            <Input
              id={`${uid}-logo`}
              type="url"
              inputMode="url"
              value={form.logoUrl}
              maxLength={LIMITS.logoUrl + 20}
              disabled={readOnly}
              invalid={!!err('logoUrl')}
              placeholder="https://"
              dir="ltr"
              autoComplete="off"
              onChange={(e) => set('logoUrl', e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">{t('logoUploads')}</p>

          <Field label={t('color')} htmlFor={`${uid}-color`} hint={t('colorHint')} error={err('brandColor')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t('colorPick')}
                value={colourOk ? colour.toLowerCase() : '#0b3d2e'}
                disabled={readOnly}
                onChange={(e) => set('brandColor', e.target.value.toUpperCase())}
                className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <Input
                id={`${uid}-color`}
                value={form.brandColor}
                maxLength={7}
                disabled={readOnly}
                invalid={!!err('brandColor')}
                placeholder="#0B3D2E"
                dir="ltr"
                className="max-w-40 uppercase"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set('brandColor', e.target.value.trim())}
              />
              {colour && !readOnly && (
                <Button type="button" variant="ghost" size="sm" onClick={() => set('brandColor', '')}>
                  {t('colorClear')}
                </Button>
              )}
            </div>
          </Field>
        </div>

        <figure className="space-y-2 text-center">
          <div
            className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted p-3"
            style={colourOk ? { borderBottomColor: colour, borderBottomWidth: 4 } : undefined}
          >
            {logoOk ? <LogoPreview key={logo} url={logo} /> : <span className="text-xs text-muted-foreground">{t('noLogo')}</span>}
          </div>
          <figcaption className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="inline-block size-4 rounded-full border border-border"
              style={{ backgroundColor: colourOk ? colour : 'transparent' }}
            />
            {colourOk ? <span dir="ltr">{colour.toUpperCase()}</span> : t('noColor')}
          </figcaption>
        </figure>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('invoiceTitle')} htmlFor={`${uid}-title`} hint={t('invoiceTitleHint')} error={err('invoiceTitle')}>
          <Input
            id={`${uid}-title`}
            value={form.invoiceTitle}
            maxLength={LIMITS.invoiceTitle + 20}
            disabled={readOnly}
            invalid={!!err('invoiceTitle')}
            placeholder={suggestedTitle ?? t('invoiceTitlePlaceholder')}
            dir="auto"
            onChange={(e) => set('invoiceTitle', e.target.value)}
          />
          {suggestedTitle && !readOnly && form.invoiceTitle.trim() !== suggestedTitle && (
            <button
              type="button"
              onClick={() => set('invoiceTitle', suggestedTitle)}
              className="mt-1 inline-flex min-h-8 items-center rounded-md px-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('useSuggested', { title: suggestedTitle })}
            </button>
          )}
        </Field>
        <Field label={t('footer')} htmlFor={`${uid}-footer`} hint={t('footerHint')} error={err('footerNote')} className="sm:col-span-2">
          <Textarea id={`${uid}-footer`} rows={3} value={form.footerNote} disabled={readOnly} invalid={!!err('footerNote')} dir="auto" onChange={(e) => set('footerNote', e.target.value)} />
        </Field>
      </div>
    </Section>
  );
}

function LogoPreview({ url }: { url: string }) {
  const t = useTranslations('invoicing.settings.branding');
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="text-xs text-warning">{t('logoBroken')}</span>;
  // A plain img: the logo is any https address the person typed, which next/image would need allow-listed host by host.
  return <img src={url} alt={t('logoAlt')} className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
