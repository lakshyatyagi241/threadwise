import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * The OpenAPI document of the running app. `main.ts` serves it at /docs outside production; the contract tests
 * (`test/e2e/contract`) build the same document from the test app to check that every served route is documented
 * and to detect breaking changes (`tools/quality/openapi-diff.mjs`). One builder means the document the tests check
 * is the document people read.
 */
export function buildOpenApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CRM Platform API')
      .setDescription(
        'Multi-tenant CRM platform. Internal routes are /v1; the external contract is /public/v1 and is versioned separately.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .addTag('auth')
      // 'users' / 'roles' / 'permissions' stay off this list — per
      // docs/phase-plan.md, a page's tag is added only once every route in
      // its docs/api-inventory.md row is built and has a
      // docs/api-testing.md entry. Their controllers carry
      // @ApiExcludeController() until then.
      .addTag('contacts')
      .addTag('field-sections')
      .addTag('fields')
      .addTag('status-options')
      .addTag('tags')
      .addTag('contact-views')
      .addTag('contact-notes')
      .addTag('contact-files')
      .addTag('contact-activities')
      .addTag('contact-meetings')
      .addTag('partner-portal')
      .addTag('public-api')
      .addTag('health')
      .build(),
  );
}
