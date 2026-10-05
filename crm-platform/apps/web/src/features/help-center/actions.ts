'use server';

import { getLocale } from 'next-intl/server';
import { leadParagraph } from './blocks';
import { localized } from './resolve';
import { getVisibleHelp } from './server';

const DOC_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ANCHOR = /^[a-z0-9-]{1,80}$/;

/**
 * The text a section-level tip shows: the first paragraph under a heading of a guide. It re-checks what the person may see on the
 * server (a hidden guide answers null like a missing one), validates both arguments before any lookup, and never throws for
 * input a client could send.
 */
export async function getHelpTip(doc: string, anchor: string): Promise<string | null> {
  if (typeof doc !== 'string' || typeof anchor !== 'string') return null;
  if (!DOC_ID.test(doc) || !ANCHOR.test(anchor)) return null;
  const view = await getVisibleHelp();
  const found = view?.docs.find((d) => d.id === doc);
  if (!found) return null;
  return leadParagraph(localized(found, await getLocale()).blocks, anchor);
}
