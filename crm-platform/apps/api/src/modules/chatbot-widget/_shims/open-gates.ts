import { Injectable } from '@nestjs/common';
import type { LanguageHint } from './tokens';

/** No real-time translation until the localization domain exposes its config: the prompt gets no language hint. */
@Injectable()
export class NoLanguageHint implements LanguageHint {
  replyLanguage(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
