'use client';

import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import type { FlowNode } from '@crm/contracts';
import { FLB_WA_LIMITS } from '@crm/contracts';
import { FlowEditorContext } from '../lib/flow-editor-context';

/** The node types whose text is edited on the card: a message's text, a quick-reply list's labels, a media node's caption. */
export const INLINE_EDIT_TYPES: ReadonlySet<string> = new Set(['message', 'buttons', 'media']);

/** Stops a pointer or click in a field from starting a drag of the card, while the field keeps its own cursor and selection. */
const keepInField = (e: React.SyntheticEvent) => e.stopPropagation();

const FIELD =
  'w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] leading-snug text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The editable body of a message, quick-reply or media card: the same data the inspector writes, changed in place. Each change goes
 * through `onPatch`, so it is saved with the flow like any other edit. Limits follow the WhatsApp rules when the flow is a WhatsApp one.
 */
export function InlineEditBody({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch: (nodeId: string, patch: Record<string, unknown>) => void;
}) {
  const ts = useTranslations('flb.builder.simple.editors');
  const tf = useTranslations('flb.builder.formsCore.options');
  const { whatsapp } = useContext(FlowEditorContext);
  const data = node.data as Record<string, unknown>;

  if (node.type === 'message') {
    return (
      <div className="space-y-1 px-3 pb-3" onPointerDown={keepInField} onMouseDown={keepInField}>
        <textarea
          aria-label={ts('message.label')}
          rows={3}
          maxLength={whatsapp ? FLB_WA_LIMITS.body : undefined}
          value={typeof data.text === 'string' ? data.text : ''}
          onChange={(e) => onPatch(node.id, { text: e.target.value })}
          className={`${FIELD} resize-y`}
        />
      </div>
    );
  }

  if (node.type === 'buttons') {
    const options = Array.isArray(data.options)
      ? data.options.map((o) => (typeof o === 'string' ? o : ''))
      : [];
    return (
      <div className="space-y-1.5 px-3 pb-3" onPointerDown={keepInField} onMouseDown={keepInField}>
        {options.map((label, i) => (
          <input
            key={i}
            type="text"
            aria-label={`${tf('buttonsOptions')} ${i + 1}`}
            maxLength={whatsapp ? FLB_WA_LIMITS.buttonTitle : undefined}
            value={label}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              onPatch(node.id, { options: next });
            }}
            className={FIELD}
          />
        ))}
      </div>
    );
  }

  // media
  return (
    <div className="space-y-1 px-3 pb-3" onPointerDown={keepInField} onMouseDown={keepInField}>
      <input
        type="text"
        aria-label={ts('media.caption')}
        value={typeof data.caption === 'string' ? data.caption : ''}
        onChange={(e) => onPatch(node.id, { caption: e.target.value })}
        className={FIELD}
      />
    </div>
  );
}
