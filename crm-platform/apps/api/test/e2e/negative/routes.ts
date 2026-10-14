import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { schemaOfPipe } from '../../support/negative';

/** Nest stores handler arguments under this key; the body is parameter type 3 (RouteParamtypes.BODY). */
const ROUTE_ARGS = '__routeArguments__';
const BODY = '3';

export interface NegRoute {
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** With `:param` segments, as declared. */
  path: string;
  isPublic: boolean;
  /** The zod schema the body is validated with, when the handler binds one through `zodPipe`. */
  bodySchema: ZodTypeAny | null;
}

const VERBS: Record<number, NegRoute['method'] | undefined> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const join = (...parts: string[]) =>
  '/' + parts.flatMap((p) => String(p ?? '').split('/')).filter(Boolean).join('/');

/** Every route the running app serves with its auth flag and body schema, read from the controllers' own metadata. */
export async function negativeRoutes(app: INestApplication): Promise<NegRoute[]> {
  const { IS_PUBLIC_KEY } = await import('../../../src/common/decorators');
  const out: NegRoute[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const type = wrapper.metatype as (new (...a: unknown[]) => object) | null;
      if (!type || Reflect.getMetadata(PATH_METADATA, type) === undefined) continue;
      const base = Reflect.getMetadata(PATH_METADATA, type) as string | string[];
      const version = Reflect.getMetadata(VERSION_METADATA, type) as string | string[] | symbol | undefined;
      const prefix = typeof version === 'string' ? `v${version}` : Array.isArray(version) ? `v${version[0]}` : '';
      const proto = type.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (typeof fn !== 'function' || name === 'constructor') continue;
        const verb = VERBS[Reflect.getMetadata(METHOD_METADATA, fn) as number];
        if (!verb) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[];
        const path = join(prefix, Array.isArray(base) ? base[0]! : base, Array.isArray(sub) ? sub[0]! : sub);
        const args = (Reflect.getMetadata(ROUTE_ARGS, type, name) ?? {}) as Record<string, { pipes?: unknown[] }>;
        let bodySchema: ZodTypeAny | null = null;
        for (const [key, meta] of Object.entries(args)) {
          if (!key.startsWith(`${BODY}:`)) continue;
          for (const pipe of meta.pipes ?? []) bodySchema ??= schemaOfPipe(pipe);
        }
        out.push({
          route: `${verb} ${path}`,
          method: verb,
          path,
          isPublic: Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, fn) ?? Reflect.getMetadata(IS_PUBLIC_KEY, type)),
          bodySchema,
        });
      }
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** Fills `:param` segments with a well-formed id so the request reaches body validation instead of stopping at the path. */
export const concretePath = (path: string) =>
  path.replace(/:[A-Za-z0-9_]+\??/g, '11111111-1111-4111-8111-111111111111');
