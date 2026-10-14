import { Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PRIVACY_EXPORT_TTL_DAYS } from '@crm/contracts';
import { MediaTokenService } from '../../../infra/providers/chat-conversations/media';
import { PERSONAL_DATA_REGISTRY, registryDigest } from '../registry';
import { rowsOf } from '../registry/sql';
import type { ExportSection, PrivacyCtx, ResolvedSubject } from '../registry/types';
import { bigintArray } from '../registry/sql';
import { buildZip, type ZipEntry } from './zip';

const MESSAGE_CSV_CAP = 200_000;
const DAY_SECONDS = 24 * 60 * 60;

export interface BuiltExport {
  zip: Buffer;
  /** Rows per holder (module key to count), for the screen and the proof that every section was read. */
  sections: Record<string, number>;
  truncated: string[];
}

/** A cell for a spreadsheet: quoted when needed, and a leading = + - @ neutralised so a message cannot run as a formula. */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const line = (cells: ReadonlyArray<string | number | boolean | null | undefined>): string =>
  `${cells.map(cell).join(',')}\r\n`;

const WHO: Record<string, string> = {
  agent: 'A team member',
  bot: 'An automated reply',
  system: 'The system',
  broadcast: 'A broadcast',
  customer: 'The person',
};

/**
 * Builds the file a person is entitled to when they ask for their data (access, export, portability): one ZIP with
 *
 *   README.txt          what is inside, in plain language, and how long the links last
 *   index.json          the sections and how many rows each holds (every registered holder, even when it holds nothing)
 *   data/<holder>/<table>.json   every row the workspace holds about the person, module by module
 *   messages.csv        the conversations as a table anyone can open
 *   files.json          every stored file (media, contact files, recordings, PDFs) with a link that works for 7 days
 *
 * Secrets are left out (tokens, hashes, sealed values), internal ids are removed. It is built for the workspace admin who downloads
 * it; nothing is sent to the person automatically.
 */
@Injectable()
export class ExportBuilder {
  constructor(@Optional() private readonly tokens?: MediaTokenService) {}

  async build(
    tx: Tx,
    params: {
      orgId: number;
      requestId: number;
      reference: string;
      requestType: string;
      /** The staff user the file links are minted for (the admin who downloads). */
      linkUserId: number | null;
      subject: ResolvedSubject;
      now?: Date;
    },
  ): Promise<BuiltExport> {
    const now = params.now ?? new Date();
    const ctx: PrivacyCtx = {
      tx,
      orgId: params.orgId,
      requestId: params.requestId,
      tiers: ['subject', 'core', 'history', 'records', 'financial'],
      dryRun: false,
      now,
    };
    const entries: ZipEntry[] = [];
    const sections: Record<string, number> = {};
    const index: Record<string, Record<string, number>> = {};
    const truncated: string[] = [];

    for (const holder of PERSONAL_DATA_REGISTRY) {
      const section: ExportSection = await holder.export(ctx, params.subject);
      index[holder.key] = {};
      let total = 0;
      for (const t of section.tables) {
        index[holder.key]![t.table] = t.count;
        total += t.count;
        if (t.truncated) truncated.push(`${holder.key}/${t.table}`);
        if (t.count > 0) {
          entries.push({
            name: `data/${holder.key}/${t.table}.json`,
            data: Buffer.from(JSON.stringify(t.rows, null, 2), 'utf8'),
          });
        }
      }
      sections[holder.key] = total;
    }

    const csv = await this.messagesCsv(tx, params.orgId, params.subject);
    entries.push({ name: 'messages.csv', data: Buffer.from(`${String.fromCharCode(0xfeff)}${csv.text}`, 'utf8') });
    if (csv.truncated) truncated.push('messages.csv');

    const files = await this.files(tx, params, now);
    entries.push({ name: 'files.json', data: Buffer.from(JSON.stringify(files, null, 2), 'utf8') });

    entries.unshift(
      {
        name: 'index.json',
        data: Buffer.from(
          JSON.stringify(
            {
              request: params.reference,
              type: params.requestType,
              generatedAt: now.toISOString(),
              registry: registryDigest(),
              sections: index,
              truncated,
            },
            null,
            2,
          ),
          'utf8',
        ),
      },
      {
        name: 'README.txt',
        data: Buffer.from(readme(params.reference, now, files.length), 'utf8'),
      },
    );

    return { zip: buildZip(entries, now), sections, truncated };
  }

  private async messagesCsv(
    tx: Tx,
    orgId: number,
    subject: ResolvedSubject,
  ): Promise<{ text: string; truncated: boolean }> {
    let text = line([
      'Date and time (UTC)',
      'Channel',
      'Who sent it',
      'Type',
      'Message',
      'Translated message',
      'Attachment',
      'Delivery status',
    ]);
    if (!subject.conversationIds.length) return { text, truncated: false };
    const res = await tx.execute(sql`
      SELECT m.created_at, ch.kind AS channel, m.direction, m.sender_kind, m.kind, m.body, m.translated_body, m.media_name, m.status,
             (m.deleted_at IS NOT NULL) AS deleted
        FROM messages m
        JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        LEFT JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE m.org_id = ${orgId} AND m.conversation_id = ANY(${bigintArray(subject.conversationIds)})
       ORDER BY m.created_at, m.id LIMIT ${MESSAGE_CSV_CAP + 1}`);
    const rows = res.rows as Array<{
      created_at: Date | string;
      channel: string | null;
      direction: string;
      sender_kind: string;
      kind: string;
      body: string | null;
      translated_body: string | null;
      media_name: string | null;
      status: string;
      deleted: boolean;
    }>;
    for (const r of rows.slice(0, MESSAGE_CSV_CAP)) {
      const who = r.direction === 'in' ? WHO.customer : (WHO[r.sender_kind] ?? 'The workspace');
      text += line([
        new Date(r.created_at).toISOString(),
        r.channel ?? '',
        who,
        r.kind,
        r.deleted ? '(deleted message)' : r.body,
        r.deleted ? '' : r.translated_body,
        r.media_name,
        r.status,
      ]);
    }
    return { text, truncated: rows.length > MESSAGE_CSV_CAP };
  }

  /** Every stored file of the person with a link. Chat media gets a sealed link for the admin; other files are named and located. */
  private async files(
    tx: Tx,
    params: { orgId: number; linkUserId: number | null; subject: ResolvedSubject },
    now: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    const expires = new Date(now.getTime() + PRIVACY_EXPORT_TTL_DAYS * DAY_SECONDS * 1000);
    const seen = new Set<string>();
    for (const holder of PERSONAL_DATA_REGISTRY) {
      for (const spec of holder.tables) {
        for (const s of spec.storage ?? []) {
          const col = sql.identifier(s.column);
          const res = await tx.execute(sql`
            SELECT DISTINCT ${col}::text AS key FROM ${sql.identifier(spec.table)}
             WHERE ${rowsOf(spec, params.subject)} AND ${col} IS NOT NULL AND btrim(${col}::text) <> '' LIMIT 5000`);
          for (const r of res.rows as Array<{ key: string }>) {
            if (seen.has(r.key)) continue;
            seen.add(r.key);
            const linkable =
              params.linkUserId !== null && r.key.startsWith(`chat/${params.orgId}/`);
            let link: string | null = null;
            if (linkable && this.tokens) {
              const token = this.tokens.sign(
                {
                  key: r.key,
                  orgId: params.orgId,
                  userId: params.linkUserId!,
                  name: r.key.split('/').pop(),
                },
                PRIVACY_EXPORT_TTL_DAYS * DAY_SECONDS,
                now.getTime(),
              );
              link = `/api/v2/media/${token}`;
            }
            out.push({
              source: `${holder.key}/${spec.table}`,
              what: s.note,
              file: r.key.split('/').pop() ?? '',
              link,
              linkExpiresAt: link ? expires.toISOString() : null,
              note: link
                ? 'Open while signed in to the workspace as the person who requested this export.'
                : "Not served by a link: open it in the workspace (the contact's files, the call recording player, the invoice).",
            });
          }
        }
      }
    }
    return out;
  }
}

function readme(reference: string, now: Date, files: number): string {
  return [
    `Data export ${reference}`,
    `Prepared ${now.toISOString()}`,
    '',
    'What is in this file',
    '  index.json     the sections of this export and how many records each holds',
    '  data/          everything the workspace holds about the person, one JSON file per kind of record',
    '  messages.csv   the conversations as a table you can open in a spreadsheet',
    `  files.json     ${files} stored file(s) with a link where one is available`,
    '',
    'About this file',
    `  - File links work for ${PRIVACY_EXPORT_TTL_DAYS} days and only for the team member who requested this export, while signed in.`,
    '  - Passwords, tokens, signatures and internal system ids are left out on purpose.',
    '  - Invoices and payment records are listed with the details the workspace keeps for tax purposes.',
    '  - This file contains personal data. Share it only with the person it is about, over a channel you have verified.',
    '',
  ].join('\r\n');
}
