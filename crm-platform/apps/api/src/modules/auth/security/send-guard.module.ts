import { Global, Module } from '@nestjs/common';
import {
  OUTBOUND_SEND_GUARD,
  type OutboundSendGuard,
  type OutboundSendInput,
} from '../../../infra/providers/whatsapp/send-guard.port';
import { RequestContextStore } from '../../../common/context/request-context';
import { PlansCoreModule } from '../../plans-subscriptions-trials';
import { AuthModule } from '../auth.module';
import { BrandingFooterService } from './branding-footer.service';
import { EmergencyHaltService } from './emergency-halt.service';
import { SendPolicyService } from './send-policy.service';

/**
 * Binds the provider-side pre-send check to the auth domain's emergency halt
 * and guardrails. Imported by every process that can send (HTTP app, worker):
 * the WhatsApp provider requires the token, so a process without this module
 * fails to boot instead of sending unguarded.
 */
export class SendGuard implements OutboundSendGuard {
  constructor(
    private readonly policy: SendPolicyService,
    private readonly halt: EmergencyHaltService,
    private readonly footers: BrandingFooterService,
  ) {}

  async beforeSend(input: OutboundSendInput): Promise<void> {
    const orgId = input.orgId ?? RequestContextStore.peek()?.orgId ?? 0;
    if (orgId <= 0) {
      // No tenant to count against: the platform-wide halt still applies.
      await this.halt.assertNotHalted();
      return;
    }
    const context = { source: input.source };
    if (input.bulk) await this.policy.screenBulk(orgId, input.body ?? '', context);
    else await this.policy.screen(orgId, input.body ?? '', context);
  }

  async withFooter(input: { orgId?: number | null; body: string }): Promise<string> {
    const orgId = input.orgId ?? RequestContextStore.peek()?.orgId ?? 0;
    // No tenant: the platform default still applies, as in Reference (a send with no workspace).
    return this.footers.appendToBody(orgId > 0 ? orgId : 0, input.body);
  }
}

@Global()
@Module({
  imports: [AuthModule, PlansCoreModule],
  providers: [
    BrandingFooterService,
    {
      provide: OUTBOUND_SEND_GUARD,
      useFactory: (
        policy: SendPolicyService,
        halt: EmergencyHaltService,
        footers: BrandingFooterService,
      ) => new SendGuard(policy, halt, footers),
      inject: [SendPolicyService, EmergencyHaltService, BrandingFooterService],
    },
  ],
  // The footer service is exported so the worker that drains the outbox can hand it
  // `org.branding_footer.changed` events (see BrandingFooterService.onOutboxEvent).
  exports: [OUTBOUND_SEND_GUARD, BrandingFooterService],
})
export class SendGuardModule {}
