'use client';

import { useMemo, type ReactNode } from 'react';
import type { ContactRow } from '../../api/schemas';
import { displayName } from '../../lib/contact-model';
import { stageChoices, statusChoices, type Choice } from '../../lib/option-sets';
import { useStatusOptions } from '../../api/attributes';
import { useStageMove, type StageTarget } from '../use-stage-move';
import { useTranslations } from 'next-intl';

export interface StageChange {
  /** The workspace's stages (the contact's own is kept in the list even when it was switched off). */
  stages: Choice[];
  /** The statuses valid in the contact's current stage. */
  statuses: Choice[];
  statusLabel: (value: string) => string;
  /** The statuses valid in any stage (the small choices the stage picker shows under a stage). */
  statusesOf: (stage: string) => Choice[];
  /** The default status of a stage, if the workspace set one. */
  defaultStatusOf: (stage: string) => string | null;
  /** What moving to `stage` does to the status the contact holds ("Status becomes X"); null = nothing. */
  hint: (stage: string) => string | null;
  /** Moves the contact to a stage (and, when given, a status); a lost stage asks for the reason first. */
  changeStage: (stage: string, status?: string | null) => void;
  /** Sets the status within the current stage. */
  changeStatus: (status: string) => void;
  busy: boolean;
  /** The lost-reason dialog; render it once beside the control that calls `changeStage`. */
  dialog: ReactNode;
}

/** What a stage move starts from, read off a contact row. */
export const stageTargetOf = (c: ContactRow, name = displayName(c)): StageTarget => ({
  id: c.id,
  name,
  rowVersion: c.rowVersion,
  stage: c.lifecycleStage,
  status: c.status,
});

/**
 * Changing one contact's lifecycle stage and status on its own screen (the record page and the quick view): `useStageMove` with this
 * contact filled in, so the page, the quick view, the list and the board all move a contact the same way.
 */
export function useStageChange(contact: ContactRow): StageChange {
  const m = useStageMove();
  const options = useStatusOptions();
  const tf = useTranslations('contacts-attributes-tags.form');
  const target = stageTargetOf(contact);
  const stages = useMemo(
    () => stageChoices(options.data, contact.lifecycleStage ?? undefined),
    [options.data, contact.lifecycleStage],
  );
  const statuses = useMemo(
    () =>
      statusChoices(
        options.data,
        (v) => tf(`statuses.${v}`),
        contact.status ?? undefined,
        contact.lifecycleStage ?? '',
      ),
    [options.data, tf, contact.status, contact.lifecycleStage],
  );
  return {
    stages,
    statuses,
    statusLabel: m.statusLabel,
    statusesOf: m.statusesOf,
    defaultStatusOf: m.defaultStatusOf,
    hint: (stage) => m.hintFor(contact.status, stage),
    changeStage: (stage, status) => void m.move(target, { stage, status }),
    changeStatus: (status) => {
      if (contact.lifecycleStage) void m.move(target, { stage: contact.lifecycleStage, status });
    },
    busy: m.busyId === contact.id,
    dialog: m.dialog,
  };
}
