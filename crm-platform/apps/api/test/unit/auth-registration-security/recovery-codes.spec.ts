import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  consumeRecoveryCode,
  createRecoveryCodes,
  normalizeRecoveryCode,
} from '../../../src/modules/auth/support/recovery-codes';

describe('recovery codes', () => {
  it('creates ten distinct codes in a readable format and stores only hashes', async () => {
    const { plain, hashes } = await createRecoveryCodes();
    expect(plain).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(plain).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of plain) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    expect(hashes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const h of hashes) expect(h.startsWith('$argon2id$')).toBe(true);
  });

  it('accepts a code once, loosely typed, and removes it', async () => {
    const { plain, hashes } = await createRecoveryCodes();
    const typed = plain[3]!.toLowerCase().replace('-', ' ');
    const remaining = await consumeRecoveryCode(hashes, typed);
    expect(remaining).toHaveLength(RECOVERY_CODE_COUNT - 1);
    expect(await consumeRecoveryCode(remaining!, plain[3]!)).toBeNull();
    expect(await consumeRecoveryCode(remaining!, plain[4]!)).toHaveLength(RECOVERY_CODE_COUNT - 2);
  });

  it('rejects wrong and malformed codes', async () => {
    const { hashes } = await createRecoveryCodes();
    expect(await consumeRecoveryCode(hashes, 'AAAAA-BBBBB')).toBeNull();
    expect(await consumeRecoveryCode(hashes, 'short')).toBeNull();
  });

  it('normalises separators and case', () => {
    expect(normalizeRecoveryCode('ab cd-ef ghi')).toBe('ABCDEFGHI');
  });
});
