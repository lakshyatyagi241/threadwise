import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformStore } from '../auth';
import type { TranslationMap } from './keyword-translation';

export interface KeywordContent {
  /** Row uuid. */
  id: string;
  contentType: string;
  content: string | null;
  contentTranslations: TranslationMap | null;
}

export interface KeywordRule {
  /** Row uuid. */
  id: string;
  orgId: number;
  keyword: string;
  canonicalLanguage: string | null;
  keywordTranslations: TranslationMap | null;
  matchingMethod: string;
  /** The selected reply variants. */
  contents: KeywordContent[];
}

export interface RuleScan {
  orgId: number;
  /** Rows that already have translations are included (`--force`). */
  includeTranslated: boolean;
  /** Keyset cursor: only rules after this one (rows are visited in `id` order). */
  after: string | null;
  limit: number;
}

export interface WorkspaceLanguages {
  defaultLanguage: string | null;
  /** Raw `auto_translate_languages`; see `parseTargetList`. */
  autoTranslateLanguages: string | null;
}

export interface TranslatedRule {
  canonicalLanguage: string;
  keywordTranslations: TranslationMap;
  /** Reply text maps by content uuid; only text variants with text appear. */
  contentTranslations: Record<string, TranslationMap>;
}

/**
 * Where the keyword fan-out reads and writes rules. The auto-reply domain owns `keyword_replies` and
 * `keyword_reply_contents`; until it exposes its own repository this port is satisfied by `PgKeywordRuleStore` below.
 */
export interface KeywordRuleStore {
  /** Workspaces that have at least one rule. */
  workspaces(): Promise<number[]>;
  workspaceLanguages(orgId: number): Promise<WorkspaceLanguages>;
  /** One page of one workspace's rules, in a stable order. */
  scan(scan: RuleScan): Promise<KeywordRule[]>;
  save(rule: KeywordRule, translated: TranslatedRule): Promise<void>;
}

export const KEYWORD_RULE_STORE = Symbol('KEYWORD_RULE_STORE');

interface RuleRow {
  uuid: string;
  org_id: string | number;
  keyword: string;
  canonical_language: string | null;
  keyword_translations: TranslationMap | null;
  matching_method: string;
}
interface ContentRow {
  rule_uuid: string;
  uuid: string;
  content_type: string;
  content: string | null;
  content_translations: TranslationMap | null;
}

/**
 * Shim over the auto-reply tables, kept inside this domain's zone. It runs in the rule's own workspace (forced RLS);
 * only the list of workspaces comes through `PlatformStore`. It writes only the translation
 * columns, never a rule's matching or reply fields. Delete it when AUTOREPLY ships its repository.
 */
@Injectable()
export class PgKeywordRuleStore implements KeywordRuleStore {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: PlatformStore,
  ) {}

  async workspaceLanguages(orgId: number): Promise<WorkspaceLanguages> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(
        sql`SELECT default_language, auto_translate_languages FROM workspace_settings WHERE org_id = ${orgId}`,
      ),
    );
    const r = res.rows[0] as
      { default_language: string | null; auto_translate_languages: string | null } | undefined;
    return {
      defaultLanguage: r?.default_language ?? null,
      autoTranslateLanguages: r?.auto_translate_languages ?? null,
    };
  }

  async workspaces(): Promise<number[]> {
    // The one cross-workspace read, through the sanctioned door.
    const res = await this.store.tx((tx) =>
      tx.execute(sql`SELECT DISTINCT org_id FROM keyword_replies ORDER BY org_id`),
    );
    return (res.rows as Array<{ org_id: string | number }>).map((r) => Number(r.org_id));
  }

  async scan(scan: RuleScan): Promise<KeywordRule[]> {
    return this.scanOrg(scan.orgId, scan, scan.limit);
  }

  private async scanOrg(orgId: number, scan: RuleScan, limit: number): Promise<KeywordRule[]> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const rules = await tx.execute(sql`
        SELECT uuid, org_id, keyword, canonical_language, keyword_translations, matching_method
        FROM keyword_replies
        WHERE org_id = ${orgId}
          AND (${scan.includeTranslated} OR keyword_translations IS NULL)
          AND (${scan.after}::uuid IS NULL OR uuid > ${scan.after}::uuid)
        ORDER BY uuid LIMIT ${limit}
      `);
      const rows = rules.rows as unknown as RuleRow[];
      if (rows.length === 0) return [];
      const uuids = rows.map((r) => r.uuid);
      const contents = await tx.execute(sql`
        SELECT r.uuid AS rule_uuid, c.uuid, c.content_type, c.content, c.content_translations
        FROM keyword_reply_contents c
        JOIN keyword_replies r ON r.org_id = c.org_id AND r.id = c.keyword_reply_id
        WHERE c.org_id = ${orgId} AND r.uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )}) AND c.is_selected
        ORDER BY c.sort_order, c.id
      `);
      const byRule = new Map<string, KeywordContent[]>();
      for (const c of contents.rows as unknown as ContentRow[]) {
        const list = byRule.get(c.rule_uuid) ?? [];
        list.push({
          id: c.uuid,
          contentType: c.content_type,
          content: c.content,
          contentTranslations: c.content_translations,
        });
        byRule.set(c.rule_uuid, list);
      }
      return rows.map((r) => ({
        id: r.uuid,
        orgId: Number(r.org_id),
        keyword: r.keyword,
        canonicalLanguage: r.canonical_language,
        keywordTranslations: r.keyword_translations,
        matchingMethod: r.matching_method,
        contents: byRule.get(r.uuid) ?? [],
      }));
    });
  }

  async save(rule: KeywordRule, t: TranslatedRule): Promise<void> {
    await this.db.txAs({ orgId: rule.orgId, userId: null }, async (tx) => {
      await tx.execute(sql`
        UPDATE keyword_replies
        SET keyword_translations = ${JSON.stringify(t.keywordTranslations)}::jsonb,
            canonical_language = ${t.canonicalLanguage}
        WHERE org_id = ${rule.orgId} AND uuid = ${rule.id}::uuid
      `);
      for (const [contentId, map] of Object.entries(t.contentTranslations)) {
        await tx.execute(sql`
          UPDATE keyword_reply_contents SET content_translations = ${JSON.stringify(map)}::jsonb
          WHERE org_id = ${rule.orgId} AND uuid = ${contentId}::uuid
        `);
      }
    });
  }
}
