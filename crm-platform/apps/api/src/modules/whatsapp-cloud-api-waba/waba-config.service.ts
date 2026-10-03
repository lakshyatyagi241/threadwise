import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { SettingsService } from '../platform-settings-branding-storage';

/** How often each process re-reads the saved settings, so a save in the console reaches workers too without a restart. */
const REFRESH_MS = 15_000;

/**
 * TW-WABA-001: the Meta app and Interakt partner values saved on the console's WhatsApp page override the environment.
 *
 * Every reader (WabaHttp, the admin client, the connect and webhook services) already reads the parsed `WABA_ENV` object on
 * each call, so this service rewrites that one object in place: a saved non-empty value wins, anything else falls back to the
 * value the process started with. Nothing saved means the environment is untouched. Same precedence as the mail settings.
 */
@Injectable()
export class WabaConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WabaConfigService.name);
  private readonly base: WabaEnv;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(WABA_ENV) private readonly env: WabaEnv,
    private readonly settings: SettingsService,
  ) {
    this.base = { ...env };
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      const next: Partial<WabaEnv> = { ...this.base };
      if (await this.settings.isSaved('whatsapp')) {
        const v = await this.settings.values('whatsapp');
        const secret = (field: string) => this.settings.secret('whatsapp', field);
        const set = <K extends keyof WabaEnv>(
          key: K,
          value: WabaEnv[K] | '' | null | undefined,
        ) => {
          if (value !== '' && value !== null && value !== undefined)
            next[key] = value as WabaEnv[K];
        };
        set('META_APP_ID', v.appId);
        set('META_APP_SECRET', await secret('appSecret'));
        set('META_EMBEDDED_CONFIG_ID', v.configId);
        set('META_API_VERSION', v.graphVersion);
        set('INTERAKT_API_VERSION', v.graphVersion);
        set('INTERAKT_SOLUTION_ID', v.solutionId);
        set('INTERAKT_PARTNER_AUTH_KEY', await secret('partnerAuthKey'));
        set('META_SYSTEM_USER_ID', v.systemUserId);
        set('META_SYSTEM_USER_TOKEN', await secret('systemUserToken'));
        set('META_BUSINESS_ID', v.businessId);
        set('WABA_VERIFY_TOKEN', await secret('verifyToken'));
        set('WABA_DEFAULT_PROVIDER', v.defaultProvider);
        // Booleans have no "blank": a saved page decides them.
        next.WABA_COEXISTENCE = v.coexistence;
        next.WABA_REQUIRE_INTERAKT_SIGNATURE =
          v.requireSignature || this.base.WABA_REQUIRE_INTERAKT_SIGNATURE;
      }
      // A key the environment never had must go away again when its saved value is cleared.
      for (const k of Object.keys(this.env) as Array<keyof WabaEnv>)
        if (!(k in next)) delete this.env[k];
      Object.assign(this.env, next);
    } catch (e) {
      // A settings outage must not stop WhatsApp: keep what is in memory.
      this.logger.warn(
        { err: (e as Error).message },
        'could not refresh WhatsApp platform settings',
      );
    }
  }
}
