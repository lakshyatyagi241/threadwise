import { describe, expect, it } from 'vitest';
import { keyRotationDelta } from '../../../src/modules/forms-builder/form-key';

const OLD_KEY = 'OLDkey000000000000000A';
const NEW_KEY = 'NEWkey000000000000000B';

describe('keyRotationDelta (the audit row of a public key rotation)', () => {
  it('records a fingerprint of the retired key and of the new key, and they differ', () => {
    const delta = keyRotationDelta(OLD_KEY, NEW_KEY);
    expect(delta.publicKey.old).toMatch(/^[0-9a-f]{8}$/);
    expect(delta.publicKey.new).toMatch(/^[0-9a-f]{8}$/);
    expect(delta.publicKey.old).not.toBe(delta.publicKey.new);
  });

  it('never stores a full key', () => {
    const serialised = JSON.stringify(keyRotationDelta(OLD_KEY, NEW_KEY));
    expect(serialised).not.toContain(OLD_KEY);
    expect(serialised).not.toContain(NEW_KEY);
  });

  it('gives a key the same fingerprint every time, so a leaked key can be matched to its rotation', () => {
    expect(keyRotationDelta(OLD_KEY, NEW_KEY).publicKey.old).toBe(
      keyRotationDelta(OLD_KEY, 'ZZZkey000000000000000C').publicKey.old,
    );
  });
});
