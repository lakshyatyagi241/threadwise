import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * "Generate brief" for a company (BL-194; Reference's Client Brief, `BriefsController` / `BriefService`). Reference built a shareable
 * deck out of the numbers it could count, with no AI, and a public link. Here an AI model writes a short brief for the person who
 * asks, from the facts that person may already see (their record scopes decide which contacts, deals, tasks and conversations are
 * counted), sent without names, emails or phone numbers. The brief is private to that person and shown on the company page, with
 * copy and regenerate; there is no public link.
 */

/** The sections of a brief, in the order they are shown. `summary` (who the company is) is a paragraph, the rest are bullet lists. */
export const BRIEF_SECTION_KEYS = [
  'activity',
  'deals',
  'tasks',
  'conversations',
  'properties',
  'risks',
  'nextSteps',
] as const;
export const briefSectionKeySchema = z.enum(BRIEF_SECTION_KEYS);
export type BriefSectionKey = z.infer<typeof briefSectionKeySchema>;

export const BRIEF_SUMMARY_MAX = 1200;
export const BRIEF_BULLET_MAX = 400;
export const BRIEF_BULLETS_PER_SECTION = 8;

export const companyBriefContentSchema = z.object({
  /** Who the company is, in a few sentences. */
  summary: z.string().trim().min(1).max(BRIEF_SUMMARY_MAX),
  sections: z
    .array(
      z.object({
        key: briefSectionKeySchema,
        bullets: z.array(z.string().trim().min(1).max(BRIEF_BULLET_MAX)).max(BRIEF_BULLETS_PER_SECTION),
      }),
    )
    .max(BRIEF_SECTION_KEYS.length),
});
export type CompanyBriefContent = z.infer<typeof companyBriefContentSchema>;

/** Which kinds of records the brief was written from, by what the person may read. A kind they cannot read is `false`, never guessed. */
export const companyBriefSourcesSchema = z.object({
  properties: z.boolean(),
  contacts: z.boolean(),
  deals: z.boolean(),
  tasks: z.boolean(),
  conversations: z.boolean(),
});
export type CompanyBriefSources = z.infer<typeof companyBriefSourcesSchema>;

export const companyBriefSchema = z.object({
  id: uuidSchema,
  content: companyBriefContentSchema,
  sources: companyBriefSourcesSchema,
  generatedAt: z.string().datetime(),
  /** The model that wrote it: shown so a reader knows it is machine written. */
  model: z.string(),
  /** The CRM has changed since this brief was written (a deal moved, a task added...): regenerate for a current one. */
  stale: z.boolean(),
});
export type CompanyBrief = z.infer<typeof companyBriefSchema>;

/** `GET /companies/:id/brief`: whether a brief can be made at all, and the caller's latest one. Calls no model. */
export const companyBriefStateSchema = z.object({
  /** False when no AI key is available to this workspace (its own or the platform's): the card says so instead of offering the button. */
  available: z.boolean(),
  brief: companyBriefSchema.nullable(),
  /** What a brief is made from, for the notice under the button (the kinds the caller may read). */
  sources: companyBriefSourcesSchema,
});
export type CompanyBriefState = z.infer<typeof companyBriefStateSchema>;

/** `POST /companies/:id/brief`. Without `regenerate`, a brief written from the same facts within a day is returned as it is. */
export const generateCompanyBriefSchema = z.object({
  regenerate: z.boolean().default(false),
});
export type GenerateCompanyBriefInput = z.infer<typeof generateCompanyBriefSchema>;

export const companyBriefResultSchema = z.object({
  brief: companyBriefSchema,
  /** True when the stored brief was returned and no model was called. */
  cached: z.boolean(),
});
export type CompanyBriefResult = z.infer<typeof companyBriefResultSchema>;

/** A brief as plain text, for "Copy": the summary, then each section with its bullets. `title` and `labels` come from the screen. */
export function briefToText(
  content: CompanyBriefContent,
  title: string,
  labels: Readonly<Record<BriefSectionKey, string>>,
): string {
  const lines = [title, '', content.summary];
  for (const key of BRIEF_SECTION_KEYS) {
    const section = content.sections.find((s) => s.key === key);
    if (!section || section.bullets.length === 0) continue;
    lines.push('', labels[key], ...section.bullets.map((b) => `- ${b}`));
  }
  return lines.join('\n');
}
