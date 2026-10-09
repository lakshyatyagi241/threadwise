import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module writes the platform content tables.
 *
 * `frontend_content`, `blog_*`, `legal_pages`, `pricing_faqs`, `announcements` and
 * `contact_messages` accept reads from every connection (the public site needs no privilege) but accept writes only
 * when the privileged flag is on: the content belongs to the platform operator, not to a tenant. So every operator
 * mutation, and the contact inbox read, goes through here, and a grep for `.privileged(` in this module must find this
 * file and nothing else (unit-tested), the same rule the auth and plan modules follow.
 *
 * Two correct requests can collide on a unique slug at the same instant; that is a 409 the editor can show, not a 500.
 */
@Injectable()
export class CmsStore {
  constructor(private readonly db: DatabaseService) {}

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.privileged(fn);
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if ((e.code ?? e.cause?.code) === '23505') {
        throw new AppError(
          ERROR_CODES.CMS_SLUG_TAKEN,
          'That address is already used. Choose another one.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
