import { Module } from '@nestjs/common';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import { AuthModule } from '../../../../auth';
import { ChatConversationsModule } from '../../../../chat-conversations';
import { CrmModule } from '../../../../crm';
import { TeamInboxConversationsModule } from '../../../../team-inbox-conversations';
import { TeamInboxRoutingSlaModule } from '../../../../team-inbox-routing-sla';
import { ActionNodes } from './actions-nodes';
import { AskInputNode } from './ask-input-node';
import { AskMediaNodes } from './ask-media-nodes';
import { CrmNodes } from '../crm/crm-nodes';
import { NumberSender } from './number-sender.service';
import { SocialHandoffNode } from './social-handoff-node';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({
  imports: [
    AuthModule,
    ChatConversationsModule,
    CrmModule,
    TeamInboxConversationsModule,
    TeamInboxRoutingSlaModule,
  ],
  providers: [
    ActionNodes,
    AskMediaNodes,
    AskInputNode,
    SocialHandoffNode,
    CrmNodes,
    NumberSender,
    SafeFetch,
  ],
  exports: [ActionNodes, AskMediaNodes, AskInputNode, SocialHandoffNode, CrmNodes],
})
export class ActionNodesModule {}
