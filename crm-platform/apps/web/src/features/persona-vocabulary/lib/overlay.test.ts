import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_VOCAB_NOUNS } from '@crm/contracts';
import { LOCALES } from '@/i18n/locales';
import { loadMessages } from '@/i18n/messages';
import { BOUND_PREFIXES, BOUND_SURFACES } from './bindings';
import { argumentNames } from './localize';
import { buildOverlay, mergeOverlay, readDefaults, withVocabulary, type Tree } from './overlay';

const messages = new Map<string, Tree>();
const of = (locale: string): Tree => {
  let m = messages.get(locale);
  if (!m) {
    m = loadMessages(locale) as Tree;
    messages.set(locale, m);
  }
  return m;
};

function* leaves(node: string | Tree, path: string[] = []): Generator<[string, string]> {
  if (typeof node === 'string') yield [path.join('.'), node];
  else for (const [k, v] of Object.entries(node)) yield* leaves(v, [...path, k]);
}
const at = (tree: Tree, dotted: string): string | Tree | undefined =>
  dotted
    .split('.')
    .reduce<string | Tree | undefined>(
      (cur, part) => (typeof cur === 'object' ? cur[part] : undefined),
      tree,
    );
const flat = (tree: Tree) => Object.fromEntries(leaves(tree));

describe('the bindings registry', () => {
  it('names only real message prefixes of the English messages', () => {
    for (const prefix of BOUND_PREFIXES) {
      expect(at(of('en'), prefix), prefix).toBeDefined();
    }
  });

  it('has no duplicate prefix and no prefix inside another', () => {
    const all = [...BOUND_PREFIXES];
    expect(new Set(all).size).toBe(all.length);
    for (const a of all) {
      for (const b of all) {
        if (a !== b) expect(b.startsWith(`${a}.`), `${b} is inside ${a}`).toBe(false);
      }
    }
  });

  it('covers contacts, appointments and deals', () => {
    expect(BOUND_SURFACES.map((s) => s.id)).toEqual([
      'contacts-menu',
      'contacts-list',
      'contact-record',
      'appointments',
      'deals',
    ]);
  });
});

describe('the product words of each language (persona-vocabulary.defaults)', () => {
  // Each default word must be the word the product really uses in that language. Plural: the menu/title entries. Singular: a button or a
  // column head. A drifting translation fails here instead of silently never matching.
  const PLURAL: Record<string, string> = {
    contact: 'contacts-attributes-tags.nav.contacts',
    appointment: 'appointments.nav.appointments',
    deal: 'deals-pipelines.nav.deals',
    meeting: 'contacts-attributes-tags.contact.record.nav.section.meetings',
  };
  const SINGULAR: Record<string, string> = {
    contact: 'contacts-attributes-tags.list.addContactShort',
    appointment: 'appointments.toast.cancelled',
    deal: 'deals-pipelines.list.columns.title',
    meeting: 'contacts-attributes-tags.contact.record.compose.tab.meeting',
  };

  it.each([...LOCALES])('%s: every noun has both forms and the product uses them', (locale) => {
    const m = of(locale);
    const defaults = readDefaults(m);
    expect(defaults, locale).not.toBeNull();
    for (const noun of WORKSPACE_VOCAB_NOUNS) {
      const plural = at(m, PLURAL[noun]!);
      const singular = at(m, SINGULAR[noun]!);
      expect(typeof plural, `${locale} ${PLURAL[noun]}`).toBe('string');
      expect((plural as string).toLocaleLowerCase(locale)).toContain(
        defaults![noun].other.toLocaleLowerCase(locale),
      );
      expect((singular as string).toLocaleLowerCase(locale)).toContain(
        defaults![noun].one.toLocaleLowerCase(locale),
      );
    }
  });
});

describe('the golden rule: no words, no change', () => {
  it.each([...LOCALES])('%s: returns the very same messages object', (locale) => {
    const m = of(locale);
    for (const nouns of [
      undefined,
      null,
      {},
      'x',
      7,
      { contact: 'x' },
      { contact: { one: 'A' } },
    ]) {
      expect(withVocabulary(m, locale, nouns)).toBe(m);
    }
    // an unsafe word is ignored, not inserted
    expect(withVocabulary(m, locale, { contact: { one: '{x}', other: '<b>Patients</b>' } })).toBe(
      m,
    );
  });

  it.each([...LOCALES])(
    '%s: naming a noun with the product’s own words changes not one string',
    (locale) => {
      const m = of(locale);
      const defaults = readDefaults(m)!;
      expect(buildOverlay(m, locale, defaults)).toBeNull();
      expect(withVocabulary(m, locale, defaults)).toBe(m);
    },
  );

  it('words for another language leave this one alone', () => {
    const m = of('de');
    expect(withVocabulary(m, 'de', undefined)).toBe(m);
  });
});

describe('English: the surfaces say the workspace’s words', () => {
  const nouns = {
    contact: { one: 'Patient', other: 'Patients' },
    appointment: { one: 'Visit', other: 'Visits' },
  };
  const en = of('en');
  const out = withVocabulary(en, 'en', nouns);
  const get = (key: string) => at(out, key);

  it('the menu entry, the page title, the add button, the search placeholder, the empty state', () => {
    expect(get('contacts-attributes-tags.nav.contacts')).toBe('Patients');
    expect(get('contacts-attributes-tags.list.title')).toBe('Patient Hub');
    expect(get('contacts-attributes-tags.list.addContactShort')).toBe('Add Patient');
    expect(get('contacts-attributes-tags.list.addContact')).toBe('Create Patients');
    expect(get('contacts-attributes-tags.list.searchContacts')).toBe('Search patients...');
    expect(get('contacts-attributes-tags.list.emptyTitle')).toBe('No patients yet');
    expect(get('contacts-attributes-tags.list.empty')).toBe(
      'Add your first patient, or import a CSV file to get started.',
    );
    expect(get('contacts-attributes-tags.list.colContactName')).toBe('Patient Name');
  });

  it('bulk actions keep their counts and the plural rule', () => {
    expect(get('contacts-attributes-tags.bulk.deleted')).toBe(
      '{count, plural, one {Deleted # patient.} other {Deleted # patients.}}',
    );
    expect(get('contacts-attributes-tags.bulk.deleteTitle')).toBe('Delete selected patients?');
    expect(get('contacts-attributes-tags.list.banner.allSelected')).toBe(
      'All {total} patients matching this filter are selected.',
    );
  });

  it('quick view and the record page', () => {
    expect(get('contacts-attributes-tags.contact.quick.title')).toBe('Patient quick view');
    expect(get('contacts-attributes-tags.contact.actions.edit')).toBe('Edit patient');
    expect(get('contacts-attributes-tags.detail.notFoundTitle')).toBe('Patient not found');
    expect(get('contacts-attributes-tags.contact.nav.section.details')).toBe('Patient details');
  });

  it('appointments wording', () => {
    expect(get('appointments.nav.appointments')).toBe('Visits');
    expect(get('shell.nav.appointments')).toBe('Visits');
    expect(get('appointments.hub.appointments')).toBe('Visits');
    expect(get('appointments.toast.cancelled')).toBe('Visit cancelled.');
    expect(get('contacts-attributes-tags.contact.record.nav.section.appointments')).toBe('Visits');
  });

  it('what is not named or not bound stays the product’s word', () => {
    // deal and meeting were not named
    expect(get('deals-pipelines.nav.deals')).toBe('Deals');
    expect(get('contacts-attributes-tags.contact.record.nav.section.meetings')).toBe('Meetings');
    // a screen that is not a bound surface
    expect(get('contacts-attributes-tags.stages.title')).toBe('Contact stages');
    expect(get('contacts-attributes-tags.import.title')).toBe(
      at(en, 'contacts-attributes-tags.import.title'),
    );
    // ...and the strings outside the bound surfaces are the same objects (structural sharing)
    expect(out['segments']).toBe(en['segments']);
  });

  it('never touches the other nouns on the way: a meeting stays a meeting', () => {
    expect(get('contacts-attributes-tags.list.addMeeting')).toBe('Schedule meeting');
  });
});

describe('every language: the rewrite keeps every message valid', () => {
  // A deliberately awkward set of words: multiple words, an acronym, a non-Latin script and an apostrophe.
  const WORDS = [
    { contact: { one: 'Real Estate Client', other: 'Real Estate Clients' } },
    { contact: { one: 'VIP', other: 'VIPs' }, appointment: { one: 'Visit', other: 'Visits' } },
    { deal: { one: 'Admission', other: 'Admissions' }, meeting: { one: 'Call', other: 'Calls' } },
    { contact: { one: 'Patient d’accueil', other: 'Patients d’accueil' } },
    { appointment: { one: "Client d'or", other: "Clients d'or" } },
  ];

  it.each([...LOCALES])(
    '%s: same arguments, same tags, and the messages still compile',
    (locale) => {
      const m = of(locale);
      const before = flat(m);
      for (const nouns of WORDS) {
        const overlay = buildOverlay(m, locale, nouns as never);
        if (!overlay) continue;
        const merged = mergeOverlay(m, overlay);
        const after = flat(merged);
        const errors: string[] = [];
        const t = createTranslator({
          locale,
          messages: merged,
          onError: (e) => errors.push(e.message),
        });
        for (const [key, text] of Object.entries(flat(overlay))) {
          expect(argumentNames(text), `${locale} ${key}`).toEqual(argumentNames(before[key]!));
          expect(after[key]).toBe(text);
          // Format it with a value for every argument and a function for every tag: a broken ICU string would report an error.
          const values: Record<string, unknown> = {};
          for (const name of argumentNames(text)) {
            values[name.replace(/^<|>$/g, '')] = name.startsWith('<') ? (c: unknown) => c : 3;
          }
          (t as unknown as (k: string, v: unknown) => unknown)(key, values);
        }
        expect(errors, `${locale}: ${errors[0]}`).toEqual([]);
      }
    },
  );
});

describe('mergeOverlay', () => {
  it('copies only the branches it touches', () => {
    const base: Tree = { a: { b: { c: 'x', d: 'y' }, e: 'z' }, f: { g: 'h' } };
    const merged = mergeOverlay(base, { a: { b: { c: 'X' } } });
    expect(merged).toEqual({ a: { b: { c: 'X', d: 'y' }, e: 'z' }, f: { g: 'h' } });
    expect(merged['f']).toBe(base['f']);
    expect((merged['a'] as Tree)['e']).toBe('z');
    expect(base).toEqual({ a: { b: { c: 'x', d: 'y' }, e: 'z' }, f: { g: 'h' } });
  });
});
