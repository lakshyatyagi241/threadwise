// Copies the phone-relevant guides of the web Help center into the app (src/features/help/help-docs.json), so the Help screen
// reads them offline and without the web sign-in. Run from apps/mobile after the web registry is generated:
//   node scripts/gen-help-content.mjs && npx prettier --write src/features/help/help-docs.json
// The guides are the web's own (apps/web/src/features/*/help/*.md); change them there and run this again. Only English and the
// languages the web guide itself has are copied; the app shows English for any other language.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '../../web/src/features/_registry/help.generated.ts');
const target = path.join(here, '../src/features/help/help-docs.json');

/** Category (the app's own grouping) -> the web guide ids shown in it, in order. Only guides about screens the app has. */
const CATEGORIES = {
  'getting-started': [
    'getting-started',
    'using-help',
    'connect-first-whatsapp-number',
    'invite-teammates-and-roles',
    'notifications-and-alerts',
    'notifications-page',
    'away-vs-offline',
    'teams-managers-access',
  ],
  dashboard: ['dashboard-overview', 'analytics-overview'],
  inbox: [
    'team-inbox-overview',
    'waiting-queue',
    'agent-status-bar',
    'agent-status-automation',
    'team-performance',
    'call-logs-overview',
    'log-a-call',
  ],
  contacts: [
    'contacts-overview',
    'contact-details-page',
    'contact-groups',
    'contact-meetings',
    'contact-quick-view',
    'contacts-bulk-tag',
    'tasks-overview',
    'companies-overview',
    'deals-overview',
    'segments-overview',
  ],
  settings: [
    'settings-overview',
    'saved-replies',
    'inbox-tags',
    'auto-assignment',
    'teams',
    'settings-team',
    'team-members',
    'roles',
    'team-access',
    'contact-stages',
    'follow-ups',
  ],
  account: [
    'account-profile',
    'account-sign-in-security',
    'account-passkeys',
    'notification-preferences',
  ],
  troubleshooting: [
    'message-stuck-or-not-sent',
    'read-receipts-not-updating',
    'whatsapp-incoming-missing',
    'two-step-sign-in-locked-out',
  ],
};

const text = fs.readFileSync(source, 'utf8');
const all = JSON.parse(text.slice(text.indexOf('[{'), text.lastIndexOf('}];') + 2));
const byId = new Map(all.map((doc) => [doc.id, doc]));

const out = [];
const missing = [];
for (const [category, ids] of Object.entries(CATEGORIES)) {
  ids.forEach((id, index) => {
    const doc = byId.get(id);
    if (!doc) return missing.push(id);
    const texts = {};
    for (const lang of ['en', 'ar']) {
      if (doc.text[lang]) {
        const { title, summary, blocks } = doc.text[lang];
        texts[lang] = { title, summary, blocks };
      }
    }
    out.push({ id, category, order: index, keywords: doc.keywords, text: texts });
  });
}
if (missing.length) throw new Error(`Guides not found in the web registry: ${missing.join(', ')}`);
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.length} guides -> ${path.relative(process.cwd(), target)}`);
