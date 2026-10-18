import { Injectable } from '@nestjs/common';
import {
  GENERIC_PERSONA_DEFINITION,
  WORKSPACE_VOCAB_NOUNS,
  explainNoun,
  parseOperatorOverrides,
  parseWorkspaceOverrides,
  personaDefinitionSchema,
  workspaceOverridesSchema,
  type PersonaDefinition,
  type ResolveInput,
  type SaveWorkspaceVocabularyInput,
  type VocabNounRow,
  type WorkspaceVocabularyResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { provisionWorkspacePersona } from './persona-provisioning';
import { PersonaRepository, type WorkspacePersonaRecord } from './persona.repository';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Stable key order, so two equal documents compare equal as strings. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys(v[k])]),
    );
  }
  return v;
}

/**
 * Dynamic object naming (BL-310; docs/specs/persona-profiles.md, 8.2 "Words we use"): the workspace's OWN layer of nouns. A workspace
 * admin may call a contact a Patient, Client, Lead or Member, an appointment a Visit, a deal an Admission, per language. Labels in the web
 * UI only: the API, the data model, webhooks, exports and CSV headers keep the canonical names, and nothing here is read by a guard.
 *
 * The session view (`PersonaService`, `org.persona.nouns`) is what the web renders from; this class is the Settings screen's read and write.
 */
@Injectable()
export class PersonaVocabularyService {
  constructor(
    private readonly repo: PersonaRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * For each noun a workspace may rename: what is shown now in one language and which layer says so, plus the workspace's own wording.
   * The operator layer is reported only as a source (`operator`), never with its reason or note (spec decision 10).
   */
  async get(orgId: number, locale: string): Promise<WorkspaceVocabularyResponse> {
    const row = await this.repo.workspaceRecord(orgId);
    // A workspace with no row reads as `generic` with nothing set; its first save creates the row.
    const loaded = row
      ? await this.inputOf(orgId, row)
      : {
          input: { definition: GENERIC_PERSONA_DEFINITION, operator: null, workspace: null },
          rev: 1,
          personaKey: 'generic',
        };
    const own = loaded.input.workspace?.vocab ?? {};
    const nouns: VocabNounRow[] = WORKSPACE_VOCAB_NOUNS.map((noun) => {
      const explained = explainNoun(loaded.input, noun, locale);
      const mine = own[noun];
      return {
        noun,
        effective: explained ? explained.forms : null,
        source: explained ? explained.source : 'default',
        workspace: mine?.[locale] ?? null,
        workspaceLocales: mine ? Object.keys(mine).sort() : [],
      };
    });
    return { locale, rev: loaded.rev, personaKey: loaded.personaKey, nouns };
  }

  /**
   * One transaction: the row is locked, the caller's `rev` must still be the current one (409 otherwise), the `vocab` part of the
   * workspace overrides is replaced for the nouns named and the rest of the document is kept as it is, then the change is logged
   * (workspace layer) and audited. The row's trigger bumps `rev`, which every cache of the resolved view is keyed by, so the next session
   * read already carries the new words. A save that changes nothing writes nothing. No outbox event: nothing consumes one, the session
   * reads the row.
   */
  async save(
    input: SaveWorkspaceVocabularyInput,
    locale: string,
  ): Promise<WorkspaceVocabularyResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    await this.db.tx(async (tx) => {
      let row = await this.repo.lockWorkspaceRow(tx, orgId);
      if (!row) {
        // A workspace created some other way has no row yet: it starts on `generic`, as provisioning would have made it.
        await provisionWorkspacePersona(tx, orgId);
        row = await this.repo.lockWorkspaceRow(tx, orgId);
      }
      if (!row) throw AppError.notFound('Workspace persona');
      if (row.rev !== input.rev) throw AppError.rowVersionConflict('Workspace words');

      const doc = isPlainObject(row.workspaceOverrides) ? { ...row.workspaceOverrides } : {};
      const before = isPlainObject(doc.vocab) ? doc.vocab : {};
      const vocab: Record<string, unknown> = { ...before };
      const changes: Array<{ noun: string; old: unknown; next: unknown }> = [];
      for (const [noun, change] of Object.entries(input.nouns)) {
        const old = before[noun] ?? null;
        let next: Record<string, unknown> | null;
        if (change === null || change === undefined) next = null;
        else {
          // Per language: a value sets it, `null` removes it, the languages not named stay as they were.
          const merged: Record<string, unknown> = { ...(isPlainObject(old) ? old : {}) };
          for (const [locale, forms] of Object.entries(change)) {
            if (forms === null) delete merged[locale];
            else merged[locale] = forms;
          }
          next = Object.keys(merged).length > 0 ? merged : null;
        }
        if (JSON.stringify(sortKeys(old)) === JSON.stringify(sortKeys(next))) continue;
        if (next) vocab[noun] = next;
        else delete vocab[noun];
        changes.push({ noun, old, next });
      }
      if (changes.length === 0) return;

      let nextDoc: Record<string, unknown> = { ...doc, v: 1, vocab };
      // A stored document that no longer parses (a buggy or newer writer) would silence the new words as well: keep only what we wrote.
      if (!workspaceOverridesSchema.safeParse(nextDoc).success) nextDoc = { v: 1, vocab };
      await this.repo.saveWorkspaceOverrides(tx, orgId, nextDoc);
      for (const c of changes) {
        await this.repo.appendLog(tx, {
          orgId,
          actorId: ctx.userId,
          action: c.next ? 'vocabulary.set' : 'vocabulary.reset',
          itemId: c.noun,
          before: c.old,
          after: c.next,
        });
      }
      await this.audit.record(tx, {
        module: 'persona_vocabulary',
        recordId: orgId,
        action: 'update',
        delta: Object.fromEntries(changes.map((c) => [c.noun, { old: c.old, new: c.next }])),
      });
    });
    return this.get(orgId, locale);
  }

  private async inputOf(
    orgId: number,
    row: WorkspacePersonaRecord,
  ): Promise<{ input: ResolveInput; rev: number; personaKey: string }> {
    const version = row.pinned ? row.personaVersion : (row.currentVersion ?? row.personaVersion);
    const raw = await this.repo.publishedDefinition(orgId, row.personaKey, version);
    const parsed = raw === null ? null : personaDefinitionSchema.safeParse(raw);
    const definition: PersonaDefinition = parsed?.success
      ? parsed.data
      : GENERIC_PERSONA_DEFINITION;
    return {
      input: {
        definition,
        operator: parseOperatorOverrides(row.operatorOverrides),
        workspace: parseWorkspaceOverrides(row.workspaceOverrides),
        showAll: row.showAllModules,
      },
      rev: row.rev,
      personaKey: row.personaKey,
    };
  }
}
