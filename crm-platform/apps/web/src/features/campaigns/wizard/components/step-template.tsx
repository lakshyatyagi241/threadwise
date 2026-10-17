'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  WIZARD_NAME_MAX,
  type SenderHidden,
  type WizardSender,
  type WizardTemplate,
} from '@crm/contracts';
import type { TplAiDraft } from '@crm/contracts';
import { Button, Field, Input, Select } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { stashAiDraft } from '@/features/message-templates/lib/ai-draft';
import { SparkIcon } from '@/features/message-templates/components/icons';
import { TemplateAiModal } from '@/features/message-templates/components/template-ai-modal';
import { SenderSharePicker } from './sender-share-picker';
import { SenderEmptyNotice, SenderLoading } from '../../components/sender-empty';
import { issueFor, type StepIssue } from '../lib/issues';
import { TemplatePicker, type TemplatesQuery } from './template-picker';
import { TemplatePreview } from './template-preview';

/** The language the wizard writes a drafted template in (the wizard picks no language of its own). */
export const AI_TEMPLATE_LANGUAGE = 'en_US';

/** The connection uuid of a `waba:<uuid>` sender key, which the new-template form takes as the number to start on. */
export function wabaConnectionOf(senderKey: string | null): string | null {
  const m = /^waba:([0-9a-f-]{36})$/i.exec(senderKey ?? '');
  return m ? m[1]! : null;
}

/** Where the new-template form opens for the chosen number (the form starts on that number). */
export function newTemplateHref(senderKey: string | null): string {
  const connection = wabaConnectionOf(senderKey);
  return connection ? `/templates/new?connection=${connection}` : '/templates/new';
}

/** Step 1: the broadcast's name and the approved template it sends, with the live preview beside the list. */
export function StepTemplate({
  name,
  templateId,
  senderKey,
  senderKeys = [],
  senderShare = {},
  senders,
  hidden,
  templates,
  issues,
  disabled,
  onName,
  onTemplate,
  onSender,
  onSenders,
}: {
  name: string;
  templateId: string | null;
  senderKey: string | null;
  /** The numbers a send is shared across when more than one is ticked (empty: the single number in `senderKey`). */
  senderKeys?: readonly string[];
  /** Their share weights by key. */
  senderShare?: Readonly<Record<string, number>>;
  /** The connected numbers (undefined while they load). */
  senders: readonly WizardSender[] | undefined;
  /** The numbers the server left out, so an empty list can say why. */
  hidden?: readonly SenderHidden[] | undefined;
  templates: TemplatesQuery;
  /** Shown only after the person tried to continue. */
  issues: StepIssue[];
  disabled?: boolean;
  onName: (name: string) => void;
  onTemplate: (t: WizardTemplate) => void;
  onSender: (key: string) => void;
  /** Ticking numbers to share the send across (TW-BCAST-006); absent: the share picker is not offered. */
  onSenders?: (keys: string[], share: Record<string, number>) => void;
}) {
  const t = useTranslations('campaigns.wizard.template');
  const ti = useTranslations('campaigns.wizard.issues');
  const selected = templates.data?.data.find((x) => x.id === templateId) ?? null;
  const router = useRouter();
  const mayCreateTemplate = useCan('tpl.templates.create');
  const [aiOpen, setAiOpen] = useState(false);
  // "Build with AI" (TW-TPL-016): the draft goes to the new-template form in this tab, which fills itself from it; the template must
  // then pass Meta's review before this list offers it. The wizard's own draft autosaves, so coming back resumes this campaign.
  const sendDraftToTemplates = (draft: TplAiDraft) => {
    stashAiDraft({ draft, language: AI_TEMPLATE_LANGUAGE, metaCategory: 'MARKETING' });
    router.push(newTemplateHref(senderKey));
  };
  const nameIssue = issueFor(issues, 'name');
  const tplIssue = issueFor(issues, 'templateId');
  const senderIssue = issueFor(issues, 'senderKey');
  // Sharing needs two connected numbers (a personal number can share a send too). It is open when the draft already shares, or once the person asks for it.
  const shareable = senders ?? [];
  const [askedShare, setAskedShare] = useState(false);
  const sharing = senderKeys.length > 1 || askedShare;
  const ticked = senderKeys.length > 1 ? senderKeys : senderKey ? [senderKey] : [];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Field
          label={t('nameLabel')}
          htmlFor="wizard-name"
          hint={t('nameHint')}
          error={nameIssue ? ti(nameIssue.code) : undefined}
        >
          <Input
            id="wizard-name"
            value={name}
            maxLength={WIZARD_NAME_MAX}
            disabled={disabled}
            invalid={Boolean(nameIssue)}
            autoComplete="off"
            onChange={(e) => onName(e.target.value)}
            placeholder={t('namePlaceholder')}
          />
        </Field>
        <Field
          label={t('senderLabel')}
          htmlFor="wizard-sender"
          hint={senders && senders.length > 0 ? t('senderHint') : undefined}
          error={senders && senders.length > 0 && senderIssue ? ti(senderIssue.code) : undefined}
        >
          {!senders ? (
            <SenderLoading id="wizard-sender" />
          ) : senders.length === 0 ? (
            <SenderEmptyNotice id="wizard-sender" hidden={hidden} />
          ) : sharing && onSenders ? (
            <SenderSharePicker
              senders={shareable}
              keys={ticked}
              share={senderShare}
              disabled={disabled}
              onChange={onSenders}
            />
          ) : (
            <Select
              id="wizard-sender"
              value={senderKey ?? ''}
              disabled={disabled}
              invalid={Boolean(senderIssue)}
              onChange={(e) => onSender(e.target.value)}
            >
              {!senderKey && <option value="">{t('pickSender')}</option>}
              {senders.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                  {s.phone ? ` (${s.phone})` : ''} - {s.engineLabel}
                  {s.guided ? '' : ` - ${t('classicOption')}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {onSenders && senders && shareable.length > 1 && (
          <label className="-mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={sharing}
              disabled={disabled}
              onChange={(e) => {
                setAskedShare(e.target.checked);
                // Turning it off leaves the first ticked number as the one number.
                if (!e.target.checked && senderKeys.length > 1) onSender(senderKeys[0]!);
              }}
            />
            <span>{t('shareToggle')}</span>
          </label>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('pickTitle')}</h2>
            {mayCreateTemplate && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full border-brand/40 text-brand"
                disabled={disabled}
                onClick={() => setAiOpen(true)}
              >
                <SparkIcon className="size-3.5" />
                {t('buildWithAi')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('pickHint')}</p>
          <TemplatePicker
            templates={templates}
            createHref={mayCreateTemplate ? newTemplateHref(senderKey) : null}
            selectedId={templateId}
            onSelect={(tpl) => !disabled && onTemplate(tpl)}
            invalid={Boolean(tplIssue)}
          />
          {tplIssue && (
            <p role="alert" className="text-xs text-danger">
              {ti(tplIssue.code)}
            </p>
          )}
        </div>
      </div>
      <TemplatePreview template={selected} />
      {mayCreateTemplate && (
        <TemplateAiModal
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          language={AI_TEMPLATE_LANGUAGE}
          metaCategory="MARKETING"
          onDraft={sendDraftToTemplates}
          note={t('aiNote')}
        />
      )}
    </div>
  );
}
