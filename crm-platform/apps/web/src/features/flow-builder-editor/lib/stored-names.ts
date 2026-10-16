/**
 * Where a step keeps what the customer answered: the flow variable (shown as `{{name}}`) and, when it is copied there too, the
 * contact property. Shown on the step itself so nobody has to open it to see them.
 */
export function storedNames(data: Record<string, unknown> | undefined): string[] {
  const d = data ?? {};
  const out: string[] = [];
  const v = typeof d.var === 'string' ? d.var.trim() : '';
  if (v) out.push(`{{${v}}}`);
  const p = typeof d.propertyKey === 'string' ? d.propertyKey.trim() : '';
  if (p && d.saveProperty !== false) out.push(`→ ${p}`);
  return out;
}
