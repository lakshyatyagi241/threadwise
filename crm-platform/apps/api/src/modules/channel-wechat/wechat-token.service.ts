import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TOKEN_ERRCODES,
  WECHAT_API,
  type WechatApi,
  type WechatResult,
} from '../../infra/providers/channel-wechat/wechat.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { clipError, tokenIsFresh, tokenLifetimeSeconds } from './wechat-rules';

const LOCK_MS = 15_000;
const WAIT_MS = 10_000;
const POLL_MS = 150;

const NO_TOKEN = 'no access_token';

const unavailable = <T>(): WechatResult<T> => ({
  ok: false,
  data: {} as T,
  errcode: null,
  error: NO_TOKEN,
});

/**
 * The account's access token (WECH). WeChat issues ONE per Official Account and fetching a new one invalidates the previous one, so it is
 * cached on the channel row (encrypted, with its expiry) and refreshed under a lock: two webhooks or two workers that both fetch would
 * kill each other's token. `call` runs a WeChat request with the token and, when WeChat says the token is no longer valid, refreshes it
 * once and tries again. Never throws; a channel that cannot get a token is an expected outcome (a wrong secret, an IP not allowed).
 */
@Injectable()
export class WechatTokenService {
  private readonly logger = new Logger(WechatTokenService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly crypto: CryptoService,
    @Inject(WECHAT_API) private readonly wechat: WechatApi,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private fresh(row: ChannelRow): string | null {
    const token = row.cachedAccessToken ? this.crypto.decrypt(row.cachedAccessToken) : null;
    return tokenIsFresh(token, row.tokenExpiresAt) ? token : null;
  }

  private read(orgId: number, id: number): Promise<ChannelRow | undefined> {
    return this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, id));
  }

  /** A valid token for the channel, fetching one when the cached one is missing or about to expire. Null when none can be had. */
  async activeToken(orgId: number, id: number): Promise<string | null> {
    const row = await this.read(orgId, id);
    if (!row) return null;
    return this.fresh(row) ?? this.refresh(orgId, row);
  }

  /** Fetches a new token under a lock and caches it. Falls back to whatever token is cached when WeChat refuses. */
  private async refresh(orgId: number, row: ChannelRow): Promise<string | null> {
    const key = `wechat:token:${orgId}:${row.id}`;
    const lock = await this.acquire(key);
    const owner = lock === 'busy' ? null : lock;
    try {
      // Another process may have refreshed while this one waited for the lock.
      const current = (await this.read(orgId, row.id)) ?? row;
      const cached = this.fresh(current);
      if (cached) return cached;
      // Someone else has held the lock for the whole wait: fetching now would invalidate the token they are about to save.
      if (lock === 'busy') {
        return current.cachedAccessToken ? this.crypto.decrypt(current.cachedAccessToken) : null;
      }

      const res = await this.wechat.fetchAccessToken(
        current.appId ?? '',
        this.crypto.decrypt(current.appSecret),
      );
      if (res.ok && res.data.accessToken) {
        const expiresAt = new Date(Date.now() + tokenLifetimeSeconds(res.data.expiresIn) * 1000);
        await this.db.txAs({ orgId }, (tx) =>
          this.repo.saveToken(
            tx,
            orgId,
            current.id,
            this.crypto.encrypt(res.data.accessToken),
            expiresAt,
          ),
        );
        return res.data.accessToken;
      }
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.setError(
          tx,
          orgId,
          current.id,
          clipError(`access_token: ${(res.error ?? 'unknown').slice(0, 200)}`),
        ),
      );
      return current.cachedAccessToken ? this.crypto.decrypt(current.cachedAccessToken) : null;
    } catch (err) {
      this.logger.warn({ err, orgId, channel: row.id }, 'wechat token refresh failed');
      return null;
    } finally {
      if (owner) await this.release(key, owner);
    }
  }

  /** Forces a new token now (the "Re-check" button). Returns whether WeChat gave one. */
  async recheck(orgId: number, id: number): Promise<boolean> {
    await this.db.txAs({ orgId }, (tx) => this.repo.expireToken(tx, orgId, id));
    const row = await this.read(orgId, id);
    if (!row) return false;
    await this.refresh(orgId, row);
    return (await this.read(orgId, id))?.lastError === null;
  }

  /** Runs a WeChat request with the channel's token; one refresh and retry when WeChat says the token is no longer valid. */
  async call<T>(
    orgId: number,
    id: number,
    request: (token: string) => Promise<WechatResult<T>>,
  ): Promise<WechatResult<T>> {
    const token = await this.activeToken(orgId, id);
    if (!token) return unavailable<T>();
    const first = await request(token);
    if (first.ok || first.errcode === null || !TOKEN_ERRCODES.includes(first.errcode)) return first;

    await this.db.txAs({ orgId }, (tx) => this.repo.expireToken(tx, orgId, id));
    const again = await this.activeToken(orgId, id);
    return again ? request(again) : first;
  }

  /** A lock on one channel's refresh, waited for up to ten seconds: the holder's id, `busy` when someone else kept it that long, or null when Redis is down (the refresh then runs unlocked). */
  private async acquire(key: string): Promise<string | 'busy' | null> {
    try {
      const owner = `${process.pid}:${Date.now()}:${Math.random()}`;
      const until = Date.now() + WAIT_MS;
      for (;;) {
        if ((await this.redis.set(key, owner, 'PX', LOCK_MS, 'NX')) === 'OK') return owner;
        if (Date.now() >= until) return 'busy';
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch {
      return null;
    }
  }

  private async release(key: string, owner: string): Promise<void> {
    try {
      // Only the holder frees it: a lock that expired and was taken by another process is left alone.
      await this.redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        key,
        owner,
      );
    } catch {
      /* the lock expires by itself */
    }
  }
}
