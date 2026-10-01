import { Global, Module } from '@nestjs/common';
import {
  OUTBOUND_SEND_GUARD,
  type OutboundSendGuard,
  type OutboundSendInput,
} from '../../../infra/providers/whatsapp/send-guard.port';
import { RequestContextStore } from '../../../common/context/request-context';
import { AuthModule } from '../auth.module';
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
}

@Global()
@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: OUTBOUND_SEND_GUARD,
      useFactory: (policy: SendPolicyService, halt: EmergencyHaltService) =>
        new SendGuard(policy, halt),
      inject: [SendPolicyService, EmergencyHaltService],
    },
  ],
  exports: [OUTBOUND_SEND_GUARD],
})
export class SendGuardModule {}
