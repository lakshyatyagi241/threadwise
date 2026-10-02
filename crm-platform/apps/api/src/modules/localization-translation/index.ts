/**
 * Public surface of the localization-translation domain. Other modules (auto-reply, inbox, AI, widget) import from
 * here, never from the files behind it.
 */
export { LocalizationTranslationModule } from './localization-translation.module';
export { TranslationService } from './translation.service';
export { type TranslationContext } from './provider-router.service';
export {
  ConversationTranslationService,
  type ConversationTranslationConfig,
  type InboundInput,
  type InboundOutcome,
  type OutboundInput,
  type OutboundOutcome,
} from './conversation-translation.service';
export { LanguagesService } from './languages.service';
export { detectScriptLanguage, isLatin, languageDisplayName } from './language-detector';
export { lookupCommonPhrase } from './common-phrases';
