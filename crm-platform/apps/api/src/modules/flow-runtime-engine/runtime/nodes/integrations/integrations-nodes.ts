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
import { ContactsService } from '../../../../crm';
import { SafeFetch } from '../../../../../infra/providers/node-bridge-runtime/safe-fetch';
import type {
  CustomDecision,
  InboundReply,
  NodeContext,
  NodeExecutor,
  NodeResult,
} from '../../types';
import { FlowRefResolver } from '../flow-refs';
import { runAiCall, runCode, runMysql } from './data-nodes';
import {
  GOOGLE_FORM_HANDLER,
  onGoogleFormReply,
  runDocs,
  runForm,
  runMeet,
  runSheetCheck,
  runSheetContact,
  runSheets,
} from './google-nodes';
import { runWebhook } from './webhook-node';

/**
 * Node group `integrations` (TW-FLR-032 to 034, 044 to 048): Webhook, Code, MySQL, the four Google nodes and the AI voice call. Each
 * node reaches its provider through a port (guarded HTTP, the sandbox, a MySQL driver, Google, the calling domain), so a provider
 * that is down is a note in the run log and the flow moves on, as in Reference. The exception is the Google nodes (owner decision): a Google step
 * that cannot use Google (no account, a missing permission, a disabled API, a revoked grant, a Google error) FAILS the run at that step with its
 * `GOOGLE_*` code and the fix text; only a step left half empty is skipped, as before.
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
    'SheetCheck',
    'SheetContact',
  ];

  constructor(
    private readonly safeFetch: SafeFetch,
    @Inject(MYSQL_QUERY) private readonly mysql: MysqlQueryPort,
    @Inject(GOOGLE_WORKSPACE) private readonly google: GoogleWorkspacePort,
    @Inject(AI_CALL) private readonly calls: AiCallPort,
    private readonly refs: FlowRefResolver,
    private readonly contacts: ContactsService,
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
        return runAiCall(ctx, this.calls, this.refs);
      case 'SheetCheck':
        return runSheetCheck(ctx, this.google);
      case 'SheetContact':
        return runSheetContact(ctx, this.google, async (field, value) => {
          const done = await this.contacts.setFieldFromFlow(
            ctx.run.orgId,
            ctx.run.contactId!,
            field,
            value,
          );
          return done !== null;
        });
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
