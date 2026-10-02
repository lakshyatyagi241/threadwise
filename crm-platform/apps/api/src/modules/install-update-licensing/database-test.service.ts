import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import {
  ERROR_CODES,
  type SetupDatabaseDefaults,
  type SetupDatabaseTestRequest,
  type SetupDatabaseTestResponse,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';

const CONNECT_TIMEOUT_MS = 4_000;

/**
 * SQLSTATE classes where the transport worked and the answer is actionable, so trying other routes would only hide
 * it: bad password / role (28xxx), unknown database (3D000), missing privilege (42501). Reference's MySQL codes
 * 1045, 1044, 1049 and 1698 map to these.
 */
const STOP_CODES = new Set(['28P01', '28000', '3D000', '42501']);

export interface DatabaseTarget extends SetupDatabaseDefaults {
  password: string;
}

/** Pure: the deployment's DATABASE_URL as a target. Never throws on a malformed value, so the screen still loads. */
export function parseDatabaseUrl(url: string): DatabaseTarget | null {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    return null;
  }
}

/** Pure: the hosts to try, in Reference's order: exactly what was typed, then loopback by address, then by name. */
export function candidateHosts(host: string): string[] {
  return [...new Set([host, '127.0.0.1', 'localhost'])];
}

/** Pure: blank password means "the one this deployment already uses", but only for this deployment's own database. */
export function resolvePassword(
  input: Pick<SetupDatabaseTestRequest, 'host' | 'port' | 'database' | 'username' | 'password'>,
  own: DatabaseTarget | null,
): string {
  if (input.password) return input.password;
  const same =
    own !== null &&
    input.host === own.host &&
    input.port === own.port &&
    input.database === own.database &&
    input.username === own.username;
  return same ? own.password : '';
}

/**
 * The database step's "Test connection" (TW-INST-005, -006).
 *
 * The deployment's connection comes from its environment, so this step cannot change which database the platform
 * uses; it answers Reference's question, "can this server reach that database with these credentials", and returns the
 * server's own message for authentication and privilege errors. Reachable only with the setup token and only while
 * setup is open (SetupService checks both), because it opens a network connection to a caller-chosen address.
 */
@Injectable()
export class DatabaseTestService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private own(): DatabaseTarget | null {
    return parseDatabaseUrl(this.config.get('DATABASE_URL', { infer: true }));
  }

  /** What the form starts with; the password is never part of it. */
  defaults(): SetupDatabaseDefaults {
    const own = this.own();
    return own
      ? { host: own.host, port: own.port, database: own.database, username: own.username }
      : { host: '127.0.0.1', port: 5432, database: '', username: '' };
  }

  async test(input: SetupDatabaseTestRequest): Promise<SetupDatabaseTestResponse> {
    const password = resolvePassword(input, this.own());
    for (const host of candidateHosts(input.host)) {
      const client = new Client({
        host,
        port: input.port,
        database: input.database,
        user: input.username,
        password,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        query_timeout: CONNECT_TIMEOUT_MS,
      });
      // A connection that fails after it opened (server restart) must not become an unhandled error event.
      client.on('error', () => undefined);
      try {
        await client.connect();
        await client.query('SELECT 1');
        return { success: true, message: 'Connection successful.' };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code && STOP_CODES.has(code)) {
          throw new AppError(
            ERROR_CODES.SETUP_DATABASE_TEST_FAILED,
            (err as Error).message,
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'reason', message: 'server' }],
          );
        }
      } finally {
        await client.end().catch(() => undefined);
      }
    }
    throw new AppError(
      ERROR_CODES.SETUP_DATABASE_TEST_FAILED,
      'Could not reach PostgreSQL over any route.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'reason', message: 'unreachable' }],
    );
  }
}
