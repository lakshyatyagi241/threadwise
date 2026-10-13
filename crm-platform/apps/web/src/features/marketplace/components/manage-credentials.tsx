'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Spinner, useToast } from '@crm/ui';
import type { MarketInstallation } from '@crm/contracts';
import { configureInstallation } from '../api';
import { mktError } from '../lib/errors';
import {
  buildCredentialPatch,
  credentialDisplay,
  initialValues,
  validateFields,
  type FieldProblem,
  type FieldValues,
  type SetupField,
} from '../lib/setup-form';
import { ProblemNotice } from './manage-parts';
import { SetupFields } from './setup-fields';
import { NeedsPermission, Section } from './ui';
import { useAsyncAction } from './use-async-action';

/**
 * The credentials of an installation, from the listing's setup fields. Write-only: each field says whether a value is stored (and the
 * tail of a secret), never the value. Typing replaces, blank keeps, "Clear" removes an optional one. After a save the inputs are
 * emptied, because the form is rebuilt from the answer (the parent keys it on the row version).
 */
export function CredentialsPanel({
  installation,
  fields,
  canConfigure,
  onSaved,
  onReload,
}: {
  installation: MarketInstallation;
  fields: readonly SetupField[];
  canConfigure: boolean;
  onSaved: (next: MarketInstallation) => void;
  onReload: () => void;
}) {
  const t = useTranslations('marketplace.manage.credentials');
  const ts = useTranslations('marketplace.setup');
  const { toast } = useToast();
  const action = useAsyncAction();
  const states = installation.credentials;
  const [values, setValues] = useState<FieldValues>(() => initialValues(fields, states));
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [problems, setProblems] = useState<Record<string, FieldProblem>>({});
  const [serverFields, setServerFields] = useState<Record<string, string>>({});

  if (!canConfigure) {
    return (
      <Section title={t('title')} description={t('readOnly')}>
        <ul className="space-y-2 text-sm">
          {fields.map((f) => {
            const d = credentialDisplay(states.find((s) => s.key === f.key));
            return (
              <li key={f.key} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{f.label}</span>
                <span className="text-muted-foreground">
                  {d.kind === 'notSet' && ts('stored.notSet')}
                  {d.kind === 'endsIn' && ts('stored.endsIn', { last: d.last })}
                  {d.kind === 'value' && d.value}
                  {d.kind === 'setNoHint' && ts('stored.set')}
                </span>
              </li>
            );
          })}
        </ul>
        <NeedsPermission permission="market.apps.manage" />
      </Section>
    );
  }

  const patch = buildCredentialPatch(fields, values, states, cleared);

  const save = async () => {
    setServerFields({});
    const found = validateFields(fields, values, { mode: 'edit', states, cleared });
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if (patch.empty) return;
    const outcome = await action.run(() =>
      configureInstallation(installation.id, {
        rowVersion: installation.rowVersion,
        ...(Object.keys(patch.credentials).length > 0 ? { credentials: patch.credentials } : {}),
        ...(patch.clearCredentials.length > 0 ? { clearCredentials: patch.clearCredentials } : {}),
      }),
    );
    if (!outcome.ok) {
      const view = mktError(outcome.error);
      if (Object.keys(view.fields).length > 0) setServerFields(view.fields);
      return;
    }
    // The answer holds only `isSet` and hints. The form is rebuilt from it by the parent's `key`; this clears what was typed now.
    setValues(initialValues(fields, outcome.value.credentials));
    setCleared(new Set());
    onSaved(outcome.value);
    toast(t('saved'));
  };

  const failure = action.error;
  const fieldProblem = failure && Object.keys(mktError(failure).fields).length > 0;

  return (
    <Section title={t('title')} description={t('intro')}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        <SetupFields
          fields={fields}
          values={values}
          onChange={(k, v) => {
            setValues((cur) => ({ ...cur, [k]: v }));
            setProblems((cur) => Object.fromEntries(Object.entries(cur).filter(([x]) => x !== k)));
          }}
          problems={problems}
          serverFields={serverFields}
          mode="edit"
          states={states}
          cleared={cleared}
          onToggleClear={(k, clear) =>
            setCleared((cur) => {
              const next = new Set(cur);
              if (clear) next.add(k);
              else next.delete(k);
              return next;
            })
          }
          idPrefix="mkt-cred"
          disabled={action.pending}
        />
        {failure ? (
          <ProblemNotice error={fieldProblem ? null : failure} onReload={onReload} />
        ) : null}
        {fieldProblem ? <FieldProblemLine error={failure} /> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {patch.empty && (
            <span className="text-xs text-muted-foreground">{t('nothingToSave')}</span>
          )}
          <Button type="submit" disabled={action.pending || patch.empty}>
            {action.pending && <Spinner />}
            {t('save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function FieldProblemLine({ error }: { error: unknown }) {
  const t = useTranslations('marketplace.manage.credentials');
  const view = mktError(error);
  return (
    <p role="alert" className="text-sm text-danger">
      {view.kind === 'credentialMissing' ? t('missing') : t('invalid')}
    </p>
  );
}
