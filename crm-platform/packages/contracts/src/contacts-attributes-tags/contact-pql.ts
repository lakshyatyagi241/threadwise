import { z } from 'zod';
import { segmentRulesSchema } from '../segments/rules';

/**
 * PQL: a contact search written in plain English ("vip contacts from India who were not active in 30 days"). The server turns it into a
 * segment rule tree, the same shape the Contact Hub's "Add condition" sends as `rules`, so the list, the bulk bar and "save as
 * segment" all take the answer as it is. The model never writes SQL.
 */
export const PQL_QUERY_MAX = 500;

export const pqlRequestSchema = z
  .object({ query: z.string().trim().min(1).max(PQL_QUERY_MAX) })
  .strict();
export type PqlRequest = z.infer<typeof pqlRequestSchema>;

export const PQL_SUMMARY_MAX = 300;
export const PQL_IGNORED_MAX = 10;
export const PQL_IGNORED_ITEM_MAX = 120;

export const pqlResultSchema = z.object({
  /** The conditions to apply; null when nothing in the query could be turned into a condition. */
  rules: segmentRulesSchema.nullable(),
  /** One plain sentence of what was understood, shown beside the filter so the user can check it. */
  summary: z.string().max(PQL_SUMMARY_MAX),
  /** Parts of the query that matched nothing in this workspace (an unknown tag, a field that does not exist). */
  ignored: z.array(z.string().max(PQL_IGNORED_ITEM_MAX)).max(PQL_IGNORED_MAX),
});
export type PqlResult = z.infer<typeof pqlResultSchema>;
