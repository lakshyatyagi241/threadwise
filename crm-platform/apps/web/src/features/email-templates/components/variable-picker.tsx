'use client';

import { useTranslations } from 'next-intl';
import { EMAIL_TEMPLATE_VARIABLE_GROUPS, EMAIL_TEMPLATE_VARIABLES } from '@crm/contracts';

/**
 * The variables a template can use, as chips grouped by where the value comes from (the contact, the person sending, the workspace).
 * A chip inserts `{{key}}` where the person was last typing. The sample value is shown on hover only; real values are filled in when
 * the template is used.
 */
export function VariablePicker({
  onInsert,
  disabled,
}: {
  onInsert: (token: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('emailTemplates.editor');
  return (
    <div data-testid="email-template-variables" className="space-y-2">
      {EMAIL_TEMPLATE_VARIABLE_GROUPS.map((group) => (
        <div key={group} className="flex flex-wrap items-center gap-1.5">
          <span className="me-1 text-xs text-muted-foreground">{t(`variableGroups.${group}`)}</span>
          {EMAIL_TEMPLATE_VARIABLES.filter((v) => v.group === group).map((v) => (
            <button
              key={v.key}
              type="button"
              dir="ltr"
              disabled={disabled}
              title={v.sample}
              data-testid={`email-template-variable-${v.key}`}
              // Keeps the caret where it was: the chip must not take focus from the box being edited.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(`{{${v.key}}}`)}
              className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
