import { describe, expect, it } from 'vitest';
import { platformAccess, uploadMenuAction, workspaceAccess } from './access';

describe('workspaceAccess', () => {
  it('reads the two report permissions from the session map', () => {
    expect(workspaceAccess({})).toEqual({ canRead: false, canManage: false });
    expect(workspaceAccess({ 'dash.reports.read': true })).toEqual({
      canRead: true,
      canManage: false,
    });
    expect(workspaceAccess({ 'dash.reports.read': true, 'dash.reports.manage': true })).toEqual({
      canRead: true,
      canManage: true,
    });
  });
  it('does not mistake another dashboard permission for it', () => {
    expect(
      workspaceAccess({ 'dash.dashboard.read': true, 'dash.analytics.read': true }).canRead,
    ).toBe(false);
  });
});

describe('platformAccess', () => {
  it('lets a super admin read and change, an auditor read, and support neither', () => {
    expect(platformAccess('super_admin')).toEqual({ canRead: true, canManage: true });
    expect(platformAccess('auditor')).toEqual({ canRead: true, canManage: false });
    expect(platformAccess('support')).toEqual({ canRead: false, canManage: false });
  });
});

describe('uploadMenuAction (the chat "+" menu)', () => {
  it('opens the picker for someone who can manage the library, explains for a viewer', () => {
    expect(
      uploadMenuAction(workspaceAccess({ 'dash.reports.read': true, 'dash.reports.manage': true })),
    ).toBe('pick');
    expect(uploadMenuAction(workspaceAccess({ 'dash.reports.read': true }))).toBe('explain');
    expect(uploadMenuAction(platformAccess('super_admin'))).toBe('pick');
    expect(uploadMenuAction(platformAccess('auditor'))).toBe('explain');
  });
});
