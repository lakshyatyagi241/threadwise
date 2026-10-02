import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, AI_PROVIDER_SLUGS, findAiProvider } from '@crm/contracts';

const MIGRATION = resolve(
  __dirname,
  '../../../../../packages/db/migrations/20261002110000_aiadm_provider_registry.sql',
);

describe('the provider catalogue (WD-AIADM-001, 005, 008)', () => {
  it('has the 22 slots, language models first and voice vendors last', () => {
    expect(AI_PROVIDER_SLUGS).toHaveLength(22);
    expect(new Set(AI_PROVIDER_SLUGS).size).toBe(22);
    expect(AI_PROVIDER_SLUGS.slice(-2)).toEqual(['elevenlabs', 'deepgram']);
    expect(AI_PROVIDERS.filter((p) => p.group === 'voice').map((p) => p.slug)).toEqual([
      'elevenlabs',
      'deepgram',
    ]);
  });

  it('lists each model once and keeps a seeded default inside its own list', () => {
    for (const p of AI_PROVIDERS) {
      expect(new Set(p.models).size, p.slug).toBe(p.models.length);
      if (p.seedModel) expect(p.models, p.slug).toContain(p.seedModel);
    }
  });

  it('offers the output ceiling on exactly the five vendors WaDesk did', () => {
    expect(AI_PROVIDERS.filter((p) => p.maxTokensField).map((p) => p.slug)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'mistral',
      'openrouter',
    ]);
  });

  it('finds a slug after trimming and lower-casing, and nothing for together or fireworks', () => {
    expect(findAiProvider('  OpenAI ')?.slug).toBe('openai');
    expect(findAiProvider('together')).toBeUndefined();
    expect(findAiProvider('fireworks')).toBeUndefined();
  });

  it('is seeded by the migration with the same slugs, names, defaults and a collision-free order', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const rows = [
      ...sql.matchAll(
        /\('([a-z0-9]+)',\s+'([^']+)',\s+(NULL|'[^']+'),\s+'\{\}',\s+false,\s+(\d+)\)/g,
      ),
    ].map((m) => ({
      slug: m[1],
      name: m[2],
      model: m[3] === 'NULL' ? null : m[3]!.slice(1, -1),
      order: Number(m[4]),
    }));

    expect(rows.map((r) => r.slug)).toEqual(AI_PROVIDER_SLUGS);
    for (const r of rows) {
      const def = findAiProvider(r.slug)!;
      expect(r.name, r.slug).toBe(def.name);
      expect(r.model, r.slug).toBe(def.seedModel);
    }
    const orders = rows.map((r) => r.order);
    expect(new Set(orders).size).toBe(22);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
