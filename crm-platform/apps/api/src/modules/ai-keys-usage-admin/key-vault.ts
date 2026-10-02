import { Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { lastFour } from './ai-rules';

export type KeyRead =
  { state: 'none' } | { state: 'unreadable' } | { state: 'readable'; key: string };

/**
 * Provider keys at rest (TW-AIADM-006): sealed with the credentials key before they are stored, opened on read.
 * A value that cannot be opened (the encryption key changed, the cell was edited by hand) reads as "no key" and is
 * logged with the caller's reference, never thrown: one stale row must not break a whole page or every AI feature.
 * The plaintext never leaves this class except to the caller that is about to use it, and is never logged.
 */
@Injectable()
export class KeyVault {
  private readonly logger = new Logger(KeyVault.name);

  constructor(private readonly crypto: CryptoService) {}

  seal(plain: string): { cipher: string; last4: string | null } {
    return { cipher: this.crypto.encrypt(plain), last4: lastFour(plain) };
  }

  /** `ref` names the row in the warning (a provider slug or a row uuid): never the value. */
  read(cipher: string | null | undefined, ref: string): KeyRead {
    if (cipher === null || cipher === undefined || cipher === '') return { state: 'none' };
    try {
      const key = this.crypto.decrypt(cipher);
      return key === '' ? { state: 'none' } : { state: 'readable', key };
    } catch {
      this.logger.warn(
        { ref },
        'a stored AI provider key could not be decrypted; treating it as absent',
      );
      return { state: 'unreadable' };
    }
  }
}
