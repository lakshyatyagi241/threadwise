/**
 * Which contact properties a write changed, named the way a flow's Trigger names them: the core columns by their flow key
 * (`name`, `first_name`, `last_name`, `email`) and a custom property by its stored key. The "Contact updated" trigger can then start
 * only for the property it watches. Pure; a value that did not change, or was not in the write, is not listed.
 */
const CORE: ReadonlyArray<readonly [input: string, flow: string]> = [
  ['name', 'name'],
  ['firstName', 'first_name'],
  ['lastName', 'last_name'],
  ['email', 'email'],
];

const same = (a: unknown, b: unknown): boolean => String(a ?? '').trim() === String(b ?? '').trim();

export function changedFlowKeys(
  existing: { data?: Record<string, unknown> | null } & Record<string, unknown>,
  input: Record<string, unknown> & { customFields?: Record<string, unknown> | undefined },
): string[] {
  const out: string[] = [];
  for (const [prop, flow] of CORE) {
    if (input[prop] !== undefined && !same(input[prop], existing[prop])) out.push(flow);
  }
  const before = existing.data ?? {};
  for (const [key, value] of Object.entries(input.customFields ?? {})) {
    if (!same(value, before[key])) out.push(key);
  }
  return out;
}
