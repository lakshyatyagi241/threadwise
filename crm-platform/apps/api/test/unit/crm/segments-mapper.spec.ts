import { describe, expect, it } from 'vitest';
import { segmentResponseSchema } from '@crm/contracts';
import { toSegmentResponse } from '../../../src/modules/crm/segments/segments.mapper';
import type { SegmentRow } from '../../../src/modules/crm/segments/segments.repository';

const OWNER = '0f4f5c1e-7a1b-4c52-9d1e-2b8f1c3a4d01';
const EDITOR = '5b7e2a90-3c4d-4e8f-8a6b-9c0d1e2f3a02';

const row = (over: Partial<SegmentRow> = {}): SegmentRow => ({
  id: 41,
  uuid: '9a2d6e4f-1b3c-4d5e-8f70-a1b2c3d4e5f6',
  createdAtIso: '2026-10-01T09:00:00.000000Z',
  name: 'Lapsed buyers',
  description: null,
  color: null,
  visibility: 'private',
  sharedWithMe: false,
  sharesRev: 0,
  ownerId: 3,
  ownerUuid: OWNER,
  ownerName: 'Asha Rao',
  createdByUuid: OWNER,
  createdByName: 'Asha Rao',
  updatedByUuid: EDITOR,
  updatedByName: 'Ravi Nair',
  rules: {
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'lifecycleStage', operator: 'equals', value: 'new' }],
  },
  rulesVersion: 1,
  memberCountCache: null,
  memberCountAt: null,
  lastUsedAt: null,
  rowVersion: 4,
  createdAt: new Date('2026-10-01T09:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:30:00.000Z'),
  ...over,
});

const view = { memberCount: null, countApproximate: false, memberCountAt: null };

describe('toSegmentResponse: who created and who last changed a segment', () => {
  it('returns createdBy and updatedBy as { id, name } and validates against the contract', () => {
    const out = toSegmentResponse(row(), view, [], true);

    expect(out.createdBy).toEqual({ id: OWNER, name: 'Asha Rao' });
    expect(out.updatedBy).toEqual({ id: EDITOR, name: 'Ravi Nair' });
    expect(segmentResponseSchema.safeParse(out).success).toBe(true);
  });

  it('answers null for updatedBy on a segment nobody has changed since the column was added', () => {
    const out = toSegmentResponse(
      row({ updatedByUuid: null, updatedByName: null }),
      view,
      [],
      true,
    );

    expect(out.updatedBy).toBeNull();
  });

  it('answers null for createdBy when the creator was removed, and keeps the owner fields as they were', () => {
    const out = toSegmentResponse(
      row({ createdByUuid: null, createdByName: null }),
      view,
      [],
      false,
    );

    expect(out.createdBy).toBeNull();
    expect(out.ownerName).toBe('Asha Rao');
  });
});
