import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
// Only the two leaf port files of the lead pipeline: they import nothing, so this module's import graph does not pull the CRM, the plans
// and the notifications modules in (a module that imports another domain's classes can close a file cycle in this repo).
import { LEAD_INGEST, type LeadIngestPort, type NormalisedLead } from '../leads/lead-ingest.port';
import {
  LEAD_SOURCE_DIRECTORY,
  type LeadSourceDirectoryPort,
} from '../leads/lead-source-directory.port';
import type { ConnectorLead } from '../../infra/providers/marketplace';

export type LeadOutcome = 'created' | 'updated' | 'duplicate' | 'needs_review' | 'failed';

/**
 * The marketplace's only way into the lead pipeline. Every lead-source connector ends here, and here ends in the pipeline's two ports:
 * `LEAD_INGEST` (one lead in) and `LEAD_SOURCE_DIRECTORY` (a source of its own per installation).
 *
 * The ports are looked up lazily by token in the whole application (`strict: false`) instead of being constructor-injected, so this
 * module neither imports the leads module (no file or module cycle) nor fails to start when the lead pipeline is not part of the build.
 * When a port cannot be found the gateway says so with 503 `MKT_LEAD_PIPELINE_UNAVAILABLE`: the sender retries and no lead is lost.
 */
@Injectable()
export class LeadPipelineGateway {
  private readonly logger = new Logger(LeadPipelineGateway.name);
  private ingestPort: LeadIngestPort | null | undefined;
  private directoryPort: LeadSourceDirectoryPort | null | undefined;

  constructor(private readonly modules: ModuleRef) {}

  /** Replaces the ports (tests, or a deployment that binds them elsewhere). `null` = not available; `undefined` = look them up again. */
  use(ports: { ingest?: LeadIngestPort | null; directory?: LeadSourceDirectoryPort | null }): void {
    if ('ingest' in ports) this.ingestPort = ports.ingest;
    if ('directory' in ports) this.directoryPort = ports.directory;
  }

  private resolve<T>(token: symbol): T | null {
    try {
      return this.modules.get<T>(token, { strict: false });
    } catch {
      return null;
    }
  }

  private ingest(): LeadIngestPort {
    if (this.ingestPort === undefined) this.ingestPort = this.resolve<LeadIngestPort>(LEAD_INGEST);
    if (!this.ingestPort) throw this.unavailable();
    return this.ingestPort;
  }

  private directory(): LeadSourceDirectoryPort | null {
    if (this.directoryPort === undefined)
      this.directoryPort = this.resolve<LeadSourceDirectoryPort>(LEAD_SOURCE_DIRECTORY);
    return this.directoryPort;
  }

  private unavailable(): AppError {
    return new AppError(
      ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE,
      'Leads cannot be received right now. Try again in a moment.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** The pipeline's source for an installation, created on first use (idempotent), or null when no directory is bound. */
  async ensureSource(
    orgId: number,
    input: { providerKey: string; externalRef: string; name: string },
  ): Promise<number | null> {
    const dir = this.directory();
    if (!dir) return null;
    return (await dir.ensureConnectorSource(orgId, input)).sourceId;
  }

  /** Removes the installation's source. A failure is logged, never thrown: the installation is gone either way. */
  async releaseSource(orgId: number, externalRef: string): Promise<void> {
    try {
      await this.directory()?.releaseConnectorSource(orgId, externalRef);
    } catch (err) {
      this.logger.warn({ err, orgId, externalRef }, 'lead source release failed');
    }
  }

  /** One lead into the pipeline. Throws 503 when there is no pipeline; returns the pipeline's own outcome otherwise. */
  async deliver(orgId: number, sourceId: number, lead: ConnectorLead): Promise<LeadOutcome> {
    const normalised: NormalisedLead = lead;
    const r = await this.ingest().ingest(orgId, sourceId, normalised);
    return r.status;
  }
}
