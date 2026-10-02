import { Injectable, Logger } from '@nestjs/common';
import type { CredentialField } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { endpointProblem } from '../../infra/providers/localization-translation/endpoint-guard';
import { DRIVERS } from '../../infra/providers/localization-translation/drivers';
import type { Credentials } from '../../infra/providers/localization-translation/translation-driver.port';
import type { TranslationProviderSlug } from '@crm/contracts';

/**
 * Stored provider credentials (TW-I18N-015): a flat JSON map encrypted with the platform key (AES-GCM, the same
 * envelope every other stored secret uses). Secrets never leave the server; non-secret fields (a server URL, a contact
 * email) are echoed back so the form can be edited, as in Reference.
 */
@Injectable()
export class ProviderCredentials {
  private readonly logger = new Logger(ProviderCredentials.name);

  constructor(private readonly crypto: CryptoService) {}

  /** An undecryptable value reads as empty and is logged; Reference wiped it silently on the next save. */
  decrypt(slug: string, stored: string | null): Credentials {
    if (!stored) return {};
    try {
      const parsed = JSON.parse(this.crypto.decrypt(stored)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === 'string',
          ),
        );
      }
    } catch {
      this.logger.warn({ slug }, 'stored translation credentials could not be decrypted');
    }
    return {};
  }

  encrypt(creds: Credentials): string | null {
    return Object.keys(creds).length === 0 ? null : this.crypto.encrypt(JSON.stringify(creds));
  }

  /**
   * The new credential map: only keys the driver defines are accepted; a blank value keeps what is stored; `clear`
   * removes keys. Returns the validation problems alongside so the service can refuse before writing.
   */
  merge(
    slug: TranslationProviderSlug,
    existing: Credentials,
    supplied: Record<string, string> | undefined,
    clear: readonly string[] | undefined,
  ): { credentials: Credentials; problems: Array<{ path: string; message: string }> } {
    const spec = DRIVERS[slug].credentialFields;
    const known = new Set(spec.map((f) => f.key));
    const next: Credentials = { ...existing };
    const problems: Array<{ path: string; message: string }> = [];

    for (const [key, value] of Object.entries(supplied ?? {})) {
      if (!known.has(key)) continue;
      if (value.trim() !== '') next[key] = value.trim();
    }
    for (const key of clear ?? []) {
      if (known.has(key)) delete next[key];
    }
    if (next.endpoint) {
      const problem = endpointProblem(next.endpoint);
      if (problem) problems.push({ path: 'credentials.endpoint', message: problem });
    }
    return { credentials: next, problems };
  }

  /** The form the operator sees for one provider. */
  fields(slug: TranslationProviderSlug, creds: Credentials): CredentialField[] {
    return DRIVERS[slug].credentialFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      hint: f.hint,
      placeholder: f.placeholder,
      value: f.type === 'password' ? null : (creds[f.key] ?? null),
      hasValue: !!creds[f.key],
    }));
  }
}
