import { describe, expect, it } from 'vitest';
import {
  FlowRefResolver,
  firstFlowRef,
  parseFlowRef,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/flow-refs';

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('parseFlowRef', () => {
  it('accepts a positive integer (number or digits) and a uuid, nothing else', () => {
    expect(parseFlowRef(7)).toEqual({ kind: 'id', id: 7 });
    expect(parseFlowRef(' 12 ')).toEqual({ kind: 'id', id: 12 });
    expect(parseFlowRef(UUID.toUpperCase())).toEqual({ kind: 'uuid', uuid: UUID });
    for (const bad of [
      0,
      '0',
      -3,
      1.5,
      '',
      '  ',
      'abc',
      '3fa8',
      null,
      undefined,
      {},
      true,
      `${UUID}x`,
    ]) {
      expect(parseFlowRef(bad), String(bad)).toBeNull();
    }
  });

  it('a uuid is never read as its leading digits', () => {
    expect(parseFlowRef('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toEqual({
      kind: 'uuid',
      uuid: UUID,
    });
    expect(parseFlowRef('3-leading-digit')).toBeNull();
  });

  it('firstFlowRef takes the first usable field', () => {
    expect(firstFlowRef('', 0, UUID, 5)).toEqual({ kind: 'uuid', uuid: UUID });
    expect(firstFlowRef(undefined, null)).toBeNull();
  });
});

describe('FlowRefResolver (the SQL runs in the workspace tenant transaction, scoped by org_id)', () => {
  const build = (rows: Array<Record<string, unknown>>) => {
    const seen: Array<{ scope: unknown; sql: string; params: unknown[] }> = [];
    const db = {
      txAs: async (scope: unknown, fn: (tx: unknown) => unknown) =>
        fn({
          execute: async (q: { queryChunks: unknown[] }) => {
            const chunks = q.queryChunks as Array<{ value?: string[] } | unknown>;
            const sqlText = chunks
              .map((c) =>
                c && typeof c === 'object' && 'value' in c
                  ? (c as { value: string[] }).value.join('')
                  : '?',
              )
              .join('');
            seen.push({
              scope,
              sql: sqlText,
              params: chunks.filter((c) => typeof c === 'number' || typeof c === 'string'),
            });
            return { rows };
          },
        }),
    };
    return { resolver: new FlowRefResolver(db as never), seen };
  };

  it('an integer id costs no query; a blank reference is 0', async () => {
    const { resolver, seen } = build([]);
    expect(await resolver.templateId(1, { kind: 'id', id: 9 })).toBe(9);
    expect(await resolver.assistantId(1, null)).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('a uuid is looked up by org and uuid in the right table, for the right org', async () => {
    const { resolver, seen } = build([{ id: '41' }]);
    expect(await resolver.templateId(5, { kind: 'uuid', uuid: UUID })).toBe(41);
    expect(await resolver.assistantId(5, { kind: 'uuid', uuid: UUID })).toBe(41);
    expect(seen[0]!.scope).toEqual({ orgId: 5, userId: null });
    expect(seen[0]!.sql).toContain('wa_templates');
    expect(seen[0]!.sql).toContain('org_id =');
    expect(seen[1]!.sql).toContain('ai_chat_assistants');
    expect(seen[0]!.params).toContain(5);
    expect(seen[0]!.params).toContain(UUID);
  });

  it('no row (another workspace, or none) resolves to 0', async () => {
    const { resolver } = build([]);
    expect(await resolver.templateId(5, { kind: 'uuid', uuid: UUID })).toBe(0);
  });
});
