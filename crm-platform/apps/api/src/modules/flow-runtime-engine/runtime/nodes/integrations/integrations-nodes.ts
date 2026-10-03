import { Inject, Injectable } from '@nestjs/common';
import {
  AI_CALL,
  type AiCallPort,
} from '../../../../../infra/providers/flow-runtime-engine/ai-call.port';
import {
  GOOGLE_WORKSPACE,
  type GoogleWorkspacePort,
} from '../../../../../infra/providers/flow-runtime-engine/google-workspace.port';
import {
  MYSQL_QUERY,
  type MysqlQueryPort,
} from '../../../../../infra/providers/flow-runtime-engine/mysql-query.port';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import type {
  CustomDecision,
  InboundReply,
  NodeContext,
  NodeExecutor,
  NodeResult,
} from '../../types';
import { runAiCall, runCode, runMysql } from './data-nodes';
import {
  GOOGLE_FORM_HANDLER,
  onGoogleFormReply,
  runDocs,
  runForm,
  runMeet,
  runSheets,
} from './google-nodes';
import { runWebhook } from './webhook-node';

/**
 * Node group `integrations` (WD-FLR-032 to 034, 044 to 048): Webhook, Code, MySQL, the four Google nodes and the AI voice call. Each
 * node reaches its provider through a port (guarded HTTP, the sandbox, a MySQL driver, Google, the calling domain), so a provider
 * that is down or not connected is a note in the run log and the flow moves on, as in WaDesk.
 */
@Injectable()
export class IntegrationNodes implements NodeExecutor {
  readonly types: readonly string[] = [
    'Webhook',
    'Code',
    'MySQL',
    'GoogleSheets',
    'GoogleDocs',
    'GoogleForm',
    'GoogleMeet',
    'AiCall',
  ];

  constructor(
    private readonly safeFetch: SafeFetch,
    @Inject(MYSQL_QUERY) private readonly mysql: MysqlQueryPort,
    @Inject(GOOGLE_WORKSPACE) private readonly google: GoogleWorkspacePort,
    @Inject(AI_CALL) private readonly calls: AiCallPort,
  ) {}

  async execute(ctx: NodeContext): Promise<NodeResult> {
    switch (ctx.node.type) {
      case 'Webhook':
        return runWebhook(ctx, this.safeFetch);
      case 'Code':
        return runCode(ctx);
      case 'MySQL':
        return runMysql(ctx, this.mysql, this.safeFetch);
      case 'GoogleSheets':
        return runSheets(ctx, this.google);
      case 'GoogleDocs':
        return runDocs(ctx, this.google);
      case 'GoogleMeet':
        return runMeet(ctx, this.google);
      case 'GoogleForm':
        return runForm(ctx, this.google);
      case 'AiCall':
        return runAiCall(ctx, this.calls);
      default:
        return { kind: 'advance', port: 1 };
    }
  }

  async onReply(ctx: NodeContext, reply: InboundReply): Promise<CustomDecision> {
    return ctx.run.wait?.handler === GOOGLE_FORM_HANDLER
      ? onGoogleFormReply(ctx, reply)
      : { action: 'ignore' };
  }
}
