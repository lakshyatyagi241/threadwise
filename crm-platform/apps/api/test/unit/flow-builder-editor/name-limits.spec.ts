import { describe, expect, it } from 'vitest';
import {
  createAdminFlowTemplateSchema,
  renameFlowRequestSchema,
  saveFlowRequestSchema,
} from '@crm/contracts';

const graph = { flowNodes: [{ id: 'a', type: 'trigger', data: {} }], flowEdges: [] };

describe('flow and template name limits count characters (TW-FLB-005, 012)', () => {
  it('rename takes 191 characters, emoji included, and refuses 192', () => {
    expect(renameFlowRequestSchema.safeParse({ name: '😀'.repeat(191) }).success).toBe(true);
    expect(renameFlowRequestSchema.safeParse({ name: '😀'.repeat(192) }).success).toBe(false);
    expect(renameFlowRequestSchema.safeParse({ name: 'x'.repeat(191) }).success).toBe(true);
    expect(renameFlowRequestSchema.safeParse({ name: 'x'.repeat(192) }).success).toBe(false);
  });

  it('the rename error keeps the usual too_big issue on the name', () => {
    const r = renameFlowRequestSchema.safeParse({ name: 'x'.repeat(192) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]).toMatchObject({ code: 'too_big', path: ['name'], maximum: 191 });
    }
  });

  it('save takes a 255-character name and a 64-character category, refuses one more of either', () => {
    const ok = { name: '😀'.repeat(255), category: '😀'.repeat(64), graph };
    expect(saveFlowRequestSchema.safeParse(ok).success).toBe(true);
    expect(saveFlowRequestSchema.safeParse({ ...ok, name: '😀'.repeat(256) }).success).toBe(false);
    expect(saveFlowRequestSchema.safeParse({ ...ok, category: '😀'.repeat(65) }).success).toBe(false);
  });

  it('a template takes 160 / 1000 / 64 characters', () => {
    const base = { name: 'n', flowType: 'chat', payload: graph };
    const ok = { ...base, name: '😀'.repeat(160), description: '😀'.repeat(1000), category: '😀'.repeat(64) };
    expect(createAdminFlowTemplateSchema.safeParse(ok).success).toBe(true);
    expect(createAdminFlowTemplateSchema.safeParse({ ...ok, name: '😀'.repeat(161) }).success).toBe(false);
    expect(createAdminFlowTemplateSchema.safeParse({ ...ok, description: '😀'.repeat(1001) }).success).toBe(false);
    expect(createAdminFlowTemplateSchema.safeParse({ ...ok, category: '😀'.repeat(65) }).success).toBe(false);
  });
});
