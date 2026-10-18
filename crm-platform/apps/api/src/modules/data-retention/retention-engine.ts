import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

/** What the environment lets the nightly archive job do. The dashboard shows it, and the audit log prune keys off `live`. */
export interface EngineState {
  /** RETENTION_ENABLED. */
  enabled: boolean;
  /** RETENTION_DRY_RUN (on by default): the job only logs what it would do. */
  dryRun: boolean;
  archiveDriver: 'local' | 's3';
  /** False for the local driver in production: the job refuses to drop a partition into a container's own disk. */
  archiveDurable: boolean;
  /** True when a saved policy for a partitioned stream is really carried out tonight. */
  live: boolean;
}

export function engineState(config?: Pick<ConfigService<Env, true>, 'get'>): EngineState {
  const enabled = config?.get('RETENTION_ENABLED', { infer: true }) === true;
  const dryRun = config?.get('RETENTION_DRY_RUN', { infer: true }) !== false;
  const archiveDriver = config?.get('ARCHIVE_DRIVER', { infer: true }) === 's3' ? 's3' : 'local';
  const archiveDurable = !(
    archiveDriver === 'local' && config?.get('NODE_ENV', { infer: true }) === 'production'
  );
  return {
    enabled,
    dryRun,
    archiveDriver,
    archiveDurable,
    live: enabled && !dryRun && archiveDurable,
  };
}
