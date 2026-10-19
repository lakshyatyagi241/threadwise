const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The flow variables a step writes, as `{{name}}`: the answer / choice (`var`) and the result of an API call, code, AI or FAQ step
 * (`save`), or of a CRM / Google step (`saveAs`).
 */
export function variableNames(data: Record<string, unknown> | undefined): string[] {
  const d = data ?? {};
  const out: string[] = [];
  for (const key of ['var', 'save', 'saveAs']) {
    const v = text(d[key]);
    if (v && !out.includes(`{{${v}}}`)) out.push(`{{${v}}}`);
  }
  return out;
}

/**
 * Where a step keeps what it produced: its flow variables and, when the answer is copied there too, the contact property. Shown on
 * the step itself so nobody has to open it to see them.
 */
export function storedNames(data: Record<string, unknown> | undefined): string[] {
  const d = data ?? {};
  const out = variableNames(d);
  const p = text(d.propertyKey);
  if (p && d.saveProperty !== false) out.push(`→ ${p}`);
  return out;
}
