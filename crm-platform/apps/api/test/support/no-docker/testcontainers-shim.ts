/**
 * Stand-in for `testcontainers` when TEST_NO_DOCKER=1 (vitest alias). Only the `redis:*` images the specs use are supported (a real
 * redis-server in WSL). Any other image (greenmail ...) throws a clear "needs Docker" error: run those specs without TEST_NO_DOCKER.
 */
import { startRedis, stop, type Handle } from './wsl-runtime';

export const Wait = {
  forLogMessage: (..._a: unknown[]) => ({ kind: 'log' }),
  forListeningPorts: () => ({ kind: 'ports' }),
  forHealthCheck: () => ({ kind: 'health' }),
  forHttp: (..._a: unknown[]) => ({ kind: 'http' }),
};

export class StartedTestContainer {
  constructor(private readonly handle: Handle) {}
  getHost(): string {
    return this.handle.host;
  }
  getMappedPort(_containerPort: number): number {
    return this.handle.port;
  }
  getFirstMappedPort(): number {
    return this.handle.port;
  }
  async stop(_options?: unknown): Promise<unknown> {
    await stop(this.handle);
    return {};
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}

export class GenericContainer {
  constructor(private readonly image: string) {
    return new Proxy(this, {
      get(target, prop, recv) {
        if (prop in target) return Reflect.get(target, prop, recv);
        if (typeof prop === 'string' && prop.startsWith('with')) return () => recv;
        return undefined;
      },
    });
  }
  async start(): Promise<StartedTestContainer> {
    if (!/^(docker\.io\/library\/)?redis(:|$)/.test(this.image)) {
      throw new Error(
        `TEST_NO_DOCKER=1: the image "${this.image}" has no Docker-free stand-in (only redis is supported). ` +
          'Run this spec without TEST_NO_DOCKER (needs Docker Desktop).',
      );
    }
    return new StartedTestContainer(await startRedis());
  }
}
