import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { DisplayIdService } from './identifiers/display-id.service';
import { OutboxSubscriberRegistry } from './outbox/outbox-subscribers';
import { OutboxService } from './outbox/outbox.service';
import { RbacService } from './rbac/rbac.service';

/**
 * The platform kernel.
 *
 * Everything here is domain-agnostic on purpose: it knows about records,
 * tenants, permissions and events, and nothing about contacts, campaigns or
 * exam applications. That is what lets all five apps plug into the same
 * permissions, custom fields, automations and audit trail.
 *
 * The dependency rule is enforced in CI (.dependency-cruiser.cjs):
 * kernel must never import from modules/.
 *
 * Still to land here: the metadata registry (modules/fields/relationships),
 * the query AST -> SQL compiler, the generic `records` store, and rollup
 * recomputation. Each arrives with its own migration.
 */
@Global()
@Module({
  providers: [OutboxService, OutboxSubscriberRegistry, AuditService, RbacService, DisplayIdService],
  exports: [OutboxService, OutboxSubscriberRegistry, AuditService, RbacService, DisplayIdService],
})
export class KernelModule {}
