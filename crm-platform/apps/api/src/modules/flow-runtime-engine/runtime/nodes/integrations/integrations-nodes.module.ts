import { Module } from '@nestjs/common';
import { ApiLibraryModule } from '../../../../api-library';
import { CrmModule } from '../../../../crm';
import { GoogleAccountModule } from '../../../../google-account';
import {
  AI_CALL,
  AiCallUnavailable,
} from '../../../../../infra/providers/flow-runtime-engine/ai-call.port';
import {
  MYSQL_QUERY,
  MysqlDriverUnavailable,
} from '../../../../../infra/providers/flow-runtime-engine/mysql-query.port';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import { FlowRefResolver } from '../flow-refs';
import { ApiLibraryNodes } from './api-library-node';
import { IntegrationNodes } from './integrations-nodes';

/**
 * Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one).
 *
 * Provider wiring: Google is the workspace's one Google account (`GoogleAccountModule` binds `GOOGLE_WORKSPACE` over its grant; a
 * workspace with nothing connected gets a step that FAILS with `GOOGLE_ACCOUNT_NOT_CONNECTED` and "Connect Google" in the run log and run view; Reference went on silently). MySQL has
 * no driver installed and the calling domain is not wired to flows: those two defaults fail with a stated reason.
 */
@Module({
  imports: [CrmModule, ApiLibraryModule, GoogleAccountModule],
  providers: [
    SafeFetch,
    FlowRefResolver,
    IntegrationNodes,
    ApiLibraryNodes,
    { provide: MYSQL_QUERY, useClass: MysqlDriverUnavailable },
    { provide: AI_CALL, useClass: AiCallUnavailable },
  ],
  exports: [IntegrationNodes, ApiLibraryNodes, MYSQL_QUERY, AI_CALL],
})
export class IntegrationNodesModule {}
