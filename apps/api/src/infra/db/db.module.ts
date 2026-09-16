import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDbClientPair, type DbClientPair } from '@crm/db';
import type { Env } from '../../config/env.schema';
import { DB_CLIENT_PAIR, DatabaseService } from './database.service';

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
    DatabaseService,
  ],
  exports: [DatabaseService, DB_CLIENT_PAIR],
})
export class DbModule {}
