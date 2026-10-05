import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type IgFlowList, type IgRunFlowResult } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  INSTAGRAM_BRIDGE,
  type InstagramBridgeFactory,
} from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { EngineConnectionService } from '../addons-extension-registry';
import { AccountsRepository } from './accounts.repository';
import { engineThreadId, notConnected, sendFailure } from './reply-rules';
import {
  INSTAGRAM_INBOX_INGEST,
  INSTAGRAM_PLAN_GATE,
  type InstagramInboxIngest,
  type InstagramPlanGate,
} from './_shims/tokens';

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * Running an engine flow on a thread (WD-IG-012). Flow authoring and the flow runtime live on the engine; WaDesk lists the flows it
 * can run for the workspace's linked accounts and tells it to start one on a thread.
 */
@Injectable()
export class FlowsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: AccountsRepository,
    private readonly engines: EngineConnectionService,
    @Inject(INSTAGRAM_BRIDGE) private readonly bridge: InstagramBridgeFactory,
    @Inject(INSTAGRAM_INBOX_INGEST) private readonly inbox: InstagramInboxIngest,
    @Inject(INSTAGRAM_PLAN_GATE) private readonly plan: InstagramPlanGate,
  ) {}

  /** The flows of every linked account, each flow once, with where to author more. Nothing linked or no engine: an empty list. */
  async list(): Promise<IgFlowList> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const conn = await this.engines.connection('instagram');
    const rows = await this.db.tx((tx) => this.accounts.list(tx, orgId));
    if (rows.length === 0 || conn.url === '' || conn.secret === '')
      return { flows: [], authorUrl: null };

    const api = this.bridge.with(conn);
    const seen = new Set<number>();
    const flows: IgFlowList['flows'] = [];
    for (const r of rows) {
      for (const f of await api.flows(r.instaflowAccountId)) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        flows.push({ id: f.id, name: f.name || `Flow #${f.id}` });
      }
    }
    return { flows, authorUrl: `${conn.url.replace(/\/+$/, '')}/instagram/flows` };
  }

  /** Starts a flow on an Instagram thread. */
  async run(threadUuid: string, flowId: number): Promise<IgRunFlowResult> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    const thread = await this.db.tx((tx) => this.inbox.findThread(tx, orgId, threadUuid));
    if (!thread) throw AppError.notFound('Conversation', threadUuid);
    if (thread.channel !== 'instagram') {
      throw refuse(
        'IG_NOT_AN_INSTAGRAM_THREAD',
        'That conversation is not an Instagram conversation.',
      );
    }
    const conn = await this.engines.connection('instagram');
    const engineId = engineThreadId(thread.rawJid);
    if (engineId === '') {
      throw refuse(
        'IG_THREAD_NO_ENGINE_ID',
        `This Instagram thread has no ${conn.brand} conversation id.`,
      );
    }
    if (conn.url === '' || conn.secret === '')
      throw refuse('IG_NOT_CONNECTED', notConnected(conn.brand));

    const res = await this.bridge.with(conn).runFlow(engineId, flowId);
    if (!res.ok) {
      throw refuse(
        'IG_FLOW_RUN_FAILED',
        sendFailure(conn.brand, res.status, res.error),
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { ok: true };
  }
}
