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
  type ThreadTranslationFields,
  visibleTranslation,
} from './conversation-translation.service';
export {
  CONVERSATION_MESSAGE_STORE,
  type ConversationMessageStore,
  type StoredMessage,
} from './conversation-message-store';
export { KeywordTranslationService } from './keyword-translation.service';
export {
  KEYWORD_RULE_STORE,
  type KeywordContent,
  type KeywordRule,
  type KeywordRuleStore,
  type TranslatedRule,
} from './keyword-rule-store';
export {
  DEFAULT_TARGETS,
  matchesTranslation,
  replyLanguage,
  targetsFor,
} from './keyword-translation';
export { LanguagesService } from './languages.service';
export { detectScriptLanguage, isLatin, languageDisplayName } from './language-detector';
export { lookupCommonPhrase } from './common-phrases';
