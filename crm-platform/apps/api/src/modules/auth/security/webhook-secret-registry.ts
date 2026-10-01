import { Injectable, Logger } from '@nestjs/common';

/**
 * Something that owns webhook signing secrets and can replace all of them
 * (the integrations domain's endpoints, a Shopify/Woo connection table, ...).
 * It returns how many secrets it rotated.
 */
export interface WebhookSecretRotator {
  /** Stable name recorded in the audit event. */
  readonly name: string;
  rotateAll(): Promise<number>;
}

export interface RotationResult {
  total: number;
  byRotator: Record<string, number>;
  /** Rotators that threw; the others still ran. */
  failed: string[];
}

/**
 * The seam behind the Security Center's "rotate every webhook secret" (WD-AUTH-039).
 * WaDesk rotated a column that did not exist and reported success; here the
 * action rotates exactly what the domains that store webhook secrets have
 * registered, and says how many. A domain registers itself once in
 * `onModuleInit`:
 *
 *   constructor(private readonly registry: WebhookSecretRegistry) {}
 *   onModuleInit() { this.registry.register({ name: 'webhooks', rotateAll: () => ... }); }
 */
@Injectable()
export class WebhookSecretRegistry {
  private readonly logger = new Logger(WebhookSecretRegistry.name);
  private readonly rotators = new Map<string, WebhookSecretRotator>();

  register(rotator: WebhookSecretRotator): void {
    this.rotators.set(rotator.name, rotator);
  }

  names(): string[] {
    return [...this.rotators.keys()];
  }

  async rotateAll(): Promise<RotationResult> {
    const result: RotationResult = { total: 0, byRotator: {}, failed: [] };
    for (const rotator of this.rotators.values()) {
      try {
        const n = await rotator.rotateAll();
        result.byRotator[rotator.name] = n;
        result.total += n;
      } catch (err) {
        this.logger.error({ err, rotator: rotator.name }, 'webhook secret rotation failed');
        result.failed.push(rotator.name);
      }
    }
    return result;
  }
}
