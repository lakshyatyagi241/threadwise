'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Select, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import type { ContactRow } from '../../api/schemas';
import { optionColor } from '../../lib/stage-model';
import { useStageChange } from './use-stage-change';

/**
 * The contact's lifecycle stage as ONE thin line under the header: the workspace's stages as small steps (the contact's stage
 * filled, the ones before it tinted), a click on a step changes the stage (a lost stage asks why first, the toast says what happened
 * to the status), and the status is a small menu at the end, offering the statuses that are valid in the stage. It replaces the two big
 * blocks (the stage stepper and the status bar) and keeps all of their behaviour: it is the same `useStageChange`.
 */
export function StageStrip({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.stages');
  const tr = useTranslations('contacts-attributes-tags.contact.record.stageStrip');
  const canUpdate = useCan('record.contacts.update');
  const stage = useStageChange(contact);
  const current = contact.lifecycleStage;
  const at = stage.stages.findIndex((s) => s.value === current);
  const list = useRef<HTMLOListElement>(null);
  // On a narrow screen the line scrolls: keep the contact's own stage in view.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-current="step"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current, stage.stages.length]);
  if (stage.stages.length === 0) return null;
  return (
    <section
      aria-label={t('title')}
      className="flex items-center gap-2 rounded-xl border border-border bg-background px-2 py-1.5"
    >
      <ol
        ref={list}
        aria-label={t('stages')}
        className="thin-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {stage.stages.map((s, i) => {
          const active = s.value === current;
          const done = at >= 0 && i < at;
          const hint = canUpdate && !active ? stage.hint(s.value) : null;
          return (
            <li key={s.value} className="shrink-0">
              <button
                type="button"
                disabled={!canUpdate || stage.busy}
                aria-current={active ? 'step' : undefined}
                title={hint ?? undefined}
                onClick={() => stage.changeStage(s.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default',
                  active
                    ? 'border-brand bg-brand font-semibold text-brand-foreground'
                    : done
                      ? 'border-brand/30 bg-brand/10 text-foreground hover:bg-brand/15'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background: active
                      ? 'currentColor'
                      : optionColor({ value: s.value, color: s.color }),
                  }}
                />
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      {stage.statuses.length > 0 && (
        <Select
          aria-label={t('status')}
          value={contact.status ?? ''}
          disabled={!canUpdate || stage.busy}
          onChange={(e) => stage.changeStatus(e.target.value)}
          className="h-7 w-auto min-w-28 max-w-40 shrink-0 px-2 py-0 text-xs"
        >
          {contact.status === null || contact.status === '' ? (
            <option value="" disabled>
              {tr('noStatus')}
            </option>
          ) : null}
          {stage.statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      )}
      {stage.dialog}
    </section>
  );
}
