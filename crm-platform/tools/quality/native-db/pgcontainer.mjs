import { startPg } from './native.mjs';
export class PostgreSqlContainer {
  constructor() {
    this.db = 'crm';
    this.user = 'crm';
    this.pw = 'crm';
  }
  withDatabase(d) {
    this.db = d;
    return this;
  }
  withUsername(u) {
    this.user = u;
    return this;
  }
  withPassword(p) {
    this.pw = p;
    return this;
  }
  withCommand() {
    return this;
  }
  withEnvironment() {
    return this;
  }
  withExposedPorts() {
    return this;
  }
  withReuse() {
    return this;
  }
  withStartupTimeout() {
    return this;
  }
  async start() {
    const h = await startPg();
    const self = this;
    return {
      getHost: () => '127.0.0.1',
      getPort: () => h.port,
      getMappedPort: () => h.port,
      getDatabase: () => self.db,
      getUsername: () => self.user,
      getPassword: () => self.pw,
      getConnectionUri: () => `postgres://${self.user}:${self.pw}@127.0.0.1:${h.port}/${self.db}`,
      stop: async () => h.stop(),
      exec: async () => {
        throw new Error('exec is not supported by the native shim');
      },
    };
  }
}
export const StartedPostgreSqlContainer = class {};
