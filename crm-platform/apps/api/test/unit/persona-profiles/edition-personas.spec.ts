import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAT_SIDE_MODULES,
  CRM_SIDE_MODULES,
  EDITION_PERSONAS,
  GENERIC_PERSONA_DEFINITION,
  moduleIdSchema,
  personaDefinitionSchema,
} from '@crm/contracts';

const MIGRATION = join(
  __dirname,
  '../../../../../packages/db/migrations/20270220090100_edition_personas.sql',
);

const hiddenOf = (key: string): string[] =>
  Object.entries(EDITION_PERSONAS[key]!.modules.ids)
    .filter(([, v]) => v === 'hide')
    .map(([k]) => k);

describe('edition personas (BL-383)', () => {
  it('are valid persona definitions with well-formed module ids, each id once', () => {
    for (const [key, def] of Object.entries(EDITION_PERSONAS)) {
      expect(personaDefinitionSchema.safeParse(def).success, key).toBe(true);
      for (const id of Object.keys(def.modules.ids))
        expect(moduleIdSchema.safeParse(id).success, id).toBe(true);
    }
    expect(new Set(CRM_SIDE_MODULES).size).toBe(CRM_SIDE_MODULES.length);
    expect(new Set(CHAT_SIDE_MODULES).size).toBe(CHAT_SIDE_MODULES.length);
  });

  it('keep contacts, the shared core, and the Teams and Roles tiles visible in every edition', () => {
    for (const key of Object.keys(EDITION_PERSONAS)) {
      for (const core of [
        'nav:contacts',
        'section:contact.overview',
        'section:contact.notes',
        'section:contact.details',
        'tile:roles',
        'tile:teams',
        'tile:workspace-team',
      ])
        expect(hiddenOf(key), `${key} ${core}`).not.toContain(core);
    }
  });

  it('chat hides deals, tasks and assignment; sales hides the inbox; both hides nothing', () => {
    expect(hiddenOf('chat_team')).toEqual(
      expect.arrayContaining([
        'nav:deals',
        'section:contact.deals',
        'section:contact.tasks',
        'tile:record-assignment',
      ]),
    );
    expect(hiddenOf('chat_team')).not.toContain('nav:inbox');
    expect(hiddenOf('sales_team')).toEqual(
      expect.arrayContaining(['nav:inbox', 'section:contact.conversations', 'card:dashboard.inbox']),
    );
    expect(hiddenOf('sales_team')).not.toContain('nav:deals');
    expect(hiddenOf('both')).toEqual([]);
    expect(EDITION_PERSONAS.both!.modules).toEqual(GENERIC_PERSONA_DEFINITION.modules);
  });

  it('are seeded by the migration with exactly these documents', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const blocks = sql.split('INSERT INTO personas ').slice(1);
    for (const [key, def] of Object.entries(EDITION_PERSONAS)) {
      const block = blocks.find((b) => b.includes(`VALUES ('${key}', 'active', false,`));
      expect(block, key).toBeDefined();
      const m = /\$json\$([\s\S]*?)\$json\$::jsonb/.exec(block!);
      expect(m, key).not.toBeNull();
      expect(JSON.parse(m![1]!)).toEqual(def);
    }
  });
});
