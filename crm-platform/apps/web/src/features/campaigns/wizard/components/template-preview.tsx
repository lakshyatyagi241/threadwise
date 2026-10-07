'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { WizardTemplate } from '@crm/contracts';
import { PhonePreview } from '@/features/message-templates/components/message-bubble';
import { previewModelOf } from '../lib/templates';

/** The selected template on the phone frame the template screens use; a hint until one is chosen. */
export function TemplatePreview({ template }: { template: WizardTemplate | null }) {
  const t = useTranslations('campaigns.wizard.template');
  const model = useMemo(() => (template ? previewModelOf(template) : null), [template]);
  return (
    <div className="space-y-2 lg:sticky lg:top-4">
      <h2 className="text-sm font-semibold">{t('previewTitle')}</h2>
      {model ? (
        <>
          <PhonePreview model={model} />
          {template && template.slots.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('previewVariables', { count: template.slots.length })}
            </p>
          )}
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('previewEmpty')}
        </p>
      )}
    </div>
  );
}
