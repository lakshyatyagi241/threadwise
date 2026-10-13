import { describe, expect, it } from 'vitest';
import { sweepHours } from '../../../src/modules/whatsapp-devices-baileys/device-groups-sweep.service';

describe('how often the group directory is re-read', () => {
  it('defaults to six hours; 0 turns the sweep off; junk falls back to the default', () => {
    expect(sweepHours({})).toBe(6);
    expect(sweepHours({ WA_GROUPS_SWEEP_HOURS: '' })).toBe(6);
    expect(sweepHours({ WA_GROUPS_SWEEP_HOURS: '12' })).toBe(12);
    expect(sweepHours({ WA_GROUPS_SWEEP_HOURS: '0' })).toBe(0);
    expect(sweepHours({ WA_GROUPS_SWEEP_HOURS: '-3' })).toBe(6);
    expect(sweepHours({ WA_GROUPS_SWEEP_HOURS: 'often' })).toBe(6);
  });
});
