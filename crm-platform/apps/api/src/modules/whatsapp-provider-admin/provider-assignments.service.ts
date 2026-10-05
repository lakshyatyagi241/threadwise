import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ListAssignmentsQuery,
  type ListAssignmentsResponse,
  type SetAssignmentInput,
  type WorkspaceAssignment,
} from '@crm/contracts';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { AuthAuditService } from '../auth';
import { ProviderStore, type ProviderRow } from '../whatsapp-provider-registry';
import { summaryOf } from './provider.mapper';

type WorkspaceRow = Awaited<ReturnType<ProviderStore['workspaces']>>[number];

/**
 * A workspace's override of the provider NEW numbers connect through (`org_whatsapp_provider_assignment`). Setting or clearing it never
 * moves a number that is already connected: that is the switch's job (provider-switch.service).
 */
@Injectable()
export class ProviderAssignmentsService {
  constructor(
    private readonly store: ProviderStore,
    private readonly audit: AuthAuditService,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  async list(query: ListAssignmentsQuery): Promise<ListAssignmentsResponse> {
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const { rows, providers } = await this.store.tx(async (tx) => ({
      rows: await this.store.workspaces(tx, {
        search: query.search,
        overrideOnly: query.overrideOnly,
        limit: query.limit,
        after: after
          ? { iso: after.createdAtIso ?? after.createdAt.toISOString(), id: after.id }
          : undefined,
      }),
      providers: await this.store.all(tx),
    }));
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const registryDefault = providers.find((p) => p.is_default && p.status === 'active') ?? null;
    return {
      data: page.map((w) => this.toAssignment(w, providers, registryDefault)),
      page: {
        nextCursor:
          hasMore && last
            ? encodeCursor({
                createdAt: last.created_at,
                id: last.id,
                createdAtIso: last.created_at_iso,
              })
            : null,
        hasMore,
        limit: query.limit,
      },
      registryDefault: registryDefault ? summaryOf(registryDefault) : null,
    };
  }

  async set(
    workspaceUuid: string,
    input: SetAssignmentInput,
    operatorId: number,
  ): Promise<WorkspaceAssignment> {
    const orgId = await this.store.tx(async (tx) => {
      const org = await this.store.orgByUuid(tx, workspaceUuid);
      if (!org) throw AppError.notFound('Workspace', workspaceUuid);
      const provider = (await this.store.all(tx)).find((p) => p.uuid === input.providerId);
      if (!provider) throw AppError.notFound('WhatsApp provider', input.providerId);
      if (provider.status !== 'active') {
        throw new AppError(
          ERROR_CODES.WAP_PROVIDER_DISABLED,
          'Only an active provider can be assigned.',
          HttpStatus.CONFLICT,
        );
      }
      if (
        !provider.builtin &&
        provider.credential_mode === 'platform_token' &&
        !provider.credential_hints.providerToken
      ) {
        throw new AppError(
          ERROR_CODES.WAP_CREDENTIALS_MISSING,
          'Store the provider token before assigning this provider.',
          HttpStatus.CONFLICT,
        );
      }
      const before = await this.store.assignmentOf(tx, org.id);
      await this.store.setAssignment(tx, org.id, provider.id, operatorId, input.note ?? null);
      await this.audit.record(tx, {
        event: 'platform.whatsapp_providers.assignment_set',
        status: 'success',
        orgId: org.id,
        payload: { provider: provider.key, previous: before?.provider_key ?? null },
      });
      return org.id;
    });
    return this.view(orgId);
  }

  async clear(workspaceUuid: string): Promise<WorkspaceAssignment> {
    const orgId = await this.store.tx(async (tx) => {
      const org = await this.store.orgByUuid(tx, workspaceUuid);
      if (!org) throw AppError.notFound('Workspace', workspaceUuid);
      const before = await this.store.assignmentOf(tx, org.id);
      if (await this.store.clearAssignment(tx, org.id)) {
        await this.audit.record(tx, {
          event: 'platform.whatsapp_providers.assignment_cleared',
          status: 'success',
          orgId: org.id,
          payload: { previous: before?.provider_key ?? null },
        });
      }
      return org.id;
    });
    return this.view(orgId);
  }

  /** One workspace as the list shows it. */
  async view(orgId: number): Promise<WorkspaceAssignment> {
    const { rows, providers } = await this.store.tx(async (tx) => ({
      rows: await this.store.workspaces(tx, { orgId, limit: 1 }),
      providers: await this.store.all(tx),
    }));
    const row = rows[0];
    if (!row) throw AppError.notFound('Workspace');
    const registryDefault = providers.find((p) => p.is_default && p.status === 'active') ?? null;
    return this.toAssignment(row, providers, registryDefault);
  }

  private toAssignment(
    w: WorkspaceRow,
    providers: readonly ProviderRow[],
    registryDefault: ProviderRow | null,
  ): WorkspaceAssignment {
    const override = w.provider_key
      ? { id: w.provider_uuid!, key: w.provider_key, label: w.provider_label! }
      : null;
    let source: 'override' | 'default' | 'platform_setting';
    let key: string;
    if (override) {
      source = 'override';
      key = override.key;
    } else if (registryDefault) {
      source = 'default';
      key = registryDefault.key;
    } else {
      source = 'platform_setting';
      key = this.env.WABA_DEFAULT_PROVIDER;
    }
    const effective = providers.find((p) => p.key === key) ?? null;
    return {
      workspaceId: w.uuid,
      name: w.name,
      slug: w.slug,
      override,
      effective: { source, providerKey: key, provider: effective ? summaryOf(effective) : null },
      numberCount: w.number_count,
      numbersOnOtherProvider: w.number_count - (w.numbers_by_key[key] ?? 0),
      assignedAt: w.assigned_at ? w.assigned_at.toISOString() : null,
    };
  }
}
