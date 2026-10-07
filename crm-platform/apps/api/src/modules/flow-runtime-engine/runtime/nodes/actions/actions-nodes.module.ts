import { Module } from '@nestjs/common';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import { ChatConversationsModule } from '../../../../chat-conversations';
import { CrmModule } from '../../../../crm';
import { TeamInboxConversationsModule } from '../../../../team-inbox-conversations';
import { TeamInboxRoutingSlaModule } from '../../../../team-inbox-routing-sla';
import { ActionNodes } from './actions-nodes';
import { AskInputNode } from './ask-input-node';
import { AskMediaNodes } from './ask-media-nodes';
import { NumberSender } from './number-sender.service';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({
  imports: [
    ChatConversationsModule,
    CrmModule,
    TeamInboxConversationsModule,
    TeamInboxRoutingSlaModule,
  ],
  providers: [ActionNodes, AskMediaNodes, AskInputNode, NumberSender, SafeFetch],
  exports: [ActionNodes, AskMediaNodes, AskInputNode],
})
export class ActionNodesModule {}
