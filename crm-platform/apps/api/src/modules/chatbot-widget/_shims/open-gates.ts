import { Injectable } from '@nestjs/common';
import type { LanguageHint, WidgetPlanGate } from './tokens';

/**
 * `access_chatbot_widgets` is not in the plan catalogue yet (the plans domain owns it), so the flag check passes. WaDesk
 * also never enforced `chatbot_widgets_limit`, and neither does this port.
 */
@Injectable()
export class OpenWidgetPlanGate implements WidgetPlanGate {
  isEnabled(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** No real-time translation until the localization domain exposes its config: the prompt gets no language hint. */
@Injectable()
export class NoLanguageHint implements LanguageHint {
  replyLanguage(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
