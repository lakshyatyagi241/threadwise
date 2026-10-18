import { describe, expect, it, vi } from 'vitest';
import { GENERIC_PERSONA_DEFINITION, type PersonaDefinition } from '@crm/contracts';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { AuditService } from '../../../src/kernel/audit/audit.service';
import { PersonaVocabularyService } from '../../../src/modules/persona/persona-vocabulary.service';
import type {
  PersonaRepository,
  WorkspacePersonaRecord,
} from '../../../src/modules/persona/persona.repository';

const clinic: PersonaDefinition = {
  ...GENERIC_PERSONA_DEFINITION,
  vocabulary: {
    nouns: {
      contact: {
        en: { one: 'Patient', other: 'Patients' },
        hi: { one: 'मरीज', other: 'मरीज' },
      },
    },
    phrases: {},
  },
};
const forms = (one: string, other = `${one}s`) => ({ one, other });

const record = (over: Partial<WorkspacePersonaRecord> = {}): WorkspacePersonaRecord => ({
  personaKey: 'generic',
  personaVersion: 1,
  pinned: false,
  soloUi: 'off',
  showAllModules: false,
  workspaceOverrides: {},
  operatorOverrides: {},
  rev: 3,
  epoch: 1,
  currentVersion: 1,
  ...over,
});

function service(row: WorkspacePersonaRecord | null, definitions: Record<string, unknown> = {}) {
  const repo = {
    workspaceRecord: vi.fn(async () => row),
    publishedDefinition: vi.fn(
      async (_org: number, key: string, version: number) =>
        definitions[`${key}@${version}`] ?? null,
    ),
  } as unknown as PersonaRepository;
  return new PersonaVocabularyService(repo, {} as DatabaseService, {} as AuditService);
}
const rowOf = (res: Awaited<ReturnType<PersonaVocabularyService['get']>>, noun: string) =>
  res.nouns.find((n) => n.noun === noun)!;

describe('PersonaVocabularyService.get', () => {
  it('a workspace with no row reads as generic with no words, revision 1', async () => {
    const res = await service(null).get(1, 'en');
    expect(res).toMatchObject({ locale: 'en', rev: 1, personaKey: 'generic' });
    expect(res.nouns.map((n) => n.noun)).toEqual(['contact', 'appointment', 'deal', 'meeting']);
    for (const n of res.nouns) {
      expect(n).toEqual({
        noun: n.noun,
        effective: null,
        source: 'default',
        workspace: null,
        workspaceLocales: [],
      });
    }
  });

  it('reports the layer that speaks, per language, and the workspace’s own languages', async () => {
    const svc = service(
      record({
        personaKey: 'clinic',
        operatorOverrides: { v: 1, vocab: { deal: { en: forms('Case') } } },
        workspaceOverrides: {
          v: 1,
          vocab: {
            appointment: { en: forms('Visit'), hi: forms('मुलाकात') },
            deal: { hi: forms('केस') },
          },
        },
      }),
      { 'clinic@1': clinic },
    );
    const en = await svc.get(1, 'en');
    expect(rowOf(en, 'contact')).toMatchObject({ source: 'persona', effective: forms('Patient') });
    expect(rowOf(en, 'appointment')).toMatchObject({
      source: 'workspace',
      workspace: forms('Visit'),
      workspaceLocales: ['en', 'hi'],
    });
    expect(rowOf(en, 'deal')).toMatchObject({
      source: 'operator',
      effective: forms('Case'),
      workspace: null,
      workspaceLocales: ['hi'],
    });
    expect(rowOf(en, 'meeting').source).toBe('default');

    const hi = await svc.get(1, 'hi');
    expect(rowOf(hi, 'deal')).toMatchObject({ source: 'workspace', workspace: forms('केस') });
  });

  it('an unreadable persona definition falls back to the product words, never an error', async () => {
    const res = await service(record({ personaKey: 'clinic' }), {
      'clinic@1': { schemaVersion: 9 },
    }).get(1, 'en');
    expect(rowOf(res, 'contact').source).toBe('default');
  });

  it('a stored override document that no longer parses is silent', async () => {
    const res = await service(record({ workspaceOverrides: { v: 9, vocab: 'broken' } })).get(
      1,
      'en',
    );
    expect(rowOf(res, 'contact').workspace).toBeNull();
  });
});
