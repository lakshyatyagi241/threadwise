'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog } from '@crm/ui';
import { isBlankRecipe, type DocProblem, type DocsCheck } from '../lib/json-docs';
import {
  STARTER_TEMPLATES,
  recipeStarterFor,
  starterDocs,
  type StarterTemplate,
} from '../lib/starters';
import { JsonEditor } from './json-editor';
import { ScopeList } from './ui';

const NS = 'marketplace.operator.editor';

export interface DocsText {
  manifestText: string;
  recipeText: string;
}

/**
 * The manifest editor and (for an integration) the recipe editor, with the permission summary of the manifest and, on a new listing,
 * the starter templates. The parent owns the text and the check; this only shows them and reports edits.
 */
export function DocsEditors({
  idPrefix,
  value,
  onChange,
  check,
  settled,
  problems,
  withTemplates,
  disabled,
}: {
  idPrefix: string;
  value: DocsText;
  onChange: (next: DocsText) => void;
  check: DocsCheck;
  /** False while the check is behind the typing: no "valid" confirmation is shown then. */
  settled: boolean;
  /** Everything to list: the typed text's problems and the API's. */
  problems: readonly DocProblem[];
  /** Offer "Start from a template" (a new listing). */
  withTemplates?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations(NS);
  const [pending, setPending] = useState<StarterTemplate | null>(null);

  const apply = (template: StarterTemplate) => {
    onChange(starterDocs(template));
    setPending(null);
  };
  const pick = (template: StarterTemplate) => {
    // Replacing what the person typed is asked about; an empty editor is filled at once.
    if (value.manifestText.trim() !== '' || !isBlankRecipe(value.recipeText)) setPending(template);
    else apply(template);
  };

  const showRecipe = check.kind !== 'mini_app' || !isBlankRecipe(value.recipeText);
  const manifestValid =
    settled &&
    check.manifest !== null &&
    check.problems.every((p) => p.doc !== 'manifest' || p.severity !== 'error');
  const recipeValid =
    settled &&
    check.recipe !== null &&
    check.problems.every((p) => p.doc !== 'recipe' || p.severity !== 'error');

  return (
    <div className="space-y-6">
      {withTemplates && (
        <div className="space-y-2" role="group" aria-labelledby={`${idPrefix}-templates`}>
          <p id={`${idPrefix}-templates`} className="text-sm font-medium">
            {t('templates.title')}
          </p>
          <p className="text-xs text-muted-foreground">{t('templates.help')}</p>
          <div className="flex flex-wrap gap-2">
            {STARTER_TEMPLATES.map((template) => (
              <Button
                key={template}
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => pick(template)}
              >
                {t(`templates.${template}`)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <JsonEditor
        id={`${idPrefix}-manifest`}
        doc="manifest"
        label={t('manifest.label')}
        hint={t('manifest.hint')}
        value={value.manifestText}
        onChange={(manifestText) => onChange({ ...value, manifestText })}
        problems={problems}
        valid={manifestValid}
        disabled={disabled}
      />

      {check.scopes.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{t('scopes.title')}</p>
          <p className="text-xs text-muted-foreground">{t('scopes.help')}</p>
          <ScopeList scopes={check.scopes} />
        </div>
      )}

      {showRecipe && (
        <JsonEditor
          id={`${idPrefix}-recipe`}
          doc="recipe"
          label={t('recipe.label')}
          hint={t('recipe.hint')}
          value={value.recipeText}
          onChange={(recipeText) => onChange({ ...value, recipeText })}
          problems={problems}
          valid={recipeValid}
          disabled={disabled}
          actions={
            isBlankRecipe(value.recipeText) ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onChange({ ...value, recipeText: recipeStarterFor(value.manifestText) })
                }
              >
                {t('recipe.insertStarter')}
              </Button>
            ) : undefined
          }
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={t('templates.replaceTitle')}
        message={t('templates.replaceBody')}
        confirmLabel={t('templates.replaceAction')}
        cancelLabel={t('cancel')}
        onConfirm={() => pending && apply(pending)}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
