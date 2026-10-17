import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { FakeTelephonyProvider } from './fake-telephony.provider';
import { GenericTelephonyProvider } from './generic-telephony.provider';
import type { TelephonyProvider } from './telephony.port';

/**
 * Every telephony adapter, by the key stored on a connection. A vendor adapter is added to the constructor and nothing else changes: the
 * connection screen lists `available()`, the callback route and the click-to-call look a provider up with `get()`.
 */
@Injectable()
export class TelephonyProviderRegistry {
  private readonly byKey = new Map<string, TelephonyProvider>();

  constructor(
    generic: GenericTelephonyProvider,
    readonly fake: FakeTelephonyProvider,
    config: ConfigService<Env, true>,
  ) {
    this.byKey.set(generic.key, generic);
    // The fake rings nobody: it exists only where there is no production data to confuse it with.
    if (config.get('NODE_ENV', { infer: true }) !== 'production') this.byKey.set(fake.key, fake);
  }

  get(key: string): TelephonyProvider | undefined {
    return this.byKey.get(key);
  }

  available(): TelephonyProvider[] {
    return [...this.byKey.values()];
  }
}
