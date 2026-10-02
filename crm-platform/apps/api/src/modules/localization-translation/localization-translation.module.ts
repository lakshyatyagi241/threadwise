import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  RedisTranslationStores,
  TRANSLATION_BREAKER,
  TRANSLATION_CACHE,
} from '../../infra/providers/localization-translation/redis-stores';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import {
  CONVERSATION_MESSAGE_STORE,
  PgConversationMessageStore,
} from './conversation-message-store';
import { ConversationTranslationService } from './conversation-translation.service';
import { KEYWORD_RULE_STORE, PgKeywordRuleStore } from './keyword-rule-store';
import { KeywordTranslationService } from './keyword-translation.service';
import {
  MyLocaleController,
  PlatformLanguagesController,
  PublicLanguagesController,
} from './languages.controller';
import { LanguagesService } from './languages.service';
import { ProviderCredentials } from './provider-credentials';
import { ProviderRouterService } from './provider-router.service';
import { ProvidersAdminService } from './providers-admin.service';
import { TranslationPlatformController } from './translation-platform.controller';
import { TranslationSettingsController } from './translation-settings.controller';
import { TranslationSettingsService } from './translation-settings.service';
import { TranslationUsageService } from './translation-usage.service';
import { TranslationService } from './translation.service';

/**
 * Localization and auto-translation (TW-I18N): the language registry and each caller's locale, the translation
 * providers and their routing, the translate service other domains call, the usage ledger, and the workspace's
 * translation settings. It reaches the platform tables only through the auth module's PlatformStore.
 * Registered in app.module.ts.
 */
@Module({
  imports: [PlansCoreModule],
  controllers: [
    PlatformLanguagesController,
    PublicLanguagesController,
    MyLocaleController,
    TranslationPlatformController,
    TranslationSettingsController,
  ],
  providers: [
    CryptoService,
    {
      provide: TRANSLATION_CACHE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisTranslationStores(redis),
    },
    { provide: TRANSLATION_BREAKER, useExisting: TRANSLATION_CACHE },
    LanguagesService,
    ProviderCredentials,
    ProviderRouterService,
    ProvidersAdminService,
    TranslationUsageService,
    TranslationService,
    TranslationSettingsService,
    { provide: CONVERSATION_MESSAGE_STORE, useClass: PgConversationMessageStore },
    { provide: KEYWORD_RULE_STORE, useClass: PgKeywordRuleStore },
    ConversationTranslationService,
    KeywordTranslationService,
  ],
  exports: [
    TranslationService,
    ConversationTranslationService,
    KeywordTranslationService,
    LanguagesService,
  ],
})
export class LocalizationTranslationModule {}
