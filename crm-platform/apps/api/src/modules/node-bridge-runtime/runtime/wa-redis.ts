import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';

/** Where the runtime keeps what other processes need to see about a device. */
export const waKeys = {
  lease: (org: number, device: number) => `wa:device:${org}:${device}`,
  qr: (org: number, device: number) => `wa:qr:${org}:${device}`,
  code: (org: number, device: number) => `wa:code:${org}:${device}`,
  status: (org: number, device: number) => `wa:status:${org}:${device}`,
  initLock: (org: number, device: number) => `wa:init:${org}:${device}`,
  /** The pairing attempt in progress (who started it, how, until when). Written by the API; holds no secret. */
  attempt: (org: number, device: number) => `wa:attempt:${org}:${device}`,
  /** One per running worker: proof the runtime is alive (TW-NODE-004). */
  worker: (id: string) => `wa:worker:${id}`,
  commandChannel: 'wa:cmd',
  commandResult: (id: string) => `wa:cmd:res:${id}`,
} as const;

/**
 * How long a QR stays in Redis. WhatsApp rotates it about every 20 s, so a longer life only keeps a dead credential around (spec R6).
 * Stored as `{ qr, at }` so a client can show a countdown; the value is a secret and is never logged.
 */
export const QR_TTL_S = 45;
/** How long a pairing code is valid (WhatsApp's own window). */
export const CODE_TTL_S = 180;

export interface StoredQr {
  qr: string;
  at: number;
}
export interface StoredCode {
  code: string;
  at: number;
}

/** Parses a `wa:qr` value; null for nothing or for a value that is not the `{ qr, at }` shape. */
export function parseStoredQr(raw: string | null): StoredQr | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredQr>;
    return typeof v.qr === 'string' && typeof v.at === 'number' ? { qr: v.qr, at: v.at } : null;
  } catch {
    return null;
  }
}

const LEASE_MS = 90_000;

/**
 * One worker owns a device's socket at a time (TW-NODE-005, 011): two sockets for one number would fight over the session.
 * The lease expires by itself, so a worker that dies hands its devices to another one within a minute and a half.
 */
@Injectable()
export class DeviceLease {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** A token when the lease is taken, null when another worker holds it. */
  async acquire(org: number, device: number): Promise<string | null> {
    const token = randomUUID();
    return (await this.redis.set(waKeys.lease(org, device), token, 'PX', LEASE_MS, 'NX')) === 'OK'
      ? token
      : null;
  }

  /** True while the lease is still ours (and extended); false means another worker has it now. */
  async renew(org: number, device: number, token: string): Promise<boolean> {
    const ok = await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`,
      1,
      waKeys.lease(org, device),
      token,
      String(LEASE_MS),
    );
    return Number(ok) === 1;
  }

  async release(org: number, device: number, token: string): Promise<void> {
    await this.redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      waKeys.lease(org, device),
      token,
    );
  }

  async holder(org: number, device: number): Promise<string | null> {
    return this.redis.get(waKeys.lease(org, device));
  }
}
