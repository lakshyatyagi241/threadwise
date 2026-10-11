import { beforeEach, describe, expect, it, vi } from 'vitest';

const startRegistration = vi.fn();
const startAuthentication = vi.fn();
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (arg: unknown) => startRegistration(arg),
  startAuthentication: (arg: unknown) => startAuthentication(arg),
  browserSupportsWebAuthn: () => true,
}));

const { assertPasskey, createPasskey } = await import('./passkey-browser');

beforeEach(() => {
  startRegistration.mockReset();
  startAuthentication.mockReset();
});

describe('createPasskey', () => {
  it("hands the API's registration options to the browser and returns its answer unchanged", async () => {
    const options = { challenge: 'abc', rp: { name: 'Acme', id: 'acme.test' } };
    const credential = { id: 'cred-1', type: 'public-key', response: { attestationObject: 'x' } };
    startRegistration.mockResolvedValue(credential);
    await expect(createPasskey(options)).resolves.toBe(credential);
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
  });

  it('lets the browser error through so the caller can tell a cancellation from a failure', async () => {
    const cancelled = Object.assign(new Error('closed'), { name: 'NotAllowedError' });
    startRegistration.mockRejectedValue(cancelled);
    await expect(createPasskey({ challenge: 'abc' })).rejects.toBe(cancelled);
  });
});

describe('assertPasskey', () => {
  it("hands the API's sign-in options to the browser and returns the assertion unchanged", async () => {
    const options = { challenge: 'xyz', allowCredentials: [{ id: 'cred-1', type: 'public-key' }] };
    const assertion = { id: 'cred-1', type: 'public-key', response: { signature: 's' } };
    startAuthentication.mockResolvedValue(assertion);
    await expect(assertPasskey(options)).resolves.toBe(assertion);
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
  });
});
