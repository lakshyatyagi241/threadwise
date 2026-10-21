/**
 * Stand-in for `@testcontainers/postgresql` when TEST_NO_DOCKER=1 (vitest alias, see apps/api/vitest.config.ts). Same surface the
 * specs use; every start() gets its own throwaway Postgres 16 cluster in WSL (own roles, own data dir), like a container did.
 */
import { startPostgres, stop, type Handle } from './runtime';

/** `withCommand(['postgres','-c','k=v', ...])` -> ['k=v', ...] (everything else is ignored). */
function settingsFromCommand(cmd: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] === '-c' && cmd[i + 1]) out.push(cmd[++i]);
    else if (/^-c.+=/.test(cmd[i])) out.push(cmd[i].slice(2));
  }
  return out;
}

export class StartedPostgreSqlContainer {
  constructor(
    private readonly handle: Handle,
    private readonly db: string,
    private readonly user: string,
    private readonly pass: string,
  ) {}
  getHost(): string {
    return this.handle.host;
  }
  getPort(): number {
    return this.handle.port;
  }
  getMappedPort(_containerPort: number): number {
    return this.handle.port;
  }
  getFirstMappedPort(): number {
    return this.handle.port;
  }
  getDatabase(): string {
    return this.db;
  }
  getUsername(): string {
    return this.user;
  }
  getPassword(): string {
    return this.pass;
  }
  getConnectionUri(): string {
    return `postgres://${encodeURIComponent(this.user)}:${encodeURIComponent(this.pass)}@${this.handle.host}:${this.handle.port}/${this.db}`;
  }
  async stop(_options?: unknown): Promise<unknown> {
    await stop(this.handle);
    return {};
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}

export class PostgreSqlContainer {
  private db = 'test';
  private user = 'test';
  private pass = 'test';
  private settings: string[] = [];

  constructor(_image?: string) {
    // Any other builder method the real class has (withReuse, withLabels, withStartupTimeout, withResourcesQuota, withNetwork...) is a
    // harmless no-op here.
    return new Proxy(this, {
      get(target, prop, recv) {
        if (prop in target) return Reflect.get(target, prop, recv);
        if (typeof prop === 'string' && prop.startsWith('with')) return () => recv;
        return undefined;
      },
    });
  }
  withDatabase(v: string): this {
    this.db = v;
    return this;
  }
  withUsername(v: string): this {
    this.user = v;
    return this;
  }
  withPassword(v: string): this {
    this.pass = v;
    return this;
  }
  withCommand(cmd: string[]): this {
    this.settings.push(...settingsFromCommand(cmd));
    return this;
  }
  withExposedPorts(..._ports: unknown[]): this {
    return this;
  }
  async start(): Promise<StartedPostgreSqlContainer> {
    const handle = await startPostgres({
      database: this.db,
      username: this.user,
      password: this.pass,
      settings: this.settings,
    });
    return new StartedPostgreSqlContainer(handle, this.db, this.user, this.pass);
  }
}
