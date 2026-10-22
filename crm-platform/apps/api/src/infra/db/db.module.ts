import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDbClient, createDbClientPair, type DbClient, type DbClientPair } from '@crm/db';
import type { Env } from '../../config/env.schema';
import { DB_CLIENT_PAIR, DatabaseService } from './database.service';
import { HEALTH_DB_CLIENT, HealthDb, WEBHOOK_DB_CLIENT, WebhookDb } from './side-pools';

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
            logQueries: config.get('NODE_ENV', { infer: true }) === 'development',
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
          applicationName: 'crm-api-webhook',
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
        }),
    },
    DatabaseService,
    WebhookDb,
    HealthDb,
  ],
  exports: [DatabaseService, DB_CLIENT_PAIR, WebhookDb, HealthDb],
})
export class DbModule {}
