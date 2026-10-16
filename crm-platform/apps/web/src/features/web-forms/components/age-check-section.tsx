'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AGE_GATE_ACTIONS, AGE_GATE_MODES, MAX_GATE_AGE, MIN_GATE_AGE } from '@crm/contracts';
import type { FormProtection } from '@crm/contracts';
import { Alert, Input, Select } from '@crm/ui';
import { withAgeGate } from '../lib/builder-model';
import { parseBoundedInt } from '../lib/settings-model';
import type { Definition } from '../lib/types';
import { FieldBox, Section, SwitchRow } from './settings-tab';
import { useState } from 'react';

/**
 * The age check of a form (BL-211, spec docs/specs/privacy-and-data-governance.md 11.10). Off by default; the section says why a person
 * would turn it on, how little each way of asking keeps, and what the gate does with an under-age answer. It never suggests wording
 * that names the minimum, because the page does not either.
 */
export function AgeCheckSection({
  draft,
  setDraft,
  disabled,
  age,
}: {
  draft: Definition;
  setDraft: (next: Definition | ((d: Definition) => Definition)) => void;
  disabled: boolean;
  age: FormProtection['age'] | null;
}) {
  const t = useTranslations('web-forms.settings.age');
  const tk = useTranslations('web-forms.kinds');
  const gate = draft.ageGate;
  const labels = { dob: tk('date_of_birth'), age: tk('age') };
  const change = (patch: Partial<Definition['ageGate']>) =>
    setDraft((d) => withAgeGate(d, patch, labels));
  const [minText, setMinText] = useState(gate.minAge === null ? '' : String(gate.minAge));
  const minInvalid =
    minText.trim() !== '' && parseBoundedInt(minText, MIN_GATE_AGE, MAX_GATE_AGE) === null;
  const holds = gate.whenUnder !== 'block';

  return (
    <Section title={t('title')} description={t('description')}>
      <SwitchRow
        label={t('enable')}
        hint={t('enableHint')}
        checked={gate.enabled}
        disabled={disabled}
        onChange={(enabled) => change({ enabled })}
      />
      {gate.enabled && (
        <div className="space-y-4" data-testid="age-check-options">
          <FieldBox label={t('mode')} hint={t(`modeHints.${gate.mode}`)}>
            {(a) => (
              <Select
                {...a}
                value={gate.mode}
                disabled={disabled}
                onChange={(e) => {
                  const mode = AGE_GATE_MODES.find((m) => m === e.target.value) ?? 'declaration';
                  change({ mode });
                }}
              >
                {AGE_GATE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`modes.${m}`)}
                  </option>
                ))}
              </Select>
            )}
          </FieldBox>
          <FieldBox
            label={t('minAge')}
            hint={t('minAgeHint', { age: age?.workspaceMinorAge ?? 18 })}
            error={
              minInvalid ? t('minAgeInvalid', { min: MIN_GATE_AGE, max: MAX_GATE_AGE }) : undefined
            }
          >
            {(a) => (
              <Input
                {...a}
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                className="max-w-32"
                value={minText}
                disabled={disabled}
                onChange={(e) => {
                  setMinText(e.target.value);
                  if (e.target.value.trim() === '') change({ minAge: null });
                  else {
                    const n = parseBoundedInt(e.target.value, MIN_GATE_AGE, MAX_GATE_AGE);
                    if (n !== null) change({ minAge: n });
                  }
                }}
              />
            )}
          </FieldBox>
          <FieldBox label={t('whenUnder')} hint={t(`actionHints.${gate.whenUnder}`)}>
            {(a) => (
              <Select
                {...a}
                value={gate.whenUnder}
                disabled={disabled}
                onChange={(e) => {
                  const whenUnder = AGE_GATE_ACTIONS.find((m) => m === e.target.value) ?? 'block';
                  change({ whenUnder });
                }}
              >
                {AGE_GATE_ACTIONS.map((m) => (
                  <option key={m} value={m}>
                    {t(`actions.${m}`)}
                  </option>
                ))}
              </Select>
            )}
          </FieldBox>
          {gate.mode === 'declaration' && gate.whenUnder === 'block' && (
            <p className="text-xs text-muted-foreground">{t('declarationBlockNote')}</p>
          )}
          {holds && age && !age.childrenAnswered && (
            <Alert tone="warning" data-testid="age-children-warning">
              {t('childrenUnanswered')}{' '}
              <Link
                href="/compliance"
                className="underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('childrenLink')}
              </Link>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">{t('neutralNote')}</p>
        </div>
      )}
    </Section>
  );
}
