import {
  GENERIC_PERSONA_DEFINITION,
  parseOperatorOverrides,
  parseWorkspaceOverrides,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { MODULE_CATALOG } from '@/features/_registry/module-catalog.generated';
import { allowList, denyList, genericView, viewFrom } from './testing';
import { personaHiddenIds } from './server';
import { hiddenSetFor, isHiddenBy, isLockedBy, personaVisibility } from './visibility';

const CATALOG = MODULE_CATALOG.map((e) => e.id);

describe('persona visibility (pure)', () => {
  it('no view hides nothing: unknown means show everything', () => {
    for (const view of [null, undefined]) {
      const p = personaVisibility(view);
      expect(p.key).toBeNull();
      expect(p.showAll).toBe(false);
      for (const id of CATALOG) expect(p.isHidden(id), id).toBe(false);
      expect(hiddenSetFor(view, CATALOG)).toBeNull();
    }
  });

  it('the generic persona hides nothing at all (golden: zero visible change)', () => {
    const view = genericView();
    expect(view.defaultVisibility).toBe('show');
    expect(view.modules).toEqual({});
    const p = personaVisibility(view);
    expect(p.key).toBe('generic');
    for (const id of CATALOG) expect(p.isHidden(id), id).toBe(false);
    expect([...(hiddenSetFor(view, CATALOG) ?? ['x'])]).toEqual([]);
    expect([...(personaHiddenIds(view) ?? ['x'])]).toEqual([]);
  });

  it('a deny-list persona hides exactly the ids it names', () => {
    const view = viewFrom({
      definition: denyList(['nav:deals', 'section:contact.meetings', 'card:dashboard.pipeline']),
    });
    const hidden = hiddenSetFor(view, CATALOG)!;
    expect([...hidden].sort()).toEqual([
      'card:dashboard.pipeline',
      'nav:deals',
      'section:contact.meetings',
    ]);
    expect(isHiddenBy(view, 'nav:inbox')).toBe(false);
  });

  it('an allow-list persona hides every catalog id it does not name', () => {
    const view = viewFrom({ definition: allowList(['nav:inbox', 'nav:contacts']) });
    const hidden = hiddenSetFor(view, CATALOG)!;
    expect(hidden.has('nav:inbox')).toBe(false);
    expect(hidden.has('nav:contacts')).toBe(false);
    expect(hidden.has('nav:deals')).toBe(true);
    expect(hidden.size).toBe(CATALOG.length - 2);
  });

  it('typed shortcuts build the same ids the catalog uses', () => {
    const view = viewFrom({
      definition: denyList([
        'nav:deals',
        'tile:booking-types',
        'section:contact.meetings',
        'card:dashboard.pipeline',
        'action:contact.meeting',
      ]),
    });
    const p = personaVisibility(view);
    expect(p.isNavHidden('deals')).toBe(true);
    expect(p.isTileHidden('booking-types')).toBe(true);
    expect(p.isSectionHidden('meetings')).toBe(true);
    expect(p.isCardHidden('pipeline')).toBe(true);
    expect(p.isActionHidden('meeting')).toBe(true);
    expect(p.isNavHidden('inbox')).toBe(false);
    expect(p.isSectionHidden('deals')).toBe(false);
  });

  it('Show more modules reveals what the persona hid, except what the operator locked hidden', () => {
    const definition = allowList(['nav:inbox']);
    const operator = parseOperatorOverrides({
      v: 1,
      modules: { 'nav:deals': { state: 'hide', locked: true, reason: 'not on this contract' } },
    });
    const view = viewFrom({ definition, operator, showAll: true });
    expect(view.showAll).toBe(true);
    expect(isHiddenBy(view, 'nav:contacts')).toBe(false);
    expect(isHiddenBy(view, 'nav:deals')).toBe(true);
    expect(isLockedBy(view, 'nav:deals')).toBe(true);
    expect(isLockedBy(view, 'nav:contacts')).toBe(false);
  });

  it('a workspace override beats the persona, an operator lock beats the workspace', () => {
    const definition = denyList(['nav:deals']);
    const workspace = parseWorkspaceOverrides({
      v: 1,
      modules: { 'nav:deals': { state: 'show' } },
    });
    expect(isHiddenBy(viewFrom({ definition, workspace }), 'nav:deals')).toBe(false);
    const operator = parseOperatorOverrides({
      v: 1,
      modules: { 'nav:deals': { state: 'hide', locked: true, reason: 'plan decision' } },
    });
    expect(isHiddenBy(viewFrom({ definition, workspace, operator }), 'nav:deals')).toBe(true);
  });

  it('an id the catalog does not have is never an error', () => {
    const view = viewFrom({ definition: denyList(['nav:does-not-exist']) });
    expect(() => hiddenSetFor(view, CATALOG)).not.toThrow();
    expect(hiddenSetFor(view, CATALOG)!.has('nav:does-not-exist')).toBe(false);
  });

  it('GENERIC_PERSONA_DEFINITION itself shows everything', () => {
    expect(GENERIC_PERSONA_DEFINITION.modules.default).toBe('show');
    expect(Object.keys(GENERIC_PERSONA_DEFINITION.modules.ids)).toEqual([]);
  });
});
