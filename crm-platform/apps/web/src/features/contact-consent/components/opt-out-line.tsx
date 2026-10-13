'use client';

import { useLocale, useTranslations } from 'next-intl';
import { appendOptOutLine, hasOptOutInstruction, pickByLang } from '@crm/contracts';
import { Alert, Button, Checkbox } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useComposerConsent } from '../api/hooks';

/** Who may read the composer settings: anyone who can compose a send (the same keys the API route accepts). Hooks never short-circuit. */
function useCanCompose(): boolean {
  const broadcast = useCan('bcast.broadcasts.create');
  const campaign = useCan('camp.campaigns.create');
  const manage = useCan('settings.consent.manage');
  return broadcast || campaign || manage;
}

/** The text without the opt-out line (and the blank line above it). */
function removeLine(body: string, line: string): string {
  return body.replace(`\n\n${line}`, '').replace(line, '').replace(/\s+$/, '');
}

/** The workspace's opt-out line in the viewer's language (English when that language has none). */
function lineFor(footers: Record<string, string>, locale: string): string {
  return pickByLang(footers, locale.split('-')[0]);
}

/**
 * Under a marketing TEXT: tells the sender whether the message says how to opt out, and adds or removes the workspace's line
 * (default "Reply STOP to unsubscribe") in one click. The line is part of the message text, so what is saved is what is sent.
 * Quiet while the settings load or when the viewer may not read them: the composer works without it.
 */
export function OptOutLine({
  body,
  onChange,
  idPrefix = 'optout',
}: {
  body: string;
  onChange: (next: string) => void;
  idPrefix?: string;
}) {
  const t = useTranslations('contact-consent.composer');
  const locale = useLocale();
  const allowed = useCanCompose();
  const q = useComposerConsent(allowed);
  if (!q.data) return null;
  const line = lineFor(q.data.footerText, locale);
  if (line === '') return null;
  const all = Object.values(q.data.footerText);
  const has = body.includes(line);
  const warn = body.trim() !== '' && !hasOptOutInstruction(body, all);

  return (
    <div className="mt-2 space-y-2">
      <Checkbox
        id={`${idPrefix}-add`}
        checked={has}
        label={
          <>
            {t('add')}{' '}
            <span className="text-muted-foreground" dir="auto">
              ({line})
            </span>
          </>
        }
        onChange={(e) =>
          onChange(e.target.checked ? appendOptOutLine(body, line, all) : removeLine(body, line))
        }
      />
      {warn && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('missing')}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onChange(appendOptOutLine(body, line, all))}
          >
            {t('addButton')}
          </Button>
        </Alert>
      )}
    </div>
  );
}

/**
 * In the template editor, under the footer field: offers the workspace's opt-out line as the footer (a marketing template that tells
 * people how to opt out). Only a suggestion; an approved template is never touched. Hidden when the footer is already set or the line
 * does not fit the footer's length.
 */
export function OptOutFooterSuggestion({
  footer,
  max,
  onUse,
}: {
  footer: string;
  max: number;
  onUse: (line: string) => void;
}) {
  const t = useTranslations('contact-consent.composer');
  const locale = useLocale();
  const allowed = useCanCompose();
  const q = useComposerConsent(allowed);
  if (!q.data || footer.trim() !== '') return null;
  const line = lineFor(q.data.footerText, locale);
  if (line === '' || line.length > max) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t('footerSuggestion', { line })}</span>
      <Button size="sm" variant="secondary" onClick={() => onUse(line)}>
        {t('footerUse')}
      </Button>
    </p>
  );
}

/** Under a template send: templates are fixed by the provider's approval, so this only says what to put in the template. */
export function OptOutTemplateHint() {
  const t = useTranslations('contact-consent.composer');
  const locale = useLocale();
  const allowed = useCanCompose();
  const q = useComposerConsent(allowed);
  if (!q.data) return null;
  const line = lineFor(q.data.footerText, locale);
  return <p className="mt-2 text-xs text-muted-foreground">{t('templateHint', { line })}</p>;
}
