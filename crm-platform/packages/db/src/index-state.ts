import type { Client } from 'pg';

/** One index as the catalog shows it: what the migrator and verify need to tell whether it is usable. */
export interface IndexState {
  name: string;
  quoted: string; // the name as a DROP statement must spell it
  table: string; // regclass text, as the catalog spells it
  valid: boolean;
  building: boolean; // a CONCURRENTLY build of it is still running in another session
  definition: string; // pg_get_indexdef, for comparing shapes
}

/**
 * The indexes of the current schema with the given names, or every index of it when `names` is null. The one catalog query behind
 * the migrator's checks before a @no-transaction file and verify's INVALID report.
 */
export async function indexStates(client: Client, names: string[] | null): Promise<IndexState[]> {
  const { rows } = await client.query<IndexState>(
    `SELECT c.relname AS name,
            quote_ident(c.relname) AS quoted,
            ix.indrelid::regclass::text AS "table",
            ix.indisvalid AS valid,
            EXISTS (SELECT 1 FROM pg_stat_progress_create_index p WHERE p.index_relid = ix.indexrelid) AS building,
            pg_get_indexdef(ix.indexrelid) AS definition
       FROM pg_index ix
       JOIN pg_class c ON c.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND ($1::text[] IS NULL OR c.relname = ANY($1::text[]))`,
    [names],
  );
  return rows;
}
