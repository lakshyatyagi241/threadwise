import { Oid, type Doc } from '../util';

const NUM = ['$numberLong', '$numberInt', '$numberDouble', '$numberDecimal'];

/** Relaxed + canonical MongoDB Extended JSON, one document per line. ObjectId -> Oid, $date -> Date, $number* -> number. */
export function parseEjsonLine(line: string): Doc {
  return JSON.parse(line, (_k, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length !== 1) return v;
    const k = keys[0]!;
    if (k === '$oid') return new Oid(String(o.$oid));
    if (k === '$date') {
      const d = o.$date;
      return typeof d === 'object' && d !== null
        ? new Date(Number((d as Doc).$numberLong))
        : new Date(d as string | number);
    }
    if (NUM.includes(k)) return Number(o[k]);
    return v;
  }) as Doc;
}
