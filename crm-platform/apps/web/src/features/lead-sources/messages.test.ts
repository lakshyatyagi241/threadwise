import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEAD_EVENT_STATUSES,
  LEAD_OWNER_MODES,
  LEAD_REASONS,
  LEAD_SOURCE_KINDS,
  LEAD_SOURCE_STATUSES,
} from '@crm/contracts';
import { ATTRIBUTION_FIELDS, MAPPING_FIELDS, WIZARD_STEPS } from './lib/draft';
import { LEAD_DETAIL_CODES, LEAD_ERROR_KEYS } from './lib/errors';
import { EVENT_FILTERS, GUIDANCE_KEYS, TEST_FILTERS } from './lib/event-view';
import { PREVIEW_REASON_CODES } from './lib/preview-view';
import { COMING_SOON_PROVIDERS, TABS } from './lib/source-view';

/**
 * next-intl prints the key path when a message is missing, so every key a component asks for must exist, in English and in
 * Arabic, with the same placeholders. The keys the code builds by name are listed here from the code's own enums.
 */
type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const ROOT = 'lead-sources';
const load = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, `${ROOT}.json`), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const en = flatten(load('en'));
const ar = flatten(load('ar'));

/** `{name}` and `{count, plural, ...}` placeholders, by variable name. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe('lead sources messages', () => {
  it('every message is non-empty and no key holds a dot (next-intl reads it as nesting)', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe('');
    const dotted: string[] = [];
    const walk = (t: Tree) => {
      for (const [k, v] of Object.entries(t)) {
        if (k.includes('.')) dotted.push(k);
        if (typeof v !== 'string') walk(v);
      }
    };
    walk(load('en'));
    walk(load('ar'));
    expect(dotted).toEqual([]);
  });

  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('Arabic keeps the same placeholders as English', () => {
    for (const k of Object.keys(en)) expect(placeholders(ar[k]!), k).toEqual(placeholders(en[k]!));
  });

  it('never writes a literal brace pair that ICU would read as an argument (the deal title tokens are passed as a value)', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/\{\{/);
    for (const [k, v] of Object.entries(ar)) expect(v, k).not.toMatch(/\{\{/);
  });

  it('Arabic is Arabic: every message has Arabic letters unless it is only placeholders or a code', () => {
    for (const [k, v] of Object.entries(ar)) {
      // A message that is only values (`{message}`, `{id} ({status})`) has no words to translate; every other one must be Arabic.
      if (!/[A-Za-z؀-ۿ]/.test(v.replace(/\{\w+\}/g, ''))) continue;
      expect(v, k).toMatch(/[؀-ۿ]/);
    }
  });

  it('describes every value of every contract enum the screens show by name', () => {
    const wanted: string[] = [
      ...LEAD_SOURCE_KINDS.map((v) => `kinds.${v}`),
      ...LEAD_SOURCE_STATUSES.map((v) => `sourceStatus.${v}`),
      ...LEAD_EVENT_STATUSES.map((v) => `eventStatus.${v}`),
      ...LEAD_REASONS.map((v) => `reasons.${v}`),
      ...LEAD_OWNER_MODES.map((v) => `form.ownerModes.${v}`),
      ...EVENT_FILTERS.map((v) => `eventFilters.${v}`),
      ...TEST_FILTERS.map((v) => `testFilters.${v}`),
      ...GUIDANCE_KEYS.map((v) => `guidance.${v}`),
      ...WIZARD_STEPS.flatMap((s) => [
        `wizard.steps.${s}`,
        `wizard.stepTitle.${s}`,
        `wizard.stepHelp.${s}`,
      ]),
      ...TABS.map((v) => `page.tabs.${v}`),
      ...COMING_SOON_PROVIDERS.flatMap((p) => [
        `ads.providers.${p}.name`,
        `ads.providers.${p}.body`,
      ]),
      ...MAPPING_FIELDS.flatMap((f) => [
        `mapping.fields.${f}`,
        `mapping.defaults.${f}`,
        `preview.contact.${f}`,
      ]),
      ...ATTRIBUTION_FIELDS.flatMap((f) => [
        `mapping.attributionFields.${f}`,
        `mapping.attributionDefaults.${f}`,
        `preview.attribution.${f}`,
      ]),
      ...PREVIEW_REASON_CODES.map((c) => `preview.reasons.${c}`),
      ...LEAD_ERROR_KEYS.map((k) => `errors.${k}`),
      ...LEAD_DETAIL_CODES.map((c) => `errors.details.${c}`),
    ].map((k) => `${ROOT}.${k}`);
    for (const k of wanted) {
      expect(en[k], `en ${k}`).toBeTypeOf('string');
      expect(ar[k], `ar ${k}`).toBeTypeOf('string');
    }
  });

  it('has the keys the code builds from its own result codes', () => {
    const wanted = [
      // lib/draft problems
      ...[
        'nameRequired',
        'nameLength',
        'platformLength',
        'secretLength',
        'pathLength',
        'pathCharacters',
        'retentionRange',
        'countryCode',
        'textLength',
        'ownerFixed',
        'ownerRoundRobin',
        'ownerTooMany',
        'notifyTooMany',
        'dealTitleLength',
        'propertyRequired',
        'propertyKey',
        'propertyDuplicate',
        'pathRequired',
        'customFieldsTooMany',
        'contract',
      ].map((c) => `problems.${c}`),
      // lib/payload parse failures
      ...['empty', 'invalidJson', 'notObject', 'tooLarge'].flatMap((c) => [
        `preview.pasteProblems.${c}`,
        `test.payloadProblems.${c}`,
      ]),
      // the secret states
      ...['isSet', 'notSet', 'willRemove', 'willReplace', 'willSet'].map((c) => `form.secret.${c}`),
      // the attribution card's labelled values
      ...['campaign', 'adset', 'ad', 'form'].map((c) => `attribution.fields.${c}`),
      // the events table
      ...['status', 'lead', 'result', 'links', 'received', 'actions'].map((c) => `events.col.${c}`),
      // the sources table
      ...['name', 'kind', 'status', 'token', 'lastEvent', 'attention'].map(
        (c) => `sources.col.${c}`,
      ),
      // confirmations
      ...['pause', 'rotate', 'delete'].flatMap((c) => [
        `detail.confirm.${c}.title`,
        `detail.confirm.${c}.body`,
        `detail.confirm.${c}.action`,
      ]),
    ].map((k) => `${ROOT}.${k}`);
    for (const k of wanted) {
      expect(en[k], `en ${k}`).toBeTypeOf('string');
      expect(ar[k], `ar ${k}`).toBeTypeOf('string');
    }
  });

  it('every literal t("...") key a component asks for exists in both languages', () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      // A name can be bound more than once in a file (one `t` per component), so a key counts when ANY binding of the name has it.
      const bindings = new Map<string, string[]>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)) {
        bindings.set(m[1]!, [...(bindings.get(m[1]!) ?? []), m[2]!]);
      }
      for (const [name, bases] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
          const ok = bases.some(
            (b) => en[`${b}.${m[1]}`] !== undefined && ar[`${b}.${m[1]}`] !== undefined,
          );
          if (!ok)
            missing.push(
              `${file.split('features')[1]}: ${name}('${m[1]}') in ${bases.join(' | ')}`,
            );
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the sources of this feature are all scanned (a rename must not silently empty the check)', () => {
    expect(sources(join(__dirname, 'components')).length).toBeGreaterThanOrEqual(12);
  });
});
