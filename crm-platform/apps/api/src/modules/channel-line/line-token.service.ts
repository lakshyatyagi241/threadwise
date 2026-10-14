import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { LINE_API, type LineApiFactory } from '../../infra/providers/channel-line/line.port';
import { clipError, isNumericChannelId } from './channel-rules';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import {
  MAX_TOKEN_SECONDS,
  buildAssertionJwt,
  rotatedTokenIsFresh,
  rotationConfigured,
} from './rotation-rules';

export type MintOutcome = { ok: true; token: string } | { ok: false; error: string };

/**
 * The bearer token every LINE call of a channel uses. A channel set up for rotation answers with its cached v2.1 token and mints a new
 * one, lazily, when that is missing or within a day of expiry (no schedule needed); otherwise it is the pasted long-lived token. It
 * never throws: when a renewal fails the channel falls back to the cached or long-lived token and records why on the channel.
 */
@Injectable()
export class LineTokenService {
  private readonly logger = new Logger(LineTokenService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly crypto: CryptoService,
    @Inject(LINE_API) private readonly line: LineApiFactory,
  ) {}

  async accessToken(orgId: number, channel: ChannelRow): Promise<string> {
    const longLived = this.crypto.decrypt(channel.channelAccessToken);
    if (!rotationConfigured(channel.assertionKid, channel.assertionPrivateKey)) return longLived;

    const cached = channel.rotatingToken ? this.crypto.decrypt(channel.rotatingToken) : null;
    if (rotatedTokenIsFresh(cached, channel.rotatingTokenExpiresAt, new Date()))
      return cached ?? longLived;

    const minted = await this.mint(orgId, channel);
    return minted.ok ? minted.token : (cached ?? longLived);
  }

  /** Signs an assertion with the channel's key, trades it for a v2.1 token and caches it. Records the reason on the channel when it fails. */
  async mint(orgId: number, channel: ChannelRow): Promise<MintOutcome> {
    const fail = async (error: string): Promise<MintOutcome> => {
      await this.db
        .txAs({ orgId }, (tx) => this.repo.setError(tx, orgId, channel.id, clipError(error)))
        .catch((err: unknown) => this.logger.warn({ err }, 'line rotation error not saved'));
      return { ok: false, error };
    };

    if (!isNumericChannelId(channel.lineChannelId)) {
      return fail('Token rotation: this channel has no numeric Channel ID.');
    }
    const jwt = buildAssertionJwt({
      channelId: channel.lineChannelId ?? '',
      kid: channel.assertionKid ?? '',
      privateKeyPem: channel.assertionPrivateKey
        ? this.crypto.decrypt(channel.assertionPrivateKey)
        : '',
    });
    if (jwt === '') return fail('Token rotation: could not sign the assertion JWT (bad key).');

    const issued = await this.line.issueRotatingToken(jwt);
    if (!issued.ok || !issued.data) {
      return fail(`Token rotation failed: ${(issued.error ?? 'unknown').slice(0, 200)}`);
    }
    const seconds = Math.max(60, issued.data.expiresIn || MAX_TOKEN_SECONDS);
    await this.db.txAs({ orgId }, (tx) =>
      this.repo.saveRotatedToken(tx, orgId, channel.id, {
        token: this.crypto.encrypt(issued.data!.accessToken),
        keyId: this.crypto.encrypt(issued.data!.keyId),
        expiresAt: new Date(Date.now() + seconds * 1000),
      }),
    );
    return { ok: true, token: issued.data.accessToken };
  }
}
