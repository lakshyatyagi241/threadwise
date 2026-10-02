import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type LicenceStatus } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { INST_ENV, type InstEnv } from '../../config/domains/install-update-licensing.env';
import { PlatformSettingsService } from '../auth';

/** Injection token for the HTTP client, so tests can stand in for api.envato.com. */
export const INST_FETCH = Symbol('INST_FETCH');
export type FetchLike = typeof fetch;

const ENVATO_SALE_URL = 'https://api.envato.com/v3/market/author/sale';
const TIMEOUT_MS = 20_000;

const CODE_KEY = 'inst.licence.code';
const META_KEY = 'inst.licence';

/** Why a check failed: the browser turns each into its own localised sentence (never parsed from text). */
export type LicenceFailure =
  'empty' | 'not_configured' | 'unreachable' | 'not_found' | 'http_error' | 'other_product';

export type LicenceVerdict = { ok: true } | { ok: false; reason: LicenceFailure; status?: number };

/**
 * Purchase-code verification (WD-INST-003, -017, -020).
 *
 * Off by default (LICENCE_MODE): this platform is not sold on CodeCanyon, so by default there is nothing to verify and
 * no step in the wizard. When a deployment does enforce a code, the item id and the author token come from the
 * environment at call time. WaDesk shipped both inside the product, decryptable by any buyer; here neither is in the
 * image, and the token is never logged or returned.
 *
 * The code itself is a secret: kept sealed in the platform settings, never echoed back (the Updater shows a mask).
 */
@Injectable()
export class LicenceService {
  constructor(
    @Inject(INST_ENV) private readonly env: InstEnv,
    @Inject(INST_FETCH) private readonly http: FetchLike,
    private readonly settings: PlatformSettingsService,
  ) {}

  get required(): boolean {
    return this.env.LICENCE_MODE === 'envato';
  }

  /** The Envato lookup, with WaDesk's outcomes: empty, unconfigured, unreachable, 404, other status, other item. */
  async check(rawCode: string): Promise<LicenceVerdict> {
    const code = rawCode.trim();
    if (!code) return { ok: false, reason: 'empty' };
    const { ENVATO_AUTHOR_TOKEN: token, ENVATO_ITEM_ID: item } = this.env;
    if (!token) return { ok: false, reason: 'not_configured' };

    let res: Response;
    try {
      res = await this.http(`${ENVATO_SALE_URL}?code=${encodeURIComponent(code)}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Platform-Installer' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The raw error can carry the request URL (and with it the code): say only that Envato was not reached.
      return { ok: false, reason: 'unreachable' };
    }
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

    const body = (await res.json().catch(() => null)) as { item?: { id?: unknown } } | null;
    const sold = body?.item?.id === undefined ? '' : String(body.item.id);
    // Compared only when both sides are known, as in WaDesk.
    if (item && sold && sold !== item) return { ok: false, reason: 'other_product' };
    return { ok: true };
  }

  /** Verifies and throws the problem the browser branches on; used by the wizard and the Updater. */
  async verifyOrThrow(code: string): Promise<void> {
    this.assertVerdict(await this.check(code));
  }

  assertVerdict(verdict: LicenceVerdict): void {
    if (verdict.ok) return;
    throw new AppError(
      ERROR_CODES.SETUP_LICENCE_INVALID,
      'The purchase code could not be verified.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'purchaseCode', message: verdict.reason }],
    );
  }

  /** Persists a code that was just verified, with the time (WaDesk: `envato_purchase_code`, `envato_verified_at`). */
  async remember(code: string, operatorId: number | null): Promise<Date> {
    const at = new Date();
    await this.settings.setSecret(CODE_KEY, code.trim(), operatorId);
    await this.settings.set(META_KEY, { verifiedAt: at.toISOString() }, operatorId);
    return at;
  }

  async status(): Promise<LicenceStatus> {
    const meta = await this.settings.get<{ verifiedAt?: string }>(META_KEY);
    const verifiedAt = meta?.verifiedAt ?? null;
    return {
      required: this.required,
      verified: verifiedAt !== null && (await this.settings.hasSecret(CODE_KEY)),
      verifiedAt,
    };
  }
}
