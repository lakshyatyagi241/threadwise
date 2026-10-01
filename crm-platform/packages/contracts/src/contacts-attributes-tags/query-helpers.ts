import { z } from 'zod';

/**
 * `z.coerce.boolean()` turns the string "false" into true, so a query string
 * `?imported=false` would switch the filter ON. These helpers read the strings
 * a query string actually carries and also accept the native JSON values the
 * same schema receives in a request body.
 */
const toBoolean = (v: unknown): unknown => {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return v;
};

export const queryBoolean = () => z.preprocess(toBoolean, z.boolean());

/** `a,b,c` in a query string, or a JSON array in a body. */
export const queryList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => {
    if (typeof v === 'string')
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return v;
  }, z.array(item));
