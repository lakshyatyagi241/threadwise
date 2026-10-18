import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_PERSONA_DEFINITION, type PersonaDefinition } from '@crm/contracts';
import type {
  PersonaRepository,
  WorkspacePersonaRecord,
} from '../../../src/modules/persona/persona.repository';
import { PersonaService } from '../../../src/modules/persona/persona.service';

const allowList: PersonaDefinition = {
  ...GENERIC_PERSONA_DEFINITION,
  label: { en: 'Clinic' },
  modules: { default: 'hide', ids: { 'nav:inbox': 'show', 'nav:contacts': 'show' } },
};
const denyList: PersonaDefinition = {
  ...GENERIC_PERSONA_DEFINITION,
  label: { en: 'Sales' },
  modules: { default: 'show', ids: { 'nav:store': 'hide' } },
};

const record = (over: Partial<WorkspacePersonaRecord> = {}): WorkspacePersonaRecord => ({
  personaKey: 'generic',
  personaVersion: 1,
  pinned: false,
  soloUi: 'off',
  showAllModules: false,
  workspaceOverrides: {},
  operatorOverrides: {},
  rev: 1,
  epoch: 1_000,
  currentVersion: 1,
  ...over,
});

function fakeRepo(init: {
  row: WorkspacePersonaRecord | null | Error;
  definitions?: Record<string, unknown>;
}) {
  const state = { row: init.row, definitions: init.definitions ?? ({} as Record<string, unknown>) };
  const repo = {
    workspaceRecord: vi.fn(async () => {
      if (state.row instanceof Error) throw state.row;
      return state.row;
    }),
    publishedDefinition: vi.fn(async (_org: number, key: string, version: number) => {
      return state.definitions[`${key}@${version}`] ?? null;
    }),
  };
  return { repo: repo as unknown as PersonaRepository, spies: repo, state };
}

describe('PersonaService.resolve', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the generic persona resolves to a view that hides nothing', async () => {
    const { repo } = fakeRepo({
      row: record(),
      definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION },
    });
    const view = await new PersonaService(repo).resolve(7);
    expect(view).toEqual({
      key: 'generic',
      version: 1,
      rev: 1,
      solo: false,
      showAll: false,
      defaultVisibility: 'show',
      modules: {},
    });
  });

  it('carries the words (BL-310) for every language that has any, workspace over operator over persona, and omits the field otherwise', async () => {
    const clinic: PersonaDefinition = {
      ...GENERIC_PERSONA_DEFINITION,
      vocabulary: {
        nouns: { contact: { en: { one: 'Patient', other: 'Patients' } } },
        phrases: {},
      },
    };
    const { repo } = fakeRepo({
      row: record({
        personaKey: 'clinic',
        currentVersion: 1,
        operatorOverrides: {
          v: 1,
          vocab: { meeting: { en: { one: 'Consult', other: 'Consults' } } },
        },
        workspaceOverrides: {
          v: 1,
          vocab: {
            contact: { en: { one: 'Client', other: 'Clients' } },
            deal: { hi: { one: 'केस', other: 'केस' } },
          },
        },
      }),
      definitions: { 'clinic@1': clinic },
    });
    const view = await new PersonaService(repo).resolve(1);
    expect(view?.nouns).toEqual({
      en: {
        contact: { one: 'Client', other: 'Clients' },
        meeting: { one: 'Consult', other: 'Consults' },
      },
      hi: { deal: { one: 'केस', other: 'केस' } },
    });
    // the generic golden view has no `nouns` key at all
    const generic = await new PersonaService(
      fakeRepo({ row: record(), definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION } }).repo,
    ).resolve(1);
    expect(generic).not.toHaveProperty('nouns');
  });

  it('a workspace with no row, or with an unknown persona or version, hides nothing (null)', async () => {
    const service = (r: ReturnType<typeof fakeRepo>) => new PersonaService(r.repo);
    expect(await service(fakeRepo({ row: null })).resolve(1)).toBeNull();
    expect(await service(fakeRepo({ row: record({ personaKey: 'ghost' }) })).resolve(1)).toBeNull();
    expect(
      await service(
        fakeRepo({
          row: record({ personaVersion: 9, currentVersion: 9 }),
          definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION },
        }),
      ).resolve(1),
    ).toBeNull();
  });

  it('a definition that no longer parses, or a failed read, resolves to null instead of throwing', async () => {
    const broken = fakeRepo({ row: record(), definitions: { 'generic@1': { schemaVersion: 7 } } });
    expect(await new PersonaService(broken.repo).resolve(1)).toBeNull();
    const down = fakeRepo({ row: new Error('connection refused') });
    expect(await new PersonaService(down.repo).resolve(1)).toBeNull();
  });

  it('follows the latest published version unless pinned', async () => {
    const definitions = { 'clinic@1': denyList, 'clinic@2': allowList };
    const follow = fakeRepo({
      row: record({ personaKey: 'clinic', personaVersion: 1, currentVersion: 2 }),
      definitions,
    });
    expect((await new PersonaService(follow.repo).resolve(1))?.version).toBe(2);
    const pinned = fakeRepo({
      row: record({ personaKey: 'clinic', personaVersion: 1, currentVersion: 2, pinned: true }),
      definitions,
    });
    expect((await new PersonaService(pinned.repo).resolve(1))?.version).toBe(1);
  });

  it('applies the layers: an allow-list persona, the operator, the workspace and Show more modules', async () => {
    const { repo } = fakeRepo({
      row: record({
        personaKey: 'clinic',
        currentVersion: 1,
        operatorOverrides: {
          v: 1,
          modules: {
            'nav:deals': { state: 'show', locked: true, reason: 'agreed with the owner' },
          },
        },
        workspaceOverrides: { v: 1, modules: { 'nav:contacts': { state: 'hide' } } },
      }),
      definitions: { 'clinic@1': allowList },
    });
    const view = await new PersonaService(repo).resolve(1);
    expect(view?.defaultVisibility).toBe('hide');
    expect(view?.modules).toEqual({
      'nav:inbox': { visible: true, locked: false },
      'nav:deals': { visible: true, locked: true },
      // contacts: persona show, workspace hide -> same as the default, so it is not listed
    });
  });

  it('Show more modules turns the default to show and keeps a workspace hide', async () => {
    const { repo } = fakeRepo({
      row: record({
        personaKey: 'clinic',
        showAllModules: true,
        workspaceOverrides: { v: 1, modules: { 'nav:contacts': { state: 'hide' } } },
      }),
      definitions: { 'generic@1': allowList, 'clinic@1': allowList },
    });
    const view = await new PersonaService(repo).resolve(1);
    expect(view).toMatchObject({ showAll: true, defaultVisibility: 'show' });
    expect(view?.modules).toEqual({ 'nav:contacts': { visible: false, locked: false } });
  });

  it('is solo only when the workspace said so explicitly', async () => {
    const make = (soloUi: string) =>
      new PersonaService(
        fakeRepo({
          row: record({ soloUi }),
          definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION },
        }).repo,
      ).resolve(1);
    expect((await make('on'))?.solo).toBe(true);
    expect((await make('auto'))?.solo).toBe(false);
    expect((await make('off'))?.solo).toBe(false);
  });

  it('keeps the parsed definition of a published version and memoises the view by rev', async () => {
    const r = fakeRepo({ row: record(), definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION } });
    const service = new PersonaService(r.repo);
    await service.resolve(1);
    await service.resolve(1);
    expect(r.spies.publishedDefinition).toHaveBeenCalledTimes(1);

    // another workspace on the same version reuses the definition
    await service.resolve(2);
    expect(r.spies.publishedDefinition).toHaveBeenCalledTimes(1);

    // a write bumps rev: the view is recomputed from the new row at once
    r.state.row = record({
      rev: 2,
      workspaceOverrides: { v: 1, modules: { 'nav:deals': { state: 'hide' } } },
    });
    const next = await service.resolve(1);
    expect(next?.rev).toBe(2);
    expect(next?.modules['nav:deals']).toEqual({ visible: false, locked: false });
  });

  it("a row deleted and created again restarts rev at 1 and must not be served the old row's view", async () => {
    const hidden = { v: 1, modules: { 'nav:deals': { state: 'hide' } } };
    const r = fakeRepo({
      row: record({ rev: 2, epoch: 1_000, workspaceOverrides: hidden }),
      definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION },
    });
    const service = new PersonaService(r.repo);
    expect((await service.resolve(1))?.modules['nav:deals']).toEqual({
      visible: false,
      locked: false,
    });
    r.state.row = record({ rev: 2, epoch: 2_000, workspaceOverrides: {} });
    expect((await service.resolve(1))?.modules).toEqual({});
  });

  it('a stale memoised view expires after 30 seconds even for the same rev', async () => {
    const r = fakeRepo({ row: record(), definitions: { 'generic@1': GENERIC_PERSONA_DEFINITION } });
    const service = new PersonaService(r.repo);
    const first = await service.resolve(1);
    expect(await service.resolve(1)).toBe(first);
    vi.advanceTimersByTime(31_000);
    const again = await service.resolve(1);
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
  });

  it('remembers a missing version only briefly', async () => {
    const r = fakeRepo({ row: record({ personaKey: 'later' }), definitions: {} });
    const service = new PersonaService(r.repo);
    expect(await service.resolve(1)).toBeNull();
    expect(await service.resolve(1)).toBeNull();
    expect(r.spies.publishedDefinition).toHaveBeenCalledTimes(1);

    // the persona gets published: after the short window the workspace sees it
    r.state.definitions['later@1'] = denyList;
    vi.advanceTimersByTime(6_000);
    expect((await service.resolve(1))?.key).toBe('later');
  });
});
