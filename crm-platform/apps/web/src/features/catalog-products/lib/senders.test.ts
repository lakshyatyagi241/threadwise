import { describe, expect, it } from 'vitest';
import { isOfficialEngine, senderPhone, workspaceEngine } from './senders';

describe('workspaceEngine', () => {
  it('prefers an official number over a paired device', () => {
    expect(workspaceEngine([{ engine: 'baileys' }, { engine: 'waba' }])).toBe('waba');
    expect(workspaceEngine([{ engine: 'twilio' }, { engine: 'baileys' }])).toBe('twilio');
    expect(workspaceEngine([{ engine: 'waba' }, { engine: 'twilio' }])).toBe('waba');
  });
  it('is the unofficial engine for devices only, or nothing', () => {
    expect(workspaceEngine([{ engine: 'baileys' }])).toBe('baileys');
    expect(workspaceEngine([])).toBe('baileys');
  });
  it('knows which engines are official', () => {
    expect(isOfficialEngine('waba')).toBe(true);
    expect(isOfficialEngine('twilio')).toBe(true);
    expect(isOfficialEngine('baileys')).toBe(false);
  });
});

describe('senderPhone', () => {
  it('trims and defaults to empty', () => {
    expect(senderPhone({ phone: ' +91 98765 ' })).toBe('+91 98765');
    expect(senderPhone({ phone: null })).toBe('');
  });
});
