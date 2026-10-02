'use client';

import { useTranslations } from 'next-intl';

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  }
};

/** What the SEO form would look like in a Google result and in a shared link, updated as the person types (TW-SET-026). */
export function SeoPreview({
  brand,
  baseUrl,
  fields,
}: {
  brand: string;
  baseUrl: string;
  fields: Record<string, string | boolean>;
}) {
  const t = useTranslations('platform-settings-branding-storage.seoPreview');
  const s = (k: string) => String(fields[k] ?? '').trim();
  const title = s('metaTitle') || brand;
  const description = s('metaDescription');
  const url = s('canonical') || baseUrl;
  const ogTitle = s('ogTitle') || title;
  const ogDescription = s('ogDescription') || description;
  const image = s('ogImage');
  return (
    <div className="space-y-4" data-testid="seo-preview">
      <div className="space-y-1 rounded-lg border border-border p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('google')}
        </p>
        <p className="truncate text-xs text-muted-foreground">{url}</p>
        <p className="truncate text-base font-medium text-primary" data-testid="seo-preview-title">
          {title}
        </p>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {description || t('noDescription')}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex h-36 items-center justify-center bg-muted">
          {image ? (
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('noImage')}
            </span>
          )}
        </div>
        <div className="space-y-0.5 p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {host(s('ogUrl') || url)}
          </p>
          <p className="truncate text-sm font-semibold">{ogTitle}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{ogDescription}</p>
        </div>
      </div>
    </div>
  );
}
