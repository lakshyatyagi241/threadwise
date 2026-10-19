import { Module } from '@nestjs/common';
import { LocalTrainingFileStore } from '../../infra/providers/ai-agents-training/local-training-file-store.adapter';
import { TRAINING_FILE_STORE } from '../../infra/providers/ai-agents-training/training-file-store.port';
import { KnowledgeBaseModule } from '../knowledge-base';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { AgentSavedRepliesService } from './agent-saved-replies.service';
import { AiTrainingController } from './ai-training.controller';
import { AssistantsRepository } from './assistants.repository';
import { AssistantsService } from './assistants.service';
import { ResponderService } from './responder.service';
import { SourcesRepository } from './sources.repository';
import { SourcesService } from './sources.service';

/**
 * AI Training (AIAG): the management side of the trained chat assistants and their knowledge. The flow runtime's AI node and the chatbot
 * widget already read `ai_chat_assistants` and `ai_training_sources` (ready entries only, their own workspace); this module is what
 * writes them. URL entries are read in the worker (`AiAgentsTrainingWorkerModule`). Registered in app.module.ts.
 */
@Module({
  imports: [PlansCoreModule, TeamInboxConversationsModule, KnowledgeBaseModule],
  controllers: [AiTrainingController],
  providers: [
    AssistantsService,
    AssistantsRepository,
    SourcesService,
    SourcesRepository,
    ResponderService,
    AgentSavedRepliesService,
    { provide: TRAINING_FILE_STORE, useClass: LocalTrainingFileStore },
  ],
  exports: [AgentSavedRepliesService],
})
export class AiAgentsTrainingModule {}
