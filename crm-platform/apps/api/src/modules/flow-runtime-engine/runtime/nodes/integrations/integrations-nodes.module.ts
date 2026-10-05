import { Module } from '@nestjs/common';
import {
  AI_CALL,
  AiCallUnavailable,
} from '../../../../../infra/providers/flow-runtime-engine/ai-call.port';
import { HttpGoogleWorkspace } from '../../../../../infra/providers/flow-runtime-engine/google-workspace.http.adapter';
import {
  GOOGLE_ACCESS_TOKENS,
  GOOGLE_WORKSPACE,
  NoGoogleAccount,
  type GoogleAccessTokens,
} from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';
import {
  MYSQL_QUERY,
  MysqlDriverUnavailable,
} from '../../../../../infra/providers/flow-runtime-engine/mysql-query.port';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import { FlowRefResolver } from '../flow-refs';
import { IntegrationNodes } from './integrations-nodes';

/**
 * Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one).
 *
 * Provider wiring: Google calls the REST APIs with the workspace's token, and no token store exists yet (`NoGoogleAccount`), so
 * the nodes report "no Google account connected" until one is bound to GOOGLE_ACCESS_TOKENS. MySQL has no driver installed and the
 * calling domain is not wired to flows: those two defaults fail with a stated reason. Rebind the tokens to go live.
 */
@Module({
  providers: [
    SafeFetch,
    FlowRefResolver,
    IntegrationNodes,
    { provide: MYSQL_QUERY, useClass: MysqlDriverUnavailable },
    { provide: AI_CALL, useClass: AiCallUnavailable },
    { provide: GOOGLE_ACCESS_TOKENS, useClass: NoGoogleAccount },
    {
      provide: GOOGLE_WORKSPACE,
      useFactory: (tokens: GoogleAccessTokens) => new HttpGoogleWorkspace(tokens),
      inject: [GOOGLE_ACCESS_TOKENS],
    },
  ],
  exports: [IntegrationNodes, GOOGLE_ACCESS_TOKENS, MYSQL_QUERY, AI_CALL],
})
export class IntegrationNodesModule {}
