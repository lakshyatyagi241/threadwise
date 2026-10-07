import { CanActivate, Inject, Injectable } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';

/**
 * Every route of the personal-number devices API first asks the engine gate (the platform switch is on AND this workspace is on the
 * allow-list): 422 WA_UNOFFICIAL_DISABLED otherwise (runbook whatsapp-unofficial-switch.md). It runs after the global authentication and
 * permission guards, so a caller who may not use the route at all is refused for that reason first, and before any database read.
 */
@Injectable()
export class UnofficialEngineGuard implements CanActivate {
  constructor(@Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate) {}

  async canActivate(): Promise<boolean> {
    const ctx = RequestContextStore.peek();
    if (!ctx || !(ctx.orgId > 0)) return true;
    await this.gate.assertEnabledFor(ctx.orgId);
    return true;
  }
}
