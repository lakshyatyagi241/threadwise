import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDbClient, createDbClientPair, type DbClient, type DbClientPair } from '@crm/db';
import { getRuntimeMonitor, poolAcquireRecorder } from '@crm/observability';
import type { Env } from '../../config/env.schema';
import { DB_CLIENT_PAIR, DatabaseService } from './database.service';
import { HEALTH_DB_CLIENT, HealthDb, WEBHOOK_DB_CLIENT, WebhookDb } from './side-pools';

/** Records each pool checkout as `crm_db_pool_acquire_seconds{pool}`. The monitor is looked up per call: it may start after the pools. */
const onAcquire = (ms: number, pool: string): void => {
  const monitor = getRuntimeMonitor();
  if (monitor) poolAcquireRecorder(monitor.metrics)(pool, ms);
};

@Global()
@Module({
  providers: [
    {
      provide: DB_CLIENT_PAIR,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbClientPair =>
        createDbClientPair(
          {
            url: config.get('DATABASE_URL', { infer: true }),
            poolMax: config.get('DB_POOL_MAX', { infer: true }),
            statementTimeoutMs: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
            lockTimeoutMs: config.get('DB_LOCK_TIMEOUT_MS', { infer: true }),
            idleInTransactionTimeoutMs: config.get('DB_IDLE_IN_TX_TIMEOUT_MS', { infer: true }),
            logQueries: config.get('NODE_ENV', { infer: true }) === 'development',
            onAcquire,
          },
          config.get('DATABASE_REPLICA_URL', { infer: true }),
        ),
    },
    {
      provide: WEBHOOK_DB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbClient =>
        createDbClient({
          url: config.get('DATABASE_URL', { infer: true }),
          poolMax: config.get('WEBHOOK_DB_POOL_MAX', { infer: true }),
          statementTimeoutMs: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
          lockTimeoutMs: config.get('DB_LOCK_TIMEOUT_MS', { infer: true }),
          idleInTransactionTimeoutMs: config.get('DB_IDLE_IN_TX_TIMEOUT_MS', { infer: true }),
          applicationName: 'crm-api-webhook',
          poolName: 'webhook',
          onAcquire,
        }),
    },
    {
      provide: HEALTH_DB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbClient =>
        createDbClient({
          url: config.get('DATABASE_URL', { infer: true }),
          poolMax: config.get('HEALTH_DB_POOL_MAX', { infer: true }),
          statementTimeoutMs: 5_000,
          applicationName: 'crm-api-health',
          poolName: 'health',
          onAcquire,
        }),
    },
    DatabaseService,
    WebhookDb,
    HealthDb,
  ],
  exports: [DatabaseService, DB_CLIENT_PAIR, WebhookDb, HealthDb],
})
export class DbModule {}
