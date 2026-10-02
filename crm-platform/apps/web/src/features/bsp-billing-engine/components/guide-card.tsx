'use client';

import { useTranslations } from 'next-intl';
import { Badge, Card } from '@crm/ui';

const PERMISSIONS = ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'];

/** The setup guide beside the forms: where to find each value at Meta and what to know before attaching. */
export function GuideCard() {
  const t = useTranslations('bsp-billing-engine.console.guide');
  return (
    <Card className="space-y-4 lg:sticky lg:top-4">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <ol className="space-y-3 text-sm">
        <li>
          <p className="font-medium">1. {t('step1Title')}</p>
          <p className="text-muted-foreground">{t('step1Body')}</p>
        </li>
        <li>
          <p className="font-medium">2. {t('step2Title')}</p>
          <p className="text-muted-foreground">{t('step2Body')}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" dir="ltr">
            {PERMISSIONS.map((p) => (
              <Badge key={p} className="font-mono">
                {p}
              </Badge>
            ))}
          </div>
        </li>
        <li>
          <p className="font-medium">3. {t('step3Title')}</p>
          <p className="text-muted-foreground">{t('step3Body')}</p>
        </li>
      </ol>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{t('goodTitle')}</p>
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          <li>{t('good1')}</li>
          <li>{t('good2')}</li>
          <li>{t('good3')}</li>
        </ul>
      </div>
      <a
        href="https://developers.facebook.com/docs/whatsapp/solution-providers/"
        target="_blank"
        rel="noreferrer noopener"
        className="inline-block text-sm text-primary underline underline-offset-2"
      >
        {t('link')}
      </a>
    </Card>
  );
}
