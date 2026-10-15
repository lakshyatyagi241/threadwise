'use client';

import { useTranslations } from 'next-intl';
import { CHILDREN_POLICIES, effectivePolicy } from '@crm/contracts';
import { Alert, Badge, Field, Select, Switch } from '@crm/ui';
import type { Problem, SettingsForm } from '../lib/model';
import { CARD, OfficerFields } from './fields';

/**
 * Who a person or a regulator can reach (a data protection officer or privacy contact, and the grievance officer the Indian DPDP Act
 * asks for), and the children flag. A profile that is on says which of them it asks for.
 */
export function ContactsTab({
  form,
  patch,
  problems,
  canManage,
}: {
  form: SettingsForm;
  patch: (p: Partial<SettingsForm>) => void;
  problems: Problem[];
  canManage: boolean;
}) {
  const t = useTranslations('compliance-center.contacts');
  const required = effectivePolicy(form.regimes).requirements;
  const dpdp = form.regimes.includes('dpdp_in');
  const minorAge = effectivePolicy(form.regimes).minorAge;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <section className={CARD} data-testid="dpo-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('dpo.title')}</h3>
          {required.includes('dpo_contact') && (
            <Badge tone="warning">{t('requiredByProfile')}</Badge>
          )}
        </div>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t('dpo.hint')}</p>
        <OfficerFields
          idPrefix="dpo"
          path="dpo"
          value={form.dpo}
          onChange={(dpo) => patch({ dpo })}
          problems={problems}
          disabled={!canManage}
        />
      </section>

      <section className={CARD} data-testid="grievance-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('grievance.title')}</h3>
          {required.includes('grievance_officer') && (
            <Badge tone="warning">{t('requiredByProfile')}</Badge>
          )}
        </div>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t('grievance.hint')}</p>
        <OfficerFields
          idPrefix="grievance"
          path="grievanceOfficer"
          value={form.grievanceOfficer}
          onChange={(grievanceOfficer) => patch({ grievanceOfficer })}
          problems={problems}
          disabled={!canManage}
        />
      </section>

      <section className={CARD} data-testid="children-card">
        <h3 className="text-sm font-semibold">{t('children.title')}</h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t('children.hint')}</p>
        <Field label={t('children.policy')} htmlFor="children-policy">
          <Select
            id="children-policy"
            value={form.childrenPolicy}
            disabled={!canManage}
            onChange={(e) =>
              patch({ childrenPolicy: e.target.value as SettingsForm['childrenPolicy'] })
            }
          >
            {CHILDREN_POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(`children.policies.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        {form.childrenPolicy === 'may_include_minors' && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="parental"
                checked={form.parentalConsentRequired}
                onCheckedChange={(v) => patch({ parentalConsentRequired: v })}
                label={t('children.parental')}
                disabled={!canManage}
              />
              <label htmlFor="parental" className="text-sm">
                {t('children.parental')}
              </label>
            </div>
            <p className="text-xs text-muted-foreground">{t('children.parentalHint')}</p>
          </div>
        )}
        {minorAge !== null && form.childrenPolicy !== 'no_minors' && (
          <Alert className="mt-3">{t('children.age', { age: minorAge })}</Alert>
        )}
        {dpdp && form.childrenPolicy === 'unset' && (
          <Alert tone="warning" className="mt-3">
            {t('children.dpdpNeedsAnswer')}
          </Alert>
        )}
      </section>
    </div>
  );
}
