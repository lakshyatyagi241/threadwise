'use client';

import { useTranslations } from 'next-intl';
import { useCompanyProperties } from '../api/properties';
import type { CompanyResponse } from '../api/schemas';
import { shownGroups } from '../lib/properties';

/**
 * The company's own properties (Settings, Company properties) that hold a value, under their sections. Renders nothing when the
 * workspace defined none, none holds a value, or the person may not see the definitions.
 */
export function PropertiesCard({ company }: { company: Pick<CompanyResponse, 'customFields'> }) {
  const t = useTranslations('companies.detail');
  const props = useCompanyProperties();
  const groups = shownGroups(props.fields, props.sections, company.customFields, {
    yes: t('yes'),
    no: t('no'),
  });
  if (groups.length === 0) return null;
  return (
    <section
      aria-labelledby="company-properties"
      className="rounded-md border border-border bg-background p-4"
    >
      <h2
        id="company-properties"
        className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('properties')}
      </h2>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.section?.id ?? 'loose'}>
            {g.section && (
              <h3 className="mb-1.5 text-sm font-semibold" dir="auto">
                {g.section.name}
              </h3>
            )}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {g.values.map((v) => (
                <div key={v.field.id} className="min-w-0">
                  <dt className="text-xs text-muted-foreground" dir="auto">
                    {v.field.label}
                  </dt>
                  <dd className="break-words" dir="auto">
                    {v.text}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
