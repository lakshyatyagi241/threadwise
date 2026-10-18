import { describe, expect, it } from 'vitest';
import { GENERIC_PERSONA_DEFINITION, type PersonaDefinition } from './definition';
import type { Visibility } from './module-ids';
import { parseOperatorOverrides, parseWorkspaceOverrides } from './overrides';
import {
  explainModule,
  hiddenModuleIds,
  isModuleHidden,
  resolveNouns,
  resolvePersona,
  type ResolveInput,
} from './resolve';

const ID = 'nav:deals';
const OTHER = 'nav:inbox';

const persona = (personaSays: Visibility, fallback: Visibility = 'show'): PersonaDefinition => ({
  ...GENERIC_PERSONA_DEFINITION,
  modules: { default: fallback, ids: { [ID]: personaSays } },
});
const op = (state: Visibility | null, locked = false) =>
  parseOperatorOverrides(
    state ? { v: 1, modules: { [ID]: { state, locked, reason: 'agreed with the owner' } } } : {},
  );
const ws = (state: Visibility | null) =>
  parseWorkspaceOverrides(state ? { v: 1, modules: { [ID]: { state } } } : {});

/** An independent statement of the rules in spec section 6.1, written as an ordered list of candidate answers. */
function oracle(
  p: Visibility,
  o: Visibility | null,
  locked: boolean,
  w: Visibility | null,
  showAll: boolean,
): boolean {
  if (o && locked) return o === 'show';
  if (w) return w === 'show';
  const below = o ?? p;
  return showAll ? true : below === 'show';
}

describe('resolvePersona: precedence matrix', () => {
  const states: Array<Visibility | null> = [null, 'show', 'hide'];
  const personas: Visibility[] = ['show', 'hide'];

  for (const p of personas) {
    for (const o of states) {
      for (const locked of [false, true]) {
        if (locked && o === null) continue;
        for (const w of states) {
          for (const showAll of [false, true]) {
            const name = `persona ${p}, operator ${o ?? 'silent'}${locked ? ' locked' : ''}, workspace ${w ?? 'silent'}, showAll ${showAll}`;
            it(name, () => {
              const input: ResolveInput = {
                definition: persona(p),
                operator: op(o, locked),
                workspace: ws(w),
                showAll,
              };
              const expected = oracle(p, o, locked, w, showAll);
              expect(explainModule(ID, input).visible).toBe(expected);
              // the compact form agrees for the id and for an id nobody named
              const view = resolvePersona(input);
              expect(isModuleHidden(view, ID)).toBe(!expected);
              expect(isModuleHidden(view, OTHER)).toBe(false);
            });
          }
        }
      }
    }
  }
});

describe('resolvePersona: the rules', () => {
  it('silence falls through: no overrides means the persona decides', () => {
    expect(isModuleHidden(resolvePersona({ definition: persona('hide') }), ID)).toBe(true);
    expect(isModuleHidden(resolvePersona({ definition: persona('show') }), ID)).toBe(false);
  });

  it('an allow-list persona hides what it does not name, a deny-list persona shows it', () => {
    const allow = resolvePersona({ definition: persona('show', 'hide') });
    expect(isModuleHidden(allow, ID)).toBe(false);
    expect(isModuleHidden(allow, OTHER)).toBe(true);
    const deny = resolvePersona({ definition: persona('hide', 'show') });
    expect(isModuleHidden(deny, ID)).toBe(true);
    expect(isModuleHidden(deny, OTHER)).toBe(false);
  });

  it('the workspace beats an operator default that is not locked', () => {
    const input = { definition: persona('hide'), operator: op('hide'), workspace: ws('show') };
    expect(explainModule(ID, input)).toMatchObject({ visible: true, source: 'workspace' });
  });

  it('a locked operator override beats the workspace and reports the ignored value', () => {
    const input = {
      definition: persona('show'),
      operator: op('hide', true),
      workspace: ws('show'),
    };
    expect(explainModule(ID, input)).toMatchObject({
      visible: false,
      source: 'operator',
      operatorLocked: true,
      workspaceIgnored: true,
    });
    expect(resolvePersona(input).modules[ID]).toEqual({ visible: false, locked: true });
  });

  it('unlocking restores the workspace value, which was kept all along', () => {
    const workspace = ws('show');
    const locked = explainModule(ID, {
      definition: persona('show'),
      operator: op('hide', true),
      workspace,
    });
    const unlocked = explainModule(ID, {
      definition: persona('show'),
      operator: op('hide', false),
      workspace,
    });
    expect(locked.visible).toBe(false);
    expect(unlocked.visible).toBe(true);
  });

  it('Show more modules reveals what the persona hides', () => {
    const input = { definition: persona('hide', 'hide'), showAll: true };
    expect(explainModule(ID, input)).toMatchObject({ visible: true, source: 'show_all' });
    const view = resolvePersona(input);
    expect(view.defaultVisibility).toBe('show');
    expect(isModuleHidden(view, ID)).toBe(false);
    expect(isModuleHidden(view, OTHER)).toBe(false);
  });

  it('Show more modules does not reveal an item the operator locked hidden', () => {
    const view = resolvePersona({
      definition: persona('hide', 'hide'),
      operator: op('hide', true),
      showAll: true,
    });
    expect(isModuleHidden(view, ID)).toBe(true);
    expect(isModuleHidden(view, OTHER)).toBe(false);
  });

  it('a workspace hide still wins over Show more modules', () => {
    const view = resolvePersona({
      definition: persona('show'),
      workspace: ws('hide'),
      showAll: true,
    });
    expect(isModuleHidden(view, ID)).toBe(true);
  });

  it('keeps the view small: only the ids that differ from the default, plus locked ones', () => {
    const view = resolvePersona({
      definition: {
        ...GENERIC_PERSONA_DEFINITION,
        modules: { default: 'show', ids: { 'nav:a': 'show', 'nav:b': 'hide' } },
      },
      operator: parseOperatorOverrides({
        v: 1,
        modules: { 'nav:c': { state: 'show', locked: true, reason: 'agreed with owner' } },
      }),
    });
    expect(view.modules).toEqual({
      'nav:b': { visible: false, locked: false },
      'nav:c': { visible: true, locked: true },
    });
  });

  it('ignores ids the catalog does not have, lists them, and never throws', () => {
    const definition: PersonaDefinition = {
      ...GENERIC_PERSONA_DEFINITION,
      modules: { default: 'show', ids: { 'nav:gone': 'hide', [ID]: 'hide' } },
    };
    const view = resolvePersona({ definition }, new Set([ID, OTHER]));
    expect(view.unknownIds).toEqual(['nav:gone']);
    expect(view.modules).toEqual({ [ID]: { visible: false, locked: false } });
  });

  it('an unknown or missing view hides nothing', () => {
    expect(isModuleHidden(null, ID)).toBe(false);
    expect(isModuleHidden(undefined, ID)).toBe(false);
    expect(hiddenModuleIds(null, [ID, OTHER]).size).toBe(0);
  });

  it('is pure: the same input gives the same output and the input is untouched', () => {
    const input: ResolveInput = {
      definition: persona('hide'),
      operator: op('show'),
      workspace: ws('hide'),
      showAll: true,
    };
    const snapshot = JSON.stringify(input);
    expect(resolvePersona(input)).toEqual(resolvePersona(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('the generic persona changes nothing', () => {
  it('hides no id, with or without overrides rows or the switch', () => {
    const catalog = [
      'nav:inbox',
      'nav:deals',
      'tile:channels',
      'section:contact.meetings',
      'card:dashboard.inbox',
      'action:contact.meeting',
    ];
    for (const showAll of [false, true]) {
      const view = resolvePersona({
        definition: GENERIC_PERSONA_DEFINITION,
        operator: parseOperatorOverrides({}),
        workspace: parseWorkspaceOverrides({}),
        showAll,
      });
      expect(view).toEqual({ defaultVisibility: 'show', modules: {}, unknownIds: [] });
      expect(hiddenModuleIds(view, catalog).size).toBe(0);
    }
  });
});

describe('resolveNouns: words', () => {
  const clinic: PersonaDefinition = {
    ...GENERIC_PERSONA_DEFINITION,
    vocabulary: {
      nouns: {
        contact: {
          en: { one: 'Patient', other: 'Patients' },
          hi: { one: 'Mareez', other: 'Mareez' },
        },
        appointment: { en: { one: 'Visit', other: 'Visits' } },
      },
      phrases: {},
    },
  };
  const wsWords = parseWorkspaceOverrides({
    v: 1,
    vocab: { contact: { en: { one: 'Client', other: 'Clients' } } },
  });
  const opWords = parseOperatorOverrides({
    v: 1,
    vocab: {
      contact: { en: { one: 'Member', other: 'Members' } },
      deal: { en: { one: 'Case', other: 'Cases' } },
    },
  });

  it('workspace beats operator beats persona beats default, per noun', () => {
    const words = resolveNouns({ definition: clinic, operator: opWords, workspace: wsWords }, 'en');
    expect(words.contact).toEqual({ one: 'Client', other: 'Clients' });
    expect(words.deal).toEqual({ one: 'Case', other: 'Cases' });
    expect(words.appointment).toEqual({ one: 'Visit', other: 'Visits' });
    expect(words.meeting).toBeUndefined();
  });

  it('a persona locale that is missing one of its nouns contributes nothing, as a whole', () => {
    // hi has `contact` but not `appointment`: the persona layer is dropped in hi, so no half-renamed screen
    expect(resolveNouns({ definition: clinic }, 'hi')).toEqual({});
  });

  it('operator and workspace words still apply in a locale where the persona is incomplete', () => {
    const words = resolveNouns(
      {
        definition: clinic,
        workspace: parseWorkspaceOverrides({
          v: 1,
          vocab: { contact: { hi: { one: 'Grahak', other: 'Grahak' } } },
        }),
      },
      'hi',
    );
    expect(words).toEqual({ contact: { one: 'Grahak', other: 'Grahak' } });
  });

  it('a locale nobody wrote words for keeps the default wording', () => {
    expect(
      resolveNouns({ definition: clinic, operator: opWords, workspace: wsWords }, 'fr'),
    ).toEqual({});
  });

  it('the generic persona renames nothing', () => {
    expect(resolveNouns({ definition: GENERIC_PERSONA_DEFINITION }, 'en')).toEqual({});
  });
});
