'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@crm/ui';
import { CANONICAL_ITEMS, CANONICAL_NOTES, itemPath, notePath } from '../lib/notice-text';
import type { Acks } from '../lib/wizard-model';

/**
 * The risk notice (spec 6.1): three statements and the plain notes.
 *
 * TRANSLATION STATUS: the English is the canonical text of `@crm/contracts` (the API hashes it into each acknowledgement). The
 * Arabic in `messages/ar/whatsapp-devices-baileys.json` is a DRAFT for counsel review (spec decision D1): a legal notice needs a human
 * translation before any pilot workspace is allowed. This is a note for reviewers; the screen does not say so.
 *
 * With `acks` the statements are checkboxes, each ticked on its own (never pre-ticked, no "agree to all"); without it they are read-only.
 */
export function RiskNotice({
  version,
  acks,
  onTick,
}: {
  version: string;
  acks?: Acks;
  onTick?: (index: number, value: boolean) => void;
}) {
  const t = useTranslations('whatsapp-devices-baileys.notice');
  const root = useTranslations('whatsapp-devices-baileys');
  const text = (path: string, fallback: string) => (root.has(path) ? root(path) : fallback);

  return (
    <div className="space-y-4" data-testid="risk-notice">
      <ol className="space-y-3" aria-label={t('listLabel')}>
        {CANONICAL_ITEMS.map((item, i) => {
          const body = text(itemPath(version, item.id), item.text);
          return (
            <li key={item.id} className="rounded-md border border-border p-3">
              {acks ? (
                <Checkbox
                  id={`notice-ack-${i}`}
                  checked={acks[i] ?? false}
                  onChange={(e) => onTick?.(i, e.target.checked)}
                  label={body}
                />
              ) : (
                <p className="text-sm">
                  <span className="me-2 font-semibold">{i + 1}.</span>
                  {body}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="rounded-md bg-muted p-3">
        <h3 className="text-sm font-semibold">{t('notesTitle')}</h3>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">
          {CANONICAL_NOTES.map((n) => (
            <li key={n.id}>{text(notePath(version, n.id), n.text)}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">{t('version', { version })}</p>
    </div>
  );
}
