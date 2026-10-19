type PropertyFeed =
  | {
      system: ReadonlyArray<{ key: string; name: string }>;
      custom: ReadonlyArray<{ key: string; name: string }>;
    }
  | undefined;

/**
 * The contact columns a flow can write (`FLOW_CONTACT_COLUMNS` in the API's contacts service). Only these built-in tokens can be
 * picked as a "save to contact property" target; the others (phone number, country code, ...) are never written from a flow.
 */
const WRITABLE_CONTACT_COLUMNS = [
  'name',
  'first_name',
  'last_name',
  'email',
  'title',
  'language',
  'address',
] as const;

/**
 * The options of a "save to contact property" select: the writable built-in contact columns (e.g. Email) and the workspace's custom
 * properties. A key the step already stores that is in neither list (an older flow) is kept too, so the select shows it instead of
 * going blank.
 */
export function savePropertyOptions(
  feed: PropertyFeed,
  stored: string,
): Array<{ key: string; name: string }> {
  const custom = feed?.custom ?? [];
  const builtIn = WRITABLE_CONTACT_COLUMNS.map((key) => ({
    key,
    name: feed?.system.find((p) => p.key === key)?.name ?? key,
  }));
  const options = [...builtIn, ...custom];
  if (stored === '' || options.some((p) => p.key === stored)) return options;
  const other = feed?.system.find((p) => p.key === stored);
  return [{ key: stored, name: other?.name ?? stored }, ...options];
}
