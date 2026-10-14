import { Module } from '@nestjs/common';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { leadScoringAiProvider } from '../lead-scoring';
import { PqlController } from './pql.controller';
import { PqlService } from './pql.service';

/** Plain English contact search (PQL). Uses lead scoring's AI driver (OpenRouter, or the offline fixture, never in production). */
@Module({
  imports: [AiKeysUsageAdminModule],
  controllers: [PqlController],
  providers: [leadScoringAiProvider, PqlService],
})
export class ContactsPqlModule {}
