import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  NODE_PACING_DEFAULTS,
  nodePacingSchema,
  type NodeBridgeResponse,
  type NodeBridgeTestRequest,
  type NodeBridgeTestResult,
  type NodeMessageSettings,
  type NodePacing,
  type UpdateNodeBridgeInput,
  type UpdateNodePacingInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { NodeBridgeProbe } from '../../infra/providers/node-bridge-runtime/node-bridge.probe';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { NODE_BRIDGE_KEY, NODE_BRIDGE_TOKEN_KEY } from '../install-update-licensing';

/** Sender pacing document (WD-NODE-029): the four values the bridge pulls, plus the version the form sends back. */
export const NODE_PACING_KEY = 'node.pacing';
/** The bridge port the installer assumes when the address names none (WaDesk installer default, WD-NODE-001). */
const DEFAULT_BRIDGE_PORT = 8888;

interface BridgeDoc {
  serverUrl?: string;
  port?: number;
  _rv?: number;
  _at?: string;
}
type PacingDoc = Partial<NodePacing> & { _rv?: number; _at?: string };

/** The address's own port, or the installer default, for a bridge that was never installed through the wizard. */
function portOf(url: string): number {
  const m = /^https?:\/\/[^/?#]*:(\d{1,5})(?:[/?#]|$)/i.exec(url);
  return m ? Number(m[1]) : DEFAULT_BRIDGE_PORT;
}

/**
 * The Node bridge's address, shared token and send pacing (WD-NODE-052, 002, 029).
 *
 * The address and token are the install wizard's own keys (`inst.node_bridge`, read elsewhere through
 * `InstallSettingsService`): there is one copy, so an edit here is what every reader sees. WaDesk mirrored the values
 * into two `.env` files and pushed a refresh to the bridge; neither step exists here, the bridge reads the platform store.
 */
@Injectable()
export class NodeBridgeSettingsService {
  constructor(
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly probe: NodeBridgeProbe,
    private readonly config: ConfigService,
  ) {}

  // --- reads ----------------------------------------------------------------------------------

  async read(): Promise<NodeBridgeResponse> {
    // The page must see what a save elsewhere just wrote, or its next save carries a stale version.
    this.store.invalidate();
    const bridge = await this.store.get<BridgeDoc>(NODE_BRIDGE_KEY);
    const pacing = await this.store.get<PacingDoc>(NODE_PACING_KEY);
    return {
      serverUrl: bridge?.serverUrl ?? '',
      tokenSet: await this.store.hasSecret(NODE_BRIDGE_TOKEN_KEY),
      rowVersion: bridge?._rv ?? 0,
      pacing: this.pacingValues(pacing),
      pacingRowVersion: pacing?._rv ?? 0,
    };
  }

  private pacingValues(doc: PacingDoc | undefined): NodePacing {
    const parsed = nodePacingSchema.safeParse({ ...NODE_PACING_DEFAULTS, ...doc });
    // A stored document that no longer fits the limits must not take the page down.
    return parsed.success ? parsed.data : { ...NODE_PACING_DEFAULTS };
  }

  /**
   * The shared secret the bridge must present (WD-NODE-002): the saved one first, then `NODE_WEBHOOK_TOKEN` from the
   * environment. Null when neither is set; the caller must then refuse everyone.
   */
  async token(): Promise<string | null> {
    const saved = await this.store.getSecret(NODE_BRIDGE_TOKEN_KEY);
    if (saved) return saved;
    const env = this.config.get<string>('NODE_WEBHOOK_TOKEN')?.trim();
    return env || null;
  }

  /** Where the bridge is and the secret to present, for server-side callers (the console health card). */
  async target(): Promise<{ serverUrl: string; token: string | null }> {
    const bridge = await this.store.get<BridgeDoc>(NODE_BRIDGE_KEY);
    return { serverUrl: bridge?.serverUrl?.trim() ?? '', token: await this.token() };
  }

  /** What the bridge pulls on a timer (WaDesk `GET api/whatsapp-message-settings`). */
  async messageSettings(): Promise<NodeMessageSettings> {
    const p = this.pacingValues(await this.store.get<PacingDoc>(NODE_PACING_KEY));
    return {
      success: true,
      msg_gap: p.msgGap,
      batches_gap: p.batchesGap,
      bw_msg_gap: p.bwMsgGap,
      enable_batches: p.enableBatches ? 1 : 0,
    };
  }

  // --- writes ---------------------------------------------------------------------------------

  async updateBridge(
    input: UpdateNodeBridgeInput,
    operatorId: number,
  ): Promise<NodeBridgeResponse> {
    await this.store.inTx(async (tx) => {
      // Lock the row for the whole transaction so two operators cannot both pass the version check.
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${NODE_BRIDGE_KEY} FOR UPDATE`,
      );
      const current = (found.rows[0] as { value: BridgeDoc } | undefined)?.value;
      const version = current?._rv ?? 0;
      if (version !== input.rowVersion) throw AppError.rowVersionConflict('Node bridge settings');

      const doc: BridgeDoc = {
        ...current,
        serverUrl: input.serverUrl,
        port: current?.port ?? portOf(input.serverUrl),
        _rv: version + 1,
        _at: new Date().toISOString(),
      };
      const json = JSON.stringify(doc);
      if (current) {
        await tx.execute(sql`
          UPDATE platform_settings
             SET value = ${json}::jsonb, updated_by = ${operatorId}, updated_at = now()
           WHERE key = ${NODE_BRIDGE_KEY}`);
      } else {
        const ins = await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${NODE_BRIDGE_KEY}, ${json}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO NOTHING
          RETURNING key`);
        // Another first save won the race between our read and this insert.
        if (ins.rows.length === 0) throw AppError.rowVersionConflict('Node bridge settings');
      }

      // A blank token keeps the stored one (WaDesk never lets the form clear it).
      const token = input.token?.trim() ?? '';
      if (token) {
        const sealed = JSON.stringify(this.store.seal(token));
        await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${NODE_BRIDGE_TOKEN_KEY}, ${sealed}::jsonb, true, ${operatorId}, now())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, is_secret = true,
                updated_by = EXCLUDED.updated_by, updated_at = now()`);
      }

      await this.audit.record(tx, {
        event: 'platform.node_bridge_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          fields: [
            ...(input.serverUrl !== (current?.serverUrl ?? '') ? ['serverUrl'] : []),
            ...(token ? ['token'] : []),
          ],
          rowVersion: version + 1,
        },
      });
    });
    return this.read();
  }

  async updatePacing(
    input: UpdateNodePacingInput,
    operatorId: number,
  ): Promise<NodeBridgeResponse> {
    await this.store.inTx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${NODE_PACING_KEY} FOR UPDATE`,
      );
      const current = (found.rows[0] as { value: PacingDoc } | undefined)?.value;
      const version = current?._rv ?? 0;
      if (version !== input.rowVersion) throw AppError.rowVersionConflict('Sender pacing');

      const before = this.pacingValues(current);
      const after: NodePacing = {
        msgGap: input.msgGap,
        batchesGap: input.batchesGap,
        bwMsgGap: input.bwMsgGap,
        enableBatches: input.enableBatches,
      };
      const doc: PacingDoc = { ...after, _rv: version + 1, _at: new Date().toISOString() };
      const json = JSON.stringify(doc);
      if (current) {
        await tx.execute(sql`
          UPDATE platform_settings
             SET value = ${json}::jsonb, updated_by = ${operatorId}, updated_at = now()
           WHERE key = ${NODE_PACING_KEY}`);
      } else {
        const ins = await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${NODE_PACING_KEY}, ${json}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO NOTHING
          RETURNING key`);
        if (ins.rows.length === 0) throw AppError.rowVersionConflict('Sender pacing');
      }

      await this.audit.record(tx, {
        event: 'platform.node_pacing_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          fields: (Object.keys(after) as Array<keyof NodePacing>).filter(
            (k) => after[k] !== before[k],
          ),
          rowVersion: version + 1,
        },
      });
    });
    return this.read();
  }

  // --- test -----------------------------------------------------------------------------------

  /** WD-NODE-052 "Test connection": the typed address, and the typed token or, when blank, the saved one. */
  async test(input: NodeBridgeTestRequest): Promise<NodeBridgeTestResult> {
    const url = input.serverUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw AppError.validation('Enter a valid Server URL (http:// or https://) first.');
    }
    const token = input.token?.trim() || (await this.token()) || '';
    return this.probe.probe(url, token);
  }
}
