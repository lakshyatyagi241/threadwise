/** PHP's idea of "set": `false`, `0`, `''`, `'0'`, null and an empty list are not. The Instagram engine's flags arrive as any of these. */
export const truthy = (x: unknown): boolean =>
  !(
    x === false ||
    x === null ||
    x === undefined ||
    x === 0 ||
    x === '' ||
    x === '0' ||
    (Array.isArray(x) && x.length === 0)
  );
