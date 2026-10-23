import type { RemoteTemplate } from '../../infra/providers/whatsapp-cloud-api-waba/waba-template.port';
import type { TemplateButton, TemplateCard } from './template-payload';
import type { TemplatePatch } from './templates.repository';
import { slotsFor, tokensOf, type VariableMap, type VariableSlot } from './template-variables';

/**
 * Meta's copy of a template, turned into our columns and back (TW-TPL-026, 027, 028). Pure: the sync, the refresh and the
 * sweeper all call these, so they cannot disagree about what a Meta state means locally.
 */

const DAY_MS = 86_400_000;
const MEDIA_FORMATS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']);

export type RemoteAttachment = 'none' | 'image' | 'video' | 'document' | 'location';

export interface ParsedComponents {
  header: string | null;
  attachmentType: RemoteAttachment;
  /** Meta's own sample of the header media (its CDN URL), when it sent one. */
  headerSampleUrl: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  codeExpirationMinutes: number | null;
  /** `standard`, `media`, `auth`, `carousel`; a shape we only display (`limited_time_offer`) keeps its own name. */
  templateType: string;
  /** A carousel's cards (Meta's example file as the sample address); empty for every other type. */
  cards: TemplateCard[];
  /** A limited-time offer's heading and countdown; null for every other type. */
  limitedOffer: { text: string; hasExpiration: boolean } | null;
  variableMap: VariableMap;
}

type Component = Record<string, unknown>;
const asComponents = (c: unknown[]): Component[] =>
  c.filter((x): x is Component => typeof x === 'object' && x !== null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function examplesOf(component: Component | undefined, key: 'body_text' | 'header_text'): string[] {
  const ex = component?.example as Record<string, unknown> | undefined;
  const raw = ex?.[key];
  const first = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
  return Array.isArray(first) ? first.filter((x): x is string => typeof x === 'string') : [];
}

function slotsWithExamples(text: string, examples: string[]): VariableSlot[] {
  return slotsFor(tokensOf(text)).map((s) => {
    const example = examples[s.num - 1];
    return example ? { ...s, example } : s;
  });
}

/** The heading and countdown of Meta's LIMITED_TIME_OFFER component. */
function offerOf(c: Component | undefined): { text: string; hasExpiration: boolean } | null {
  const o = c?.limited_time_offer as Record<string, unknown> | undefined;
  return typeof o?.text === 'string'
    ? { text: o.text, hasExpiration: o.has_expiration !== false }
    : null;
}

/** The cards of Meta's CAROUSEL component, as we store them (the picture is Meta's sample until the author uploads their own). */
function cardsOfCarousel(carousel: Component | undefined): TemplateCard[] {
  const cards = Array.isArray(carousel?.cards) ? (carousel!.cards as unknown[]) : [];
  return cards.map((card) => {
    const comps = asComponents(
      Array.isArray((card as { components?: unknown })?.components)
        ? ((card as { components: unknown[] }).components as unknown[])
        : [],
    );
    const header = comps.find((c) => String(c.type).toUpperCase() === 'HEADER');
    const body = comps.find((c) => String(c.type).toUpperCase() === 'BODY');
    const buttons = comps.find((c) => String(c.type).toUpperCase() === 'BUTTONS');
    const handles = (header?.example as { header_handle?: unknown } | undefined)?.header_handle;
    const sample = Array.isArray(handles) ? str(handles[0]) : null;
    return {
      format: String(header?.format ?? 'IMAGE').toUpperCase() === 'VIDEO' ? 'video' : 'image',
      image: sample,
      headerHandle: null,
      headerSampleUrl: sample,
      body: str(body?.text) ?? '',
      buttons: Array.isArray(buttons?.buttons)
        ? (buttons.buttons as Component[]).map((b) => ({ ...b, type: String(b.type) }))
        : [],
    };
  });
}

/**
 * A fresh sync keeps what the author uploaded: the cards Meta lists are matched by position and, when the text is the same, keep
 * their stored file and handle (Meta only ever gives back its own sample address).
 */
export function mergeCards(fresh: TemplateCard[], stored: TemplateCard[]): TemplateCard[] {
  return fresh.map((c, i) => {
    const old = stored[i];
    return old && old.body === c.body && old.image
      ? { ...c, image: old.image, headerHandle: old.headerHandle ?? null }
      : c;
  });
}

/** The inverse of `buildMetaTemplate`: Meta's components to the columns we store. */
export function parseRemoteComponents(
  components: unknown[],
  category: string | null,
): ParsedComponents {
  const list = asComponents(components);
  const find = (type: string) => list.find((c) => String(c.type).toUpperCase() === type);
  const header = find('HEADER');
  const body = find('BODY');
  const footer = find('FOOTER');
  const buttons = find('BUTTONS');

  const format = String(header?.format ?? '').toUpperCase();
  const media = MEDIA_FORMATS.has(format);
  const handles = (header?.example as { header_handle?: unknown } | undefined)?.header_handle;
  const sample = Array.isArray(handles) ? str(handles[0]) : null;

  const bodyText = str(body?.text) ?? '';
  const headerText = media ? null : str(header?.text);
  const isAuth =
    (category ?? '').toUpperCase() === 'AUTHENTICATION' ||
    body?.add_security_recommendation !== undefined;

  const special = list.find((c) => ['CAROUSEL', 'LIMITED_TIME_OFFER'].includes(String(c.type)));
  let templateType = 'standard';
  if (isAuth) templateType = 'auth';
  else if (special) templateType = special.type === 'LIMITED_TIME_OFFER' ? 'lto' : 'carousel';
  else if (media) templateType = 'media';

  const map: VariableMap = {};
  if (headerText && tokensOf(headerText).length)
    map.header = slotsWithExamples(headerText, examplesOf(header, 'header_text'));
  if (bodyText && tokensOf(bodyText).length)
    map.body = slotsWithExamples(bodyText, examplesOf(body, 'body_text'));

  const codeExp = footer?.code_expiration_minutes;
  return {
    header: headerText,
    attachmentType: media ? (format.toLowerCase() as RemoteAttachment) : 'none',
    headerSampleUrl: sample,
    body: bodyText,
    footer: str(footer?.text),
    buttons: Array.isArray(buttons?.buttons)
      ? (buttons.buttons as Component[]).map((b) => ({ ...b, type: String(b.type) }))
      : [],
    codeExpirationMinutes: typeof codeExp === 'number' ? codeExp : null,
    templateType,
    cards: templateType === 'carousel' ? cardsOfCarousel(special) : [],
    limitedOffer: templateType === 'lto' ? offerOf(special) : null,
    variableMap: map,
  };
}

/**
 * The fresh structure decides which slots exist, but an attribute the operator already mapped (a non-numeric key) survives, so
 * a sync never wipes a mapping (TW-TPL-028 rule 7). A numeric key is only the unmapped default.
 */
export function mergeVariableMap(
  fresh: VariableMap,
  stored: VariableMap | null | undefined,
): VariableMap {
  const out: VariableMap = {};
  for (const field of ['header', 'body'] as const) {
    const slots = fresh[field];
    if (!slots) continue;
    out[field] = slots.map((s) => {
      const kept = stored?.[field]?.find((x) => x.num === s.num);
      const key = kept && !/^\d+$/.test(kept.key) ? kept.key : s.key;
      const example = s.example ?? kept?.example;
      return { num: s.num, key, ...(example ? { example } : {}) };
    });
  }
  return out;
}

/** What the row looks like before Meta's state is applied. */
export interface CurrentState {
  status: string;
  metaCategory: string | null;
  qualityScore: string | null;
  approvedAt: Date | null;
  pausedUntil: Date | null;
}

export interface StatePatch {
  metaStatus: string;
  /** `null` when Meta reports a state we do not know: the local status is left as it was. */
  status: string | null;
  metaCategory: string | null;
  qualityScore: string;
  rejectionReasonCode: string | null;
  approvedAt?: Date;
  pausedUntil?: Date;
  /** True once Meta approved it, so the text of an earlier refusal no longer applies. */
  clearRejectionText: boolean;
  lastSyncedAt: Date;
}

/** `localStatusFor` of the WABA module, passed in so this file stays free of cross-module imports. */
export type StatusMapper = (metaStatus: string) => string | null;

/**
 * Meta's reading of one template applied to a row (the refresh, the sweeper and the sync use this one function).
 * A RED quality pauses a non-authentication template for a day, a PAUSED state does the same (TW-TPL-030).
 */
export function statePatchFrom(
  remote: Pick<
    RemoteTemplate,
    'status' | 'category' | 'qualityScore' | 'rejectedReason' | 'correctCategory'
  >,
  current: CurrentState,
  now: Date,
  mapStatus: StatusMapper,
): StatePatch {
  const metaStatus = remote.status.toUpperCase();
  const category =
    (remote.category ?? remote.correctCategory ?? current.metaCategory ?? null)
      ?.toString()
      .toUpperCase() ?? null;
  const reported = remote.qualityScore?.toUpperCase() ?? null;
  // UNKNOWN never overwrites a known score (TW-TPL-029 rule 5).
  const qualityScore =
    reported && reported !== 'UNKNOWN' ? reported : (current.qualityScore ?? 'UNKNOWN');
  const patch: StatePatch = {
    metaStatus,
    status: mapStatus(metaStatus),
    metaCategory: category,
    qualityScore,
    rejectionReasonCode:
      metaStatus === 'REJECTED' ? remote.rejectedReason?.toUpperCase() || 'NONE' : null,
    clearRejectionText: metaStatus === 'APPROVED',
    lastSyncedAt: now,
  };
  if (metaStatus === 'APPROVED' && !current.approvedAt) patch.approvedAt = now;
  const stillPaused = current.pausedUntil !== null && current.pausedUntil.getTime() > now.getTime();
  const dayAhead = new Date(now.getTime() + DAY_MS);
  if (!stillPaused) {
    if (metaStatus === 'PAUSED') patch.pausedUntil = dayAhead;
    else if (qualityScore === 'RED' && category !== 'AUTHENTICATION') patch.pausedUntil = dayAhead;
  }
  return patch;
}

/** Meta lists a language by the region it resolved: `en` matches `en_US` and the other way round. */
export function sameLanguage(a: string, b: string): boolean {
  const x = a.toLowerCase().replace('-', '_');
  const y = b.toLowerCase().replace('-', '_');
  return x === y || x.split('_')[0] === y.split('_')[0];
}

/** The columns a state patch writes. A status Meta reported that we do not know is not written. */
export function columnsOfState(p: StatePatch): TemplatePatch {
  return {
    metaStatus: p.metaStatus,
    ...(p.status ? { status: p.status } : {}),
    ...(p.metaCategory ? { metaCategory: p.metaCategory } : {}),
    qualityScore: p.qualityScore,
    rejectionReasonCode: p.rejectionReasonCode,
    ...(p.clearRejectionText ? { rejectionReason: null } : {}),
    ...(p.approvedAt ? { approvedAt: p.approvedAt } : {}),
    ...(p.pausedUntil ? { pausedUntil: p.pausedUntil } : {}),
    lastSyncedAt: p.lastSyncedAt,
  };
}
