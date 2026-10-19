/** A route parameter as one string: the first value when the link repeated it, '' when it is absent. */
export const firstParam = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';
