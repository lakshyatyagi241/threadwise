import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../contacts-attributes-tags/support';

/**
 * The OpenAPI document the API serves at /docs (main.ts) builds against the real controllers. It caught `@nestjs/swagger` 11 being
 * installed next to Nest 12 (the package would not even load); a controller decorator it cannot read fails here, not at boot.
 */
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the OpenAPI document', () => {
  it('builds from every controller and lists the inbox routes', () => {
    const doc = SwaggerModule.createDocument(
      h.app,
      new DocumentBuilder()
        .setTitle('CRM Platform API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(100);
    expect(paths.some((p) => p.endsWith('/inbox/messages/{id}/log'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/inbox/message-logs/exports'))).toBe(true);
  });
});
