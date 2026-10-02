'use client';

import { useTranslations } from 'next-intl';
import { Button, Field, Input, Select, Textarea, cn, useToast } from '@crm/ui';
import { COLORS, LIMITS } from '../lib/booking-form';
import { LOCATION_TYPES, type LocationType } from '../api/schemas';
import { publicLink } from '../lib/editor';
import { CheckIcon, CopyIcon, LinkIcon } from './icons';
import { SectionCard, SwitchRow, TextField, useEditor } from './editor-shared';

/** Step 1: the service's name and place, its colour and public link, and the two switches (approval, active). */
export function ServiceStep({
  onName,
  onSlug,
  origin,
  orgSlug,
}: {
  onName: (name: string) => void;
  onSlug: (slug: string) => void;
  origin: string;
  orgSlug: string;
}) {
  const t = useTranslations('appointments.editor.service');
  const { draft, set, err, fid, disabled } = useEditor();
  const { toast } = useToast();
  const url = publicLink(origin, orgSlug, draft.slug);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('copied'), 'success');
    } catch {
      toast(t('copyFailed'), 'danger');
    }
  }

  const colorError = err('color');

  return (
    <div className="space-y-4">
      <SectionCard title={t('title')} hint={t('hint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            name="name"
            label={
              <>
                {t('name')} <span className="text-danger">*</span>
              </>
            }
            placeholder={t('namePlaceholder')}
            maxLength={LIMITS.nameMax}
            className="sm:col-span-2"
            onValue={onName}
          />
          <Field
            label={t('description')}
            htmlFor={fid('description')}
            error={err('description')}
            className="sm:col-span-2"
          >
            <Textarea
              id={fid('description')}
              rows={2}
              value={draft.description}
              invalid={!!err('description')}
              disabled={disabled}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('descriptionPlaceholder')}
            />
          </Field>
          <Field label={t('locationType')} htmlFor={fid('locationType')}>
            <Select
              id={fid('locationType')}
              value={draft.locationType}
              disabled={disabled}
              onChange={(e) => set('locationType', e.target.value as LocationType)}
            >
              {LOCATION_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(`locationTypes.${v}`)}
                </option>
              ))}
            </Select>
          </Field>
          <TextField
            name="locationValue"
            label={t('locationValue')}
            placeholder={t(`locationPlaceholders.${draft.locationType}`)}
          />
        </div>
      </SectionCard>

      <SectionCard title={t('appearanceTitle')} hint={t('appearanceHint')}>
        <Field label={t('color')} htmlFor={fid('color')} error={colorError}>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t('colorSwatches')}
              className="flex flex-wrap items-center gap-2"
            >
              {COLORS.map((c) => {
                const on = draft.color.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    aria-label={c}
                    title={c}
                    onClick={() => set('color', c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full border-2 border-background text-white outline-none ring-1 ring-border transition',
                      'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
                      on && 'ring-2 ring-foreground',
                    )}
                  >
                    {on && <CheckIcon className="size-4" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Input
                id={fid('color')}
                value={draft.color}
                invalid={!!colorError}
                disabled={disabled}
                maxLength={7}
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => set('color', e.target.value.trim())}
                className="w-28 font-mono uppercase"
              />
            </div>
          </div>
        </Field>
      </SectionCard>

      <SectionCard title={t('linkTitle')} hint={t('linkHint')}>
        <div className="space-y-3">
          <Field label={t('slug')} htmlFor={fid('slug')} hint={t('slugHint')} error={err('slug')}>
            <Input
              id={fid('slug')}
              value={draft.slug}
              invalid={!!err('slug')}
              disabled={disabled}
              maxLength={LIMITS.slugMax}
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
              placeholder={t('slugPlaceholder')}
              onChange={(e) => onSlug(e.target.value)}
              className="font-mono"
            />
          </Field>
          <div>
            <div className="mb-1.5 text-sm font-medium" id={fid('url-label')}>
              {t('publicUrl')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm"
                aria-labelledby={fid('url-label')}
              >
                <LinkIcon className="size-4 text-muted-foreground" />
                <span
                  dir="ltr"
                  className="thin-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs"
                >
                  {url}
                </span>
              </div>
              <Button variant="secondary" onClick={() => void copy()}>
                <CopyIcon /> {t('copy')}
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t('rulesTitle')}>
        <div className="space-y-3">
          <SwitchRow
            id={fid('requiresApproval')}
            checked={draft.requiresApproval}
            onChange={(on) => set('requiresApproval', on)}
            disabled={disabled}
            title={t('requiresApproval')}
            hint={t('requiresApprovalHint')}
          />
          <SwitchRow
            id={fid('isActive')}
            checked={draft.isActive}
            onChange={(on) => set('isActive', on)}
            disabled={disabled}
            title={t('isActive')}
            hint={t('isActiveHint')}
          />
        </div>
      </SectionCard>
    </div>
  );
}
