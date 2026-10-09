import { describe, expect, it } from 'vitest';
import { rowActions } from './row-actions';

describe('rowActions', () => {
  it('a full-access role edits, sees logs and deletes', () => {
    expect(rowActions({ update: true, delete: true })).toEqual(['edit', 'logs', 'delete']);
  });
  it('a read-only role can view and see logs, never delete', () => {
    expect(rowActions({ update: false, delete: false })).toEqual(['view', 'logs']);
  });
  it('delete is independent of update', () => {
    expect(rowActions({ update: false, delete: true })).toEqual(['view', 'logs', 'delete']);
  });
});
