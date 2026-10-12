'use server';

import { getLocale } from 'next-intl/server';
import { localized } from '@/features/help-center/resolve';
import { getVisibleHelp } from '@/features/help-center/server';
import { guideSteps } from './lib/steps';

const DOC_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The how-to steps of a guide, for the assistant's answer to a question (docs/specs/help-agent-assistant.md section 9). It re-checks
 * what the person may see on the server (a hidden guide answers like a missing one), validates the argument first, and never throws
 * for input a client could send.
 */
export async function getGuideSteps(id: string): Promise<string[] | null> {
  if (typeof id !== 'string' || !DOC_ID.test(id)) return null;
  const view = await getVisibleHelp();
  const doc = view?.docs.find((d) => d.id === id);
  if (!doc) return null;
  return guideSteps(localized(doc, await getLocale()).blocks);
}
