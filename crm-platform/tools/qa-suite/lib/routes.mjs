// Static route inventory from the NestJS controllers: method, URL (version 2 prefix), public or not, file.
import { apiSrc, read, rel } from './core.mjs';

export function routes() {
  const out = [];
  for (const f of apiSrc().filter((p) => p.endsWith('.controller.ts'))) {
    const t = read(f);
    const c = t.match(/@Controller\(\s*(?:\{([^}]*)\}|'([^']*)'|`([^`]*)`)?\s*\)/);
    if (!c) continue;
    const path = (c[1]?.match(/path:\s*'([^']*)'/)?.[1] ?? c[2] ?? c[3] ?? '').replace(
      /^\/|\/$/g,
      '',
    );
    const neutral = /VERSION_NEUTRAL/.test(c[1] ?? '');
    const version = c[1]?.match(/version:\s*'(\d+)'/)?.[1] ?? '2';
    const classPublic = /@Public\(\)[\s\S]{0,80}@Controller|@Public\(\)\s*\n\s*export class/.test(
      t,
    );
    for (const m of t.matchAll(
      /((?:\s*@\w+\([^)]*\)\s*)*)@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|`([^`]*)`)?\s*\)/g,
    )) {
      const sub = (m[3] ?? m[4] ?? '').replace(/^\/|\/$/g, '');
      const url = '/' + [neutral ? '' : `v${version}`, path, sub].filter(Boolean).join('/');
      out.push({
        method: m[2].toUpperCase(),
        url,
        dynamic: /:/.test(url),
        public: classPublic || /@Public\(\)/.test(m[1]),
        file: rel(f),
      });
    }
  }
  return out;
}
