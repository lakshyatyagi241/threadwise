import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../../infra/db/database.service';

/** A WhatsApp Form the flow can send: published, and with the Meta flow behind it. */
export interface LiveForm {
  id: number;
  uuid: string;
  title: string;
  metaFlowId: string;
}

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  (res as { rows: Array<Record<string, unknown>> }).rows;

/** What `FlowFormToken` carries: the form's row id and the run that sent it. */
export function formToken(formId: number, runUuid: string): string {
  return `form-${formId}-${runUuid}`;
}

/** The form id and run reference out of a flow token; null when the token is not one this node sent. */
export function parseFormToken(token: string): { formId: number; runRef: string } | null {
  const m = /^form-(\d+)-(.+)$/.exec(token);
  return m ? { formId: Number(m[1]), runRef: m[2]! } : null;
}

/**
 * The WhatsApp Form tables as the flow runtime needs them (WD-FLR-043): which form a node names and whether it can be sent, and where
 * a submission is written. The forms domain (forms, links and groups) owns the authoring screens and the Meta publishing; the tables
 * are in the schema, and until that domain exposes a facade this reads and writes just these two, always inside one organization.
 */
@Injectable()
export class WaFormRecords {
  constructor(private readonly db: DatabaseService) {}

  /** The form the node names (its row id, or its uuid), when it is published with a Meta flow; null otherwise. */
  async liveForm(orgId: number, ref: string): Promise<LiveForm | null> {
    const asId = /^\d+$/.test(ref);
    const asUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    if (!asId && !asUuid) return null;
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, title, meta_flow_id FROM wa_forms
        WHERE org_id = ${orgId} AND status = 'published' AND coalesce(meta_flow_id, '') <> ''
          AND ${asId ? sql`id = ${Number(ref)}` : sql`uuid = ${ref}::uuid`}`);
      const r = rowsOf(res)[0];
      return r
        ? {
            id: Number(r.id),
            uuid: String(r.uuid),
            title: String(r.title ?? ''),
            metaFlowId: String(r.meta_flow_id),
          }
        : null;
    });
  }

  /** A form of this organization by row id, published or not (a submission is kept for any form that sent one). */
  async formTitle(orgId: number, formId: number): Promise<string | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT title FROM wa_forms WHERE org_id = ${orgId} AND id = ${formId}`,
      );
      const r = rowsOf(res)[0];
      return r ? String(r.title ?? '') : null;
    });
  }

  /**
   * Keeps one submission and counts it on the form, in one transaction. False when the form is not this organization's (a token that
   * names another workspace's form writes nothing).
   */
  async record(
    orgId: number,
    s: {
      formId: number;
      flowToken: string;
      callerPhone: string;
      contactId: number | null;
      conversationId: number | null;
      answers: Record<string, unknown>;
      meta: Record<string, unknown>;
    },
  ): Promise<boolean> {
    return this.db.txAs({ orgId }, async (tx) => {
      const found = await tx.execute(
        sql`SELECT id FROM wa_forms WHERE org_id = ${orgId} AND id = ${s.formId} FOR UPDATE`,
      );
      if (rowsOf(found).length === 0) return false;
      await tx.execute(sql`
        INSERT INTO wa_form_submissions (org_id, form_id, contact_id, conversation_id, flow_token, caller_phone, answers_json,
                                         meta_payload, submitted_at)
        VALUES (${orgId}, ${s.formId}, ${s.contactId}, ${s.conversationId}, ${s.flowToken}, ${s.callerPhone},
                ${JSON.stringify(s.answers)}::jsonb, ${JSON.stringify(s.meta)}::jsonb, now())`);
      await tx.execute(
        sql`UPDATE wa_forms SET submission_count = submission_count + 1 WHERE org_id = ${orgId} AND id = ${s.formId}`,
      );
      return true;
    });
  }
}

/**
 * One form answer as text: Meta sends strings for text and email fields but objects and lists for date pickers, dropdowns, opt-ins
 * and multi-selects. A list is comma-joined, an object shows its title (or name, label, value, text, id), anything else its JSON.
 */
export function flattenAnswer(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    return v
      .map(flattenAnswer)
      .filter((s) => s !== '')
      .join(', ');
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['title', 'name', 'label', 'value', 'text', 'id']) {
      const x = o[k];
      if (x !== undefined && x !== null && typeof x !== 'object') return String(x);
    }
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v);
}
