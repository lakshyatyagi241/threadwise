import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ConnectEngineRequest,
  type ConnectEngineResponse,
  type EngineKey,
  type EngineState,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  ENGINE_HANDSHAKE_PORT,
  type EngineHandshakePort,
} from '../../infra/providers/addons-extension-registry/engine-handshake.port';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { ExtensionStore } from './extension-store';
import { ModuleRegistryService } from './module-registry.service';

interface StoredEngine {
  url?: string;
  brand?: string;
  connected?: boolean;
  lastCheckAt?: string | null;
  lastError?: string | null;
}

const DOC = 'addons.engines';
const secretKey = (e: EngineKey) => `addons.engine.${e}.secret`;
const DEFAULT_BRAND: Record<EngineKey, string> = { instagram: 'IgDesk', email: 'MailTrixy' };

/** The native Instagram module's slug: the one identifier the engine rule needs (TW-ADD-021 rule 5). */
export const NATIVE_INSTAGRAM_SLUG = 'instagram';

/**
 * Connections to the standalone sibling products (TW-ADD-017..021): the remote Instagram engine and the email
 * engine. URL, display name and status are one platform setting; the shared secret is an encrypted platform secret
 * and is never returned or logged.
 *
 * "One Instagram engine at a time" is one predicate, `nativeInstagramActive()` (a native module is installed AND
 * on), used by the connect guard and the page alike, so a deactivated native module no longer shows the card as
 * blocked while the server would accept the connect (TW-ADD-021 QUIRK).
 */
@Injectable()
export class EngineConnectionService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly store: ExtensionStore,
    private readonly registry: ModuleRegistryService,
    private readonly audit: AuthAuditService,
    @Inject(ENGINE_HANDSHAKE_PORT) private readonly handshake: EngineHandshakePort,
  ) {}

  async nativeInstagramActive(): Promise<boolean> {
    return this.registry.isEnabled(NATIVE_INSTAGRAM_SLUG);
  }

  private async read(engine: EngineKey): Promise<StoredEngine> {
    const doc = await this.settings.get<Record<string, StoredEngine>>(DOC);
    return doc?.[engine] ?? {};
  }

  async state(engine: EngineKey): Promise<EngineState> {
    const s = await this.read(engine);
    return {
      engine,
      url: s.url ?? '',
      brand: s.brand || DEFAULT_BRAND[engine],
      connected: Boolean(s.connected) && Boolean(s.url),
      hasSecret: await this.settings.hasSecret(secretKey(engine)),
      lastCheckAt: s.lastCheckAt ?? null,
      lastError: s.lastError ?? null,
      blockedByNative: engine === 'instagram' && (await this.nativeInstagramActive()),
    };
  }

  /**
   * A remote engine counts only when it is connected AND its host is a different machine from this app: a URL that
   * points back at ourselves is the native module's own self-wiring and never blocks it (TW-ADD-003 rule 2).
   */
  async remoteInstagramActive(): Promise<{ active: boolean; brand: string }> {
    const s = await this.read('instagram');
    const brand = s.brand || 'InstaMagic';
    if (!s.connected || !s.url) return { active: false, brand };
    const host = hostOf(s.url);
    const own = hostOf(process.env.APP_URL ?? '');
    const local = !host || host === own || host === '127.0.0.1' || host === 'localhost';
    return { active: !local, brand };
  }

  async connect(engine: EngineKey, input: ConnectEngineRequest): Promise<ConnectEngineResponse> {
    const operatorId = this.operatorId();
    if (engine === 'instagram' && (await this.nativeInstagramActive())) {
      throw new AppError(
        ERROR_CODES.ADD_ENGINE_CONFLICT,
        'Instagram runs one engine at a time. Turn off the native Instagram add-on first, then connect a remote engine.',
        HttpStatus.CONFLICT,
      );
    }

    const url = trimUrl(input.url);
    const parsed = safeUrl(url);
    if (!parsed || parsed.username || parsed.password || !/^https?:$/.test(parsed.protocol)) {
      throw AppError.validation('Enter an http or https address without a username or password.', [
        { path: 'url', message: 'Enter an http or https address without a username or password.' },
      ]);
    }
    const brand = (input.brand ?? '').trim() || DEFAULT_BRAND[engine];

    // Saved BEFORE the handshake, so a failed test leaves the form filled in for a retry (TW-ADD-017 rule 3).
    const checkedAt = new Date().toISOString();
    await this.settings.mergeMember(DOC, engine, { url, brand, connected: false }, operatorId);
    if (input.secret && input.secret.trim()) {
      await this.settings.setSecret(secretKey(engine), input.secret.trim(), operatorId);
    }

    const secret = (await this.settings.getSecret(secretKey(engine))) ?? '';
    const result = await this.handshake.handshake({ engine, url, secret, brand });

    const message = result.ok
      ? `${brand} connected.`
      : `${brand} not connected - ${result.reason}.`;
    await this.settings.mergeMember(
      DOC,
      engine,
      { connected: result.ok, lastCheckAt: checkedAt, lastError: result.ok ? null : result.reason },
      operatorId,
    );
    await this.store.tx((tx) =>
      this.audit.record(tx, {
        event: `platform.engine.${engine}.connect`,
        status: result.ok ? 'success' : 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { engine, origin: parsed.origin, reason: result.reason },
      }),
    );
    return { ok: result.ok, message, engine: await this.state(engine) };
  }

  /** Wipes the URL and the secret and marks the engine off; the display name is kept. No call is made to the engine. */
  async disconnect(engine: EngineKey): Promise<ConnectEngineResponse> {
    const operatorId = this.operatorId();
    const before = await this.read(engine);
    await this.settings.mergeMember(
      DOC,
      engine,
      { url: '', connected: false, lastCheckAt: new Date().toISOString(), lastError: null },
      operatorId,
    );
    await this.settings.clearSecret(secretKey(engine));
    await this.store.tx((tx) =>
      this.audit.record(tx, {
        event: `platform.engine.${engine}.disconnect`,
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { engine },
      }),
    );
    return {
      ok: true,
      message: `${before.brand || DEFAULT_BRAND[engine]} disconnected.`,
      engine: await this.state(engine),
    };
  }

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, '');

function safeUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function hostOf(u: string): string {
  return safeUrl(u)?.hostname.toLowerCase() ?? '';
}
