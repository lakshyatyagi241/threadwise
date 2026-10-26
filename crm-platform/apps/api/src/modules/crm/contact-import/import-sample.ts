import { IMPORT_SAMPLE_HEADERS, IMPORT_SAMPLE_ROWS, normalizeImportHeader } from '@crm/contracts';
import { csvLine, guardFormula } from '../contact-bulk/csv-writer';
import type { PropertyDef } from '../contacts/contact-property-values';

/**
 * One example value for each custom property type, written the way the importer reads it back (`cellToPropertyValue` and
 * `coercePropertyValue`). A type not listed here is a line of text, so it gets a plain example.
 */
export function sampleValue(def: PropertyDef): string {
  switch (def.fieldType) {
    case 'long_text':
      return 'A longer note for this contact. It can run over several sentences.';
    case 'integer':
    case 'big_integer':
      return '42';
    case 'decimal':
      return '12.5';
    case 'percentage':
      return '75';
    case 'currency':
      return '1250.50';
    case 'rating':
      return '4';
    case 'boolean':
    case 'checkbox':
      return 'yes';
    // Year first, always: the importer does not read 10/05/2026 (day or month first) as a date.
    case 'date':
      return '2026-05-21';
    case 'datetime':
      return '2026-05-10T14:30';
    case 'email':
      return 'contact@example.com';
    case 'url':
      return 'https://example.com';
    // No leading "+": a spreadsheet opening the file reads "+91 ..." as a formula.
    case 'phone':
      return '98123 45678';
    case 'timezone':
      return 'Asia/Kolkata';
    case 'select':
    case 'radio':
      return def.options[0] ?? '';
    case 'multiselect':
      return multiselectSample(def.options);
    default:
      return 'Sample text';
  }
}

/**
 * Two options separated by commas, the form the export writes. An option holding a separator is left out, since the importer would
 * split it; when every option holds one, the first is written alone, which the importer reads whole because it matches exactly.
 */
function multiselectSample(options: readonly string[]): string {
  const plain = options.filter((o) => !/[,;|]/.test(o));
  if (plain.length === 0) return options[0] ?? '';
  return plain.slice(0, 2).join(', ');
}

/**
 * How many properties each normalised label or key reads as. A label that reads as another property's label or key is not used as a
 * header: the importer would have to guess which property the column is for.
 */
function claimCounts(defs: readonly PropertyDef[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const def of defs) {
    for (const k of new Set([
      normalizeImportHeader(def.label.trim()),
      normalizeImportHeader(def.key),
    ])) {
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The header a custom property's column is called: its label, when that is not blank, not a built-in column's name and not read as
 * another property's; otherwise `attr:<key>`, the header the export writes (the importer matches it to its key first).
 */
function propertyHeader(def: PropertyDef, taken: Set<string>, claims: Map<string, number>): string {
  const label = def.label.trim();
  const key = normalizeImportHeader(label);
  if (key && !taken.has(key) && claims.get(key) === 1) {
    taken.add(key);
    return label;
  }
  return `attr:${def.key}`;
}

/**
 * The sample CSV for a workspace: every built-in column the importer reads, then one column per custom property the importer
 * fills, each holding a valid example for its type. Two example contacts, so the file imports as it is. The labels and options are
 * the workspace's own text, so they are guarded against spreadsheet formulas like every other exported cell.
 */
export function sampleCsv(properties: readonly PropertyDef[] = []): string {
  const taken = new Set(IMPORT_SAMPLE_HEADERS.map(normalizeImportHeader));
  const byLabel = [...properties].sort((a, b) => a.label.localeCompare(b.label));
  const claims = claimCounts(byLabel);
  const headers = byLabel.map((def) => guardFormula(propertyHeader(def, taken, claims)));
  const values = byLabel.map((def) => guardFormula(sampleValue(def)));
  return (
    csvLine([...IMPORT_SAMPLE_HEADERS, ...headers]) +
    IMPORT_SAMPLE_ROWS.map((row) => csvLine([...row, ...values])).join('')
  );
}
