import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MODULES,
  autofillName,
  isValidPermissionName,
  normaliseAction,
  previewParts,
} from './permission-name';

describe('PERMISSION_MODULES', () => {
  it('offers the 13 WaDesk modules', () => {
    expect(PERMISSION_MODULES).toHaveLength(13);
    expect(PERMISSION_MODULES[0]).toBe('users');
    expect(PERMISSION_MODULES.at(-1)).toBe('support');
  });
});

describe('normaliseAction', () => {
  it('lowercases and turns spaces into underscores', () => {
    expect(normaliseAction('  Export Data  ')).toBe('export_data');
    expect(normaliseAction('')).toBe('');
  });
});

describe('previewParts', () => {
  it('shows placeholders until both are chosen', () => {
    expect(previewParts('', '')).toEqual({ module: 'module', action: 'action' });
    expect(previewParts('billing', 'Refund')).toEqual({ module: 'billing', action: 'refund' });
  });
});

describe('autofillName', () => {
  it('fills module.action once both are set', () => {
    expect(autofillName({ module: 'campaigns', action: 'export', name: '', edited: false })).toBe(
      'campaigns.export',
    );
  });
  it('waits for both parts', () => {
    expect(autofillName({ module: 'campaigns', action: '', name: '', edited: false })).toBe('');
    expect(autofillName({ module: '', action: 'export', name: '', edited: false })).toBe('');
  });
  it('stops once the name was edited by hand', () => {
    expect(
      autofillName({ module: 'campaigns', action: 'export', name: 'custom.key', edited: true }),
    ).toBe('custom.key');
  });
  it('normalises the action like the preview does', () => {
    expect(autofillName({ module: 'audit', action: 'Export CSV', name: '', edited: false })).toBe(
      'audit.export_csv',
    );
  });
});

describe('isValidPermissionName', () => {
  it('accepts lowercase dotted segments', () => {
    expect(isValidPermissionName('campaigns.send')).toBe(true);
    expect(isValidPermissionName('superuser')).toBe(true);
  });
  it('rejects capitals, spaces and empty parts', () => {
    expect(isValidPermissionName('Campaigns.Send')).toBe(false);
    expect(isValidPermissionName('a b')).toBe(false);
    expect(isValidPermissionName('a..b')).toBe(false);
    expect(isValidPermissionName('')).toBe(false);
  });
});
