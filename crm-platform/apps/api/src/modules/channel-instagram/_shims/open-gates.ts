import { Injectable } from '@nestjs/common';
import type { InstagramAutomation, InstagramPlanGate, MediaUrls } from './tokens';

/** `access_instagram` is not in the plan catalogue yet, so every check passes. */
@Injectable()
export class OpenInstagramPlanGate implements InstagramPlanGate {
  assertChannel(): Promise<void> {
    return Promise.resolve();
  }
}

/** No auto-reply domain yet: nothing replies to an Instagram message. */
@Injectable()
export class NoInstagramAutomation implements InstagramAutomation {
  automate(): Promise<void> {
    return Promise.resolve();
  }
}

/** No storage domain yet: only an address that is already public can be sent as an attachment. */
@Injectable()
export class PublicOnlyMediaUrls implements MediaUrls {
  publicUrl(path: string): string | null {
    return /^https?:\/\//i.test(path) ? path : null;
  }
}
