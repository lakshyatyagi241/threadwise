import { isBuiltInVariable, type EmailTemplateScope, type VariableLookup } from '@crm/contracts';
import { resolveToken, type MergeContact, type MergeContext } from '../crm';

export const EMAIL_TEMPLATE_READ = 'mail.templates.read';
export const EMAIL_TEMPLATE_MANAGE = 'mail.templates.manage';

/** The row facts the rules below need. `userId` is the owner of a personal template, null for a shared one. */
export interface TemplateOwnership {
  userId: number | null;
}

export interface TemplateCaller {
  userId: number;
  /** Holds `mail.templates.manage`. */
  canManage: boolean;
}

export const scopeOf = (row: TemplateOwnership): EmailTemplateScope =>
  row.userId === null ? 'shared' : 'mine';

/**
 * Who may edit, archive or delete a visible template. A shared template needs the manage right; a personal one is its owner's whether or
 * not they still hold the manage right. A personal template of somebody else is never visible, so it never gets this far.
 */
export const canChange = (row: TemplateOwnership, caller: TemplateCaller): boolean =>
  row.userId === null ? caller.canManage : row.userId === caller.userId;

/** Postgres unique violation, however the driver wrapped it. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** `Amira Khan` to `Amira`. */
const firstWord = (name: string | null | undefined): string =>
  (name ?? '').trim().split(/\s+/)[0] ?? '';

/** What the conversation's contact, the agent and the workspace contribute to a template's variables. */
export interface RenderFacts {
  contact: MergeContact | undefined;
  base: Omit<MergeContext, 'contact'>;
  /** The conversation's own display name, used when the thread has no contact yet. */
  peerName: string | null;
  agentName: string | null;
}

/**
 * The variable lookup for one conversation. Agent and workspace values are the server's; contact values and custom attributes go through
 * the same resolver as saved replies, templates and broadcasts, so one name means one value everywhere. A name that is neither built in
 * nor an active custom attribute is `undefined` (unknown, flagged as a typo); a real variable the contact has no value for is `''`
 * (flagged as empty). Nothing here ever invents a value.
 */
export function buildLookup(f: RenderFacts): VariableLookup {
  const ctx: MergeContext = { ...f.base, contact: f.contact };
  return (key) => {
    switch (key) {
      case 'agent_name':
        return f.agentName ?? '';
      case 'agent_first_name':
        return firstWord(f.agentName);
      case 'workspace_name':
        return f.base.system.businessName;
      default:
        break;
    }
    const resolved = resolveToken(key, ctx);
    if (resolved.source !== 'unresolved') return resolved.value;
    // A thread that has no contact yet still has the name the customer wrote under.
    if (key === 'name' && f.peerName) return f.peerName;
    if (key === 'first_name' && f.peerName) return firstWord(f.peerName);
    if (isBuiltInVariable(key) || f.base.attributeDefaults.has(key)) return '';
    return undefined;
  };
}
