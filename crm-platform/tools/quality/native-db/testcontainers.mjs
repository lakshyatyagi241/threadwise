import { startRedis } from './native.mjs';
export class GenericContainer {
  constructor(image) {
    this.image = image;
  }
  withExposedPorts() {
    return this;
  }
  withWaitStrategy() {
    return this;
  }
  withEnvironment() {
    return this;
  }
  withCommand() {
    return this;
  }
  async start() {
    if (!/^redis/.test(this.image)) throw new Error(`native shim cannot start ${this.image}`);
    const h = await startRedis();
    return {
      getHost: () => '127.0.0.1',
      getMappedPort: () => h.port,
      getFirstMappedPort: () => h.port,
      stop: async () => h.stop(),
    };
  }
}
export const Wait = {
  forLogMessage: () => ({}),
  forListeningPorts: () => ({}),
  forHttp: () => ({}),
};
export const StartedTestContainer = class {};
