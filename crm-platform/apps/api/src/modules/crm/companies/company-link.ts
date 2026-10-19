import { HttpStatus } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { RbacService } from '../../../kernel/rbac/rbac.service';
import { companyScopeCondition } from './companies.repository';

/**
 * Why a company could not be linked, with the field named (`companyId`) so the form can say it at the company field instead of
 * mistaking it for the contact or the deal itself being gone. Not-found covers a company that is not in the workspace and one
 * outside the caller's record scope alike.
 */
export function companyLinkRefused(reason: 'notFound' | 'forbidden'): AppError {
  return reason === 'notFound'
    ? new AppError(ERROR_CODES.NOT_FOUND, 'Company not found', HttpStatus.NOT_FOUND, [
        { path: 'companyId', message: 'not available' },
      ])
    : new AppError(
        ERROR_CODES.FORBIDDEN,
        'Missing permission: record.companies.read',
        HttpStatus.FORBIDDEN,
        [{ path: 'companyId', message: 'not allowed' }],
      );
}

/**
 * A person who puts a company on a contact, a deal or a task (the pickers on those forms, and the API behind them) must be
 * able to read that company: `record.companies.read`, and the company inside their record scope. Without it a caller who
 * cannot see a company could link it by guessing its id, and learn that it exists from the answer.
 *
 * Not-found rather than forbidden when the company is outside the scope (as `CompaniesService` answers), so a company is not
 * revealed to exist; forbidden only when the capability itself is missing. A request with no grants (a system actor: a flow,
 * an import, the public form intake) is not scoped, as everywhere else in the CRM.
 *
 * Lives beside the companies service but does not import it: the contacts, deals and tasks modules call this, and the
 * companies service already depends on contacts (a cycle otherwise).
 */
export async function assertCompanyReadable(
  tx: Tx,
  rbac: RbacService,
  orgId: number,
  companyId: number,
): Promise<void> {
  const ctx = RequestContextStore.require();
  if (!ctx.grants) return;
  const read = rbac.can(ctx.grants, 'record.companies.read');
  if (!read.allowed) throw companyLinkRefused('forbidden');
  const scope = companyScopeCondition(orgId, read.scope, ctx.userId);
  if (!scope) return;
  const res = await tx.execute(
    sql`SELECT 1 FROM companies c WHERE c.org_id = ${orgId} AND c.id = ${companyId} AND ${scope} LIMIT 1`,
  );
  if (res.rows.length === 0) throw companyLinkRefused('notFound');
}
