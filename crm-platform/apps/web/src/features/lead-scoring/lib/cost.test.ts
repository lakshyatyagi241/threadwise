import { describe, expect, it } from 'vitest';
import { formatCostUsd } from './cost';

describe('formatCostUsd', () => {
  it('keeps the digits of a score that costs about a hundredth of a cent', () => {
    expect(formatCostUsd('0.00010000')).toBe('$0.0001');
    expect(formatCostUsd('0.000104')).toBe('$0.000104');
    expect(formatCostUsd('0.0023')).toBe('$0.0023');
  });
  it('never shows a non-zero cost as $0.00', () => {
    expect(formatCostUsd('0.00000001')).toBe('$0.00000001');
    expect(formatCostUsd('0.0000344')).toBe('$0.0000344');
    expect(formatCostUsd('0.00004')).toBe('$0.00004');
    expect(formatCostUsd('0.0000999')).toBe('$0.0000999');
    for (const v of ['0.00000001', '0.00004', '0.000099999']) {
      expect(formatCostUsd(v)).not.toBe('$0.00');
    }
  });
  it('shows a real zero as $0.00', () => {
    expect(formatCostUsd('0')).toBe('$0.00');
    expect(formatCostUsd('0.00000000')).toBe('$0.00');
  });
  it('uses cents for totals and trims to two decimals from a hundred up', () => {
    expect(formatCostUsd('0.5')).toBe('$0.50');
    expect(formatCostUsd('12.3456')).toBe('$12.3456');
    expect(formatCostUsd('1234.5678')).toBe('$1,234.57');
  });
  it('follows the viewer language', () => {
    expect(formatCostUsd('1234.5', 'de')).toContain('1.234,50');
  });
  it('shows a dash for a missing or unreadable value', () => {
    expect(formatCostUsd(null)).toBe('—');
    expect(formatCostUsd(undefined)).toBe('—');
    expect(formatCostUsd('abc')).toBe('—');
  });
});
