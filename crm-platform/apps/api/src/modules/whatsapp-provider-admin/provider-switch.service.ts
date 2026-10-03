import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type SwitchNumberOutcome,
  type SwitchWorkspaceProviderInput,
  type SwitchWorkspaceProviderResponse,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { providerKeyOf } from '../../infra/providers/whatsapp-cloud-api-waba/waba-registry-routes';
import { AuthAuditService } from '../auth';
import { WabaConnectService, type ProviderMoveTarget } from '../whatsapp-cloud-api-waba';
import {
  openProvider,
  ProviderStore,
  WhatsAppProviderResolver,
  type ProviderRow,
} from '../whatsapp-provider-registry';
import { ProviderAssignmentsService } from './provider-assignments.service';
import { summaryOf } from './provider.mapper';

/** One request moves at most this many numbers: each one makes provider calls, none of which may pile up in a request. */
const MAX_NUMBERS_PER_SWITCH = 50;

/**
 * The operator's SWITCH: move a workspace's connected WhatsApp numbers from one provider to another.
 *
 * The per-number mechanics (re-subscribing the webhook through the new route, then re-pointing the number with its audit row and the
 * `whatsapp.connection.connected` event in one transaction) are the WABA module's (`WabaConnectService.moveToProvider`); this service
 * picks the numbers, runs them one at a time, and records the operator's trail. A dry run changes nothing and lists, per number, what
 * would happen and what a person still has to do (a token to paste, a reconnect). Rolling back is switching back.
 */
@Injectable()
export class ProviderSwitchService {
  constructor(
    private readonly store: ProviderStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuthAuditService,
    private readonly resolver: WhatsAppProviderResolver,
    private readonly waba: WabaConnectService,
    private readonly assignments: ProviderAssignmentsService,
  ) {}

  async switchWorkspace(
    workspaceUuid: string,
    input: SwitchWorkspaceProviderInput,
    operatorId: number,
  ): Promise<SwitchWorkspaceProviderResponse> {
    const { org, providers, numbers } = await this.store.tx(async (tx) => {
      const found = await this.store.orgByUuid(tx, workspaceUuid);
      if (!found) throw AppError.notFound('Workspace', workspaceUuid);
      return {
        org: found,
        providers: await this.store.all(tx),
        numbers: await this.store.numbersOf(tx, found.id),
      };
    });

    const target = providers.find((p) => p.uuid === input.targetProviderId);
    if (!target) throw AppError.notFound('WhatsApp provider', input.targetProviderId);
    if (target.status !== 'active') {
      throw new AppError(
        ERROR_CODES.WAP_PROVIDER_DISABLED,
        'Numbers can only be switched to an active provider.',
        HttpStatus.CONFLICT,
      );
    }
    const from = input.fromProviderId
      ? providers.find((p) => p.uuid === input.fromProviderId)
      : undefined;
    if (input.fromProviderId && !from)
      throw AppError.notFound('WhatsApp provider', input.fromProviderId);

    const wanted = input.numberIds ? new Set(input.numberIds) : null;
    const chosen = numbers.filter((n) => {
      const key = providerKeyOf(n.meta_json);
      if (wanted && !wanted.has(n.uuid)) return false;
      if (from ? key !== from.key : key === target.key) return false;
      return key !== target.key;
    });
    if (chosen.length === 0) {
      throw new AppError(
        ERROR_CODES.WAP_SWITCH_NOTHING_TO_DO,
        'No connected number needs switching: they are already on that provider.',
        HttpStatus.CONFLICT,
      );
    }
    if (chosen.length > MAX_NUMBERS_PER_SWITCH) {
      throw AppError.validation(`Switch at most ${MAX_NUMBERS_PER_SWITCH} numbers per request`, [
        { path: 'numberIds', message: `More than ${MAX_NUMBERS_PER_SWITCH} numbers selected` },
      ]);
    }

    // The target is read fresh from the registry (not the snapshot, which may be a few seconds old) and handed to the snapshot first,
    // so the route the WABA module builds for each number is the one just read.
    await this.resolver.invalidate();
    const moveTarget = this.moveTargetOf(target);
    const byKey = new Map(providers.map((p) => [p.key, p]));

    const outcomes: SwitchNumberOutcome[] = [];
    for (const n of chosen) {
      const fromRow = byKey.get(providerKeyOf(n.meta_json)) ?? null;
      try {
        const r = await this.waba.moveToProvider(org.id, n.uuid, moveTarget, {
          dryRun: input.dryRun,
          reason: input.reason,
        });
        outcomes.push({
          numberId: r.numberId,
          label: r.label,
          phoneNumber: r.phoneNumber,
          from: fromRow ? summaryOf(fromRow) : null,
          state: r.state,
          requirements: r.requirements,
          resubscribe: r.resubscribe,
          inboundWired: r.inboundWired,
          message: r.message,
        });
      } catch (e) {
        outcomes.push({
          numberId: n.uuid,
          label: n.display_label ?? n.phone_number,
          phoneNumber: n.phone_number,
          from: fromRow ? summaryOf(fromRow) : null,
          state: 'failed',
          requirements: [],
          resubscribe: false,
          inboundWired: null,
          message: e instanceof AppError ? e.message : 'The number could not be switched.',
        });
      }
    }

    let overrideSet = false;
    if (input.setOverride && !input.dryRun) {
      await this.assignments.set(workspaceUuid, { providerId: target.uuid }, operatorId);
      overrideSet = true;
    }
    if (!input.dryRun) {
      await this.store.tx((tx) =>
        this.audit.record(tx, {
          event: 'platform.whatsapp_providers.workspace_switched',
          status: outcomes.some((o) => o.state === 'failed') ? 'warning' : 'success',
          orgId: org.id,
          payload: {
            to: target.key,
            switched: outcomes.filter((o) => o.state === 'switched').length,
            repointed: outcomes.filter((o) => o.state === 'repointed').length,
            blocked: outcomes.filter((o) => o.state === 'blocked').length,
            failed: outcomes.filter((o) => o.state === 'failed').length,
            overrideSet,
          },
        }),
      );
    }
    return {
      dryRun: input.dryRun,
      workspaceId: org.uuid,
      to: summaryOf(target),
      overrideSet,
      numbers: outcomes,
    };
  }

  private moveTargetOf(row: ProviderRow): ProviderMoveTarget {
    return {
      key: row.key,
      builtin: row.builtin,
      credentialMode: row.credential_mode,
      registry: row.builtin ? null : openProvider(row, this.crypto),
    };
  }
}
