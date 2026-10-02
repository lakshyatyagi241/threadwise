import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { AiKeyResolver } from './ai-key-resolver.service';
import { AiModelsService } from './ai-models.service';
import { AiTokenMeter } from './ai-token-meter.service';
import { AiUsageService } from './ai-usage.service';
import { KeyVault } from './key-vault';
import { PlatformAiDashboardController, PlatformAiKeysController } from './platform-ai.controller';
import { PlatformKeysService } from './platform-keys.service';
import { WorkspaceKeysService } from './workspace-keys.service';
import {
  AiModelsController,
  AiUsageController,
  WorkspaceAiKeysController,
} from './workspace-ai.controller';

/**
 * AI provider keys, token metering and the AI usage screens (AIADM).
 *
 * Exports the two services every AI-using domain calls: AiKeyResolver (which key a call uses) and AiTokenMeter (the
 * ledger and the monthly cap). The platform door (PlatformStore) comes from the global auth module; the entitlement
 * resolver from the plans core. Registered in app.module.ts.
 */
@Module({
  imports: [PlansCoreModule],
  controllers: [
    PlatformAiKeysController,
    PlatformAiDashboardController,
    WorkspaceAiKeysController,
    AiUsageController,
    AiModelsController,
  ],
  providers: [
    CryptoService,
    KeyVault,
    PlatformKeysService,
    WorkspaceKeysService,
    AiKeyResolver,
    AiTokenMeter,
    AiUsageService,
    AiModelsService,
  ],
  exports: [AiKeyResolver, AiTokenMeter, AiModelsService],
})
export class AiKeysUsageAdminModule {}
