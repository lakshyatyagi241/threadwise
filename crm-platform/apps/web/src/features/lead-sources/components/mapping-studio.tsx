'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { applyPath, type PathTarget, type SourceDraft } from '../lib/draft';
import { MappingFields } from './mapping-fields';
import { MappingPreview } from './mapping-preview';
import type { FieldsProps, SetDraft } from './source-fields';

/**
 * Which mapping input the person focused last, and what a click on a payload-path chip does to it. The external id path input of the
 * basics and every input of the mapping report here, so a chip fills whichever one the person was in.
 */
export function usePathFocus(draft: SourceDraft, set: SetDraft) {
  const t = useTranslations('lead-sources');
  const [focus, setFocus] = useState<PathTarget | null>(null);

  const pick = useCallback(
    (path: string) => {
      if (focus) set((d) => applyPath(d, focus, path));
    },
    [focus, set],
  );

  let label: string | null = null;
  if (focus?.kind === 'field') label = t(`mapping.fields.${focus.field}`);
  else if (focus?.kind === 'attribution') label = t(`mapping.attributionFields.${focus.field}`);
  else if (focus?.kind === 'externalId') label = t('form.externalIdPath');
  else if (focus?.kind === 'custom') {
    const row = draft.mapping.customFields.find((r) => r.id === focus.rowId);
    label = row?.key ? row.key : t('mapping.property');
  }
  return { focus, setFocus, pick, label };
}

/**
 * The mapping inputs next to their live preview. The preview needs a saved source (the API previews against one), so this is what
 * the wizard shows after the source is created and what the detail page shows for an existing one. Without the manage permission
 * the inputs are read only and there is no preview (it calls a manage-only route).
 */
export function MappingStudio({
  sourceId,
  draft,
  set,
  problems,
  server,
  disabled,
  canPreview,
  focus,
}: FieldsProps & {
  sourceId: string;
  canPreview: boolean;
  focus: ReturnType<typeof usePathFocus>;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <MappingFields
        draft={draft}
        set={set}
        problems={problems}
        server={server}
        disabled={disabled}
        onFocusTarget={focus.setFocus}
      />
      {canPreview && (
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <MappingPreview
            sourceId={sourceId}
            draft={draft}
            onPick={focus.pick}
            focusedLabel={focus.label}
          />
        </div>
      )}
    </div>
  );
}
