import { z } from 'zod';

/** A field's schema without its default, if it has one. */
type WithoutDefault<F> =
  F extends z.ZodPrefault<infer I> ? I : F extends z.ZodDefault<infer I> ? I : F;

/**
 * A partial update (PATCH body): every key optional, and a key that was not sent stays out of the result. Zod 3's `.partial()` did
 * that; in zod 4 a `.default()` still fills in a missing key, so the defaults are unwrapped first. Validation of the keys that are
 * sent is unchanged, and each key keeps its own type.
 */
export function patchOf<S extends z.ZodObject>(schema: S) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const type = (field as z.ZodType)._zod.def.type;
      return [
        key,
        type === 'default' || type === 'prefault' ? (field as z.ZodDefault).unwrap() : field,
      ];
    }),
  );
  return z.object(shape).partial() as unknown as z.ZodObject<{
    [K in keyof S['shape']]: z.ZodOptional<WithoutDefault<S['shape'][K]>>;
  }>;
}
