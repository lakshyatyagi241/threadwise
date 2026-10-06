import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, FORM_PUBLIC_KEY } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { checkOrigin } from './form-origin';
import { FormsPlan } from './form-plan';
import { FormThrottle } from './form-throttle';

/** One answer for "no such form": an unknown or malformed key, an archived form, a workspace that does not own the add-on. */
export const notFound = (): AppError => AppError.notFound('Form');

export interface FormRoute {
  orgId: number;
  formId: number;
  status: 'draft' | 'published' | 'paused' | 'archived';
  publishedVersionId: number | null;
  allowedOrigins: string[];
}

/**
 * The front door every public form route goes through (docs/specs/forms-builder-app.md 7.2, 7.3 and 14):
 *
 *  1. the address budget, BEFORE anything is looked up (a scan with random keys costs a Redis hit, not a query);
 *  2. the key's shape, then the tenant: `web_form_lookup` is a SECURITY DEFINER function returning ids and a status (no tenant exists yet);
 *  3. the plan: a workspace that does not own the Forms add-on (or whose subscription lapsed) answers exactly like an unknown key;
 *  4. the origin, for browsers: an origin the form does not allow is refused (403 FORMS_ORIGIN_DENIED) and gets no CORS headers; an
 *     allowed one is returned so the controller echoes it. A request with no Origin (a server, a script) is not refused by an allow-list.
 *
 * An unknown key, an archived form and a plan-locked workspace are ONE 404, and the origin is only judged once the key proved to exist,
 * so a scan learns nothing from it.
 */
@Injectable()
export class FormLookupService {
  private readonly ownOrigins: string[];

  constructor(
    private readonly db: DatabaseService,
    private readonly plan: FormsPlan,
    private readonly throttle: FormThrottle,
    config: ConfigService<Env, true>,
  ) {
    this.ownOrigins = [new URL(config.get('WEB_APP_URL', { infer: true })).origin];
  }

  /** The workspace and form behind a key, or null. Not published-only: the page of a paused form says "closed". */
  async route(key: string): Promise<FormRoute | null> {
    if (!FORM_PUBLIC_KEY.test(key)) return null;
    const res = await this.db.primary.execute(sql`SELECT * FROM web_form_lookup(${key})`);
    const r = res.rows[0] as
      | {
          route_org_id: number | string;
          route_form_id: number | string;
          route_status: FormRoute['status'];
          route_published_version_id: number | string | null;
          route_allowed_origins: string[] | null;
        }
      | undefined;
    return r
      ? {
          orgId: Number(r.route_org_id),
          formId: Number(r.route_form_id),
          status: r.route_status,
          publishedVersionId:
            r.route_published_version_id === null ? null : Number(r.route_published_version_id),
          allowedOrigins: r.route_allowed_origins ?? [],
        }
      : null;
  }

  async open(
    key: string,
    meta: { ip?: string; origin?: string },
    opts: { requirePublished: boolean },
  ): Promise<{ route: FormRoute; allowOrigin: string | null }> {
    await this.throttle.checkIp(meta.ip);
    const route = await this.route(key);
    if (!route || !(await this.plan.isEnabled(route.orgId))) throw notFound();
    if (
      opts.requirePublished &&
      (route.status !== 'published' || route.publishedVersionId === null)
    )
      throw notFound();
    if (!opts.requirePublished && route.status !== 'published' && route.status !== 'paused')
      throw notFound();

    const verdict = checkOrigin(meta.origin, route.allowedOrigins, this.ownOrigins);
    if (verdict === 'denied') {
      throw new AppError(
        ERROR_CODES.FORMS_ORIGIN_DENIED,
        'This form cannot be used from this site.',
        HttpStatus.FORBIDDEN,
      );
    }
    return { route, allowOrigin: verdict === 'allowed' ? (meta.origin ?? null) : null };
  }

  /** The preflight's question: which origin, if any, may the browser use. No throttle and no 4xx: a preflight carries nothing to protect. */
  async preflightOrigin(key: string, origin: string | undefined): Promise<string | null> {
    const route = await this.route(key);
    if (!route || !(await this.plan.isEnabled(route.orgId))) return null;
    return checkOrigin(origin, route.allowedOrigins, this.ownOrigins) === 'allowed'
      ? (origin ?? null)
      : null;
  }
}
