import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

export interface RouteInfo {
  /** `POST /v2/contacts/:id/tags` (the version prefix is the controller's own). */
  route: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  controller: string;
  handler: string;
  idempotent: boolean;
}

const METHODS: Record<number, RouteInfo['method'] | undefined> = {
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => String(p ?? '').split('/'))
    .filter(Boolean)
    .join('/');

/**
 * Every mutating route the running app serves, read from the controllers' own metadata (not from the source text), with whether
 * `@Idempotent()` is on the handler or its controller. The same walk the router does, so a route cannot hide from it.
 */
export async function mutatingRoutes(app: INestApplication): Promise<RouteInfo[]> {
  // Loaded late: the module graph has an import cycle that only builds when the app module is read first (the harness does that).
  const { IDEMPOTENT_KEY } = await import('../../../src/common/decorators');
  const out: RouteInfo[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const type = wrapper.metatype as (new (...a: unknown[]) => object) | null;
      if (!type || Reflect.getMetadata(PATH_METADATA, type) === undefined) continue;
      const base = Reflect.getMetadata(PATH_METADATA, type) as string | string[];
      const version = Reflect.getMetadata(VERSION_METADATA, type) as
        string | string[] | symbol | undefined;
      const prefix =
        typeof version === 'string'
          ? `v${version}`
          : Array.isArray(version)
            ? `v${version[0]}`
            : '';
      const proto = type.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (typeof fn !== 'function' || name === 'constructor') continue;
        const verb = METHODS[Reflect.getMetadata(METHOD_METADATA, fn) as number];
        if (!verb) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[];
        const path = join(
          prefix,
          Array.isArray(base) ? base[0]! : base,
          Array.isArray(sub) ? sub[0]! : sub,
        );
        const idempotent = Boolean(
          Reflect.getMetadata(IDEMPOTENT_KEY, fn) ?? Reflect.getMetadata(IDEMPOTENT_KEY, type),
        );
        out.push({
          route: `${verb} ${path}`,
          method: verb,
          path,
          controller: type.name,
          handler: name,
          idempotent,
        });
      }
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}
