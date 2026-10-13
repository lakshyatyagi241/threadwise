import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedAddress } from '../../../net/blocked-address';

/** A mail server address that must not be connected to (a private, loopback, link-local or metadata address). */
export class BlockedHostError extends Error {
  constructor() {
    super('This mail server address is not allowed.');
    this.name = 'BlockedHostError';
  }
}

/** Where to connect and what name the server's certificate must carry. */
export interface SafeTarget {
  /** The address to connect to (an IP when the name was resolved here, so the checked address is the connected one). */
  connectHost: string;
  /** The name for SNI and certificate validation; undefined for an IP literal. */
  servername: string | undefined;
}

/**
 * SSRF guard of the IMAP/SMTP provider: the workspace admin types the server, so the platform must not be aimed at its own network.
 * The name is resolved HERE, every answer is checked with the shared address rule, and the caller connects to the checked IP (with the
 * original name as the TLS server name), so a DNS answer that changes between check and connect (rebinding) cannot reach a private
 * address. `allowPrivate` (env `MAIL_IMAP_ALLOW_PRIVATE_HOSTS`) skips the check for self-hosted installs and tests.
 */
export async function resolveSafeTarget(host: string, allowPrivate: boolean): Promise<SafeTarget> {
  const name = host.trim().replace(/^\[|\]$/g, '');
  if (!name) throw new BlockedHostError();
  const literal = isIP(name) !== 0;
  if (allowPrivate) return { connectHost: name, servername: literal ? undefined : name };
  if (literal) {
    if (isBlockedAddress(name)) throw new BlockedHostError();
    return { connectHost: name, servername: undefined };
  }
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(name, { all: true, verbatim: true });
  } catch {
    // Unresolvable: not a policy refusal, the connect fails the ordinary way.
    return { connectHost: name, servername: name };
  }
  if (answers.length === 0 || answers.some((a) => isBlockedAddress(a.address))) {
    throw new BlockedHostError();
  }
  return { connectHost: answers[0]!.address, servername: name };
}
