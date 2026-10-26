/**
 * A flow's media links. The file copy (pilot/files/copy-files.cjs) points each converted link at the copy in the app's bucket,
 * `<public base>/flow-media/<...>/<file name>`, so the migrated flow differs from the source only in that link. The file is the same:
 * when the expected row names the Waboo link of that same file name, the copied link counts as that link. Anything else is compared as it is.
 */
const COPY_PATH = /\/flow-media\/(?:.*\/)?([^/?#]+)$/;
const FILE_NAME = /\/([^/?#]+)(?:[?#].*)?$/;

export function mediaAsCopied(expected: unknown, got: unknown): unknown {
  const wanted = new Map<string, string>();
  const collect = (x: unknown): void => {
    if (typeof x === 'string') {
      const name = /^https?:\/\//.test(x) ? FILE_NAME.exec(x)?.[1] : undefined;
      if (name) wanted.set(name, x);
    } else if (Array.isArray(x)) x.forEach(collect);
    else if (x && typeof x === 'object') Object.values(x).forEach(collect);
  };
  collect(expected);
  const fix = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const name = COPY_PATH.exec(x)?.[1];
      return (name && wanted.get(name)) || x;
    }
    if (Array.isArray(x)) return x.map(fix);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fix(v)]));
    }
    return x;
  };
  return fix(got);
}
