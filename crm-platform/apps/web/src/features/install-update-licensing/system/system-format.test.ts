import { describe, expect, it } from 'vitest';
import { checkTone, formatUptime, migrationStatusTone, rowTone } from './system-format';

describe('formatUptime', () => {
  it.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m'],
    [3600, '1h 0m'],
    [93784, '1d 2h 3m'],
    [-5, '0s'],
  ])('%s -> %s', (input, out) => expect(formatUptime(input)).toBe(out));
});

describe('tones', () => {
  it('maps dependency status', () => {
    expect(checkTone('up')).toBe('success');
    expect(checkTone('degraded')).toBe('warning');
    expect(checkTone('down')).toBe('danger');
  });
  it('maps migration status and rows', () => {
    expect(migrationStatusTone('current')).toBe('success');
    expect(migrationStatusTone('unknown')).toBe('neutral');
    expect(migrationStatusTone('pending')).toBe('warning');
    expect(migrationStatusTone('drift')).toBe('danger');
    expect(rowTone('applied')).toBe('success');
    expect(rowTone('modified')).toBe('danger');
  });
});
