import { Module } from '@nestjs/common';
import { AI_CHAT_PORT } from '../../infra/providers/chatbot-widget/ai-chat.port';
import { HttpAiChatAdapter } from '../../infra/providers/chatbot-widget/http-ai-chat.adapter';
import { NoLanguageHint, OpenWidgetPlanGate } from './_shims/open-gates';
import { SqlAssistantDirectory } from './_shims/sql-assistant-directory';
import { SqlInboxGateway } from './_shims/sql-inbox-gateway';
import {
  ASSISTANT_DIRECTORY,
  INBOX_GATEWAY,
  LANGUAGE_HINT,
  WIDGET_PLAN_GATE,
} from './_shims/tokens';
import { WidgetAiReplyService } from './widget-ai-reply.service';
import { WidgetPublicController } from './widget-public.controller';
import { WidgetPublicService } from './widget-public.service';
import { WidgetThrottleService } from './widget-throttle.service';
import { WidgetVisitorsRepository } from './widget-visitors.repository';
import { WidgetsController } from './widgets.controller';
import { WidgetsRepository } from './widgets.repository';
import { WidgetsService } from './widgets.service';

/**
 * Website chatbot widget (WGT): the admin screens' API and the public embed, chat and visitor endpoints. The shims bind
 * services other domains own (assistants, the team inbox and contacts, the plan flag, translation); each is replaced by
 * binding the real service to the same token (see _shims/README.md).
 */
@Module({
  controllers: [WidgetsController, WidgetPublicController],
  providers: [
    WidgetsService,
    WidgetsRepository,
    WidgetVisitorsRepository,
    WidgetPublicService,
    WidgetThrottleService,
    WidgetAiReplyService,
    { provide: AI_CHAT_PORT, useClass: HttpAiChatAdapter },
    { provide: ASSISTANT_DIRECTORY, useClass: SqlAssistantDirectory },
    { provide: INBOX_GATEWAY, useClass: SqlInboxGateway },
    { provide: WIDGET_PLAN_GATE, useClass: OpenWidgetPlanGate },
    { provide: LANGUAGE_HINT, useClass: NoLanguageHint },
  ],
})
export class ChatbotWidgetModule {}
