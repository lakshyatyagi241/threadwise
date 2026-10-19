import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plaintext-secret ratchet (encryption audit item 35). Every Drizzle column whose name looks like a secret must be accounted for here,
 * so a new plaintext secret column cannot be added silently. A column passes when:
 *   1. its name ends in a suffix that says what it holds (`_enc`, `_cipher`, `_hash`, `_hint`, `_last4`, `_at`, `_id` ...), or
 *   2. it is in ALLOW below with a reason: 'encrypted' (sealed with CryptoService at the service layer), 'hash', 'public' (an
 *      identifier, not a credential), 'shown-once' (a secret handed to the customer, kept only to verify), or 'E<n>' (an open audit
 *      finding, see docs/security/encryption-audit/Sheet3-35-encryption-audit-REPORT.html).
 * A new column that matches and fits neither fails this test: encrypt it (suffix `_enc`, sealed with CryptoService) or add it with a reason.
 * An entry whose column no longer matches also fails, so the list cannot rot.
 */
const SCHEMA_DIR = resolve(__dirname, '../../../../../packages/db/src/schema');

const SECRET_NAME =
  /token|secret|password|passwd|credential|private|key|access|refresh|auth|signature|hmac|otp|cert|bearer/;
// Convention suffixes: the name already says the value is sealed, hashed, a hint, a timestamp, a pointer or a label.
const SAFE_SUFFIX =
  /(_enc|_encrypted|_cipher|_ciphertext|_hash|_hint|_hints|_last4|_prefix|_at|_id|_ids|_url|_name|_label|_path|_version|_count|_scheme|_mode|_type|_kind)$/;
// Names that match by accident: LLM token counters, keyword lists, idempotency and storage keys, flags.
const NOT_A_SECRET =
  /(^|_)tokens(_|$)|keyword|idempotency_key|dedupe_key|storage_key|object_key|module_key|permission_key|persona_key|preset_key|theme_key|collapse_key|name_key|external_key|peer_key|provider_key|system_key|author_|show_signature|signature_(path|label)|access_type|quick_access|force_password_change|^is_secret$/;

type Reason = 'encrypted' | 'hash' | 'public' | 'shown-once' | `E${number}`;
const ALLOW: Record<string, Reason> = {
  // --- encrypted: the service layer seals the value with CryptoService before it is written (checked in the audit, see the report) ---
  'admin_ai_keys.api_key': 'encrypted', // ai-keys-usage-admin/key-vault.ts
  'ai_provider_keys.api_key': 'encrypted',
  'facebook_pages.access_token': 'encrypted', // channel-facebook/pages.service.ts
  'line_channels.channel_access_token': 'encrypted', // channel-line/channels.service.ts
  'line_channels.channel_secret': 'encrypted',
  'line_channels.assertion_private_key': 'encrypted',
  'line_channels.rotating_token': 'encrypted', // channel-line/line-token.service.ts
  'telegram_bots.bot_token': 'encrypted', // channel-telegram/bots.service.ts
  'telegram_bots.secret_token': 'encrypted',
  'telegram_bots.payment_provider_token': 'encrypted',
  'viber_channels.auth_token': 'encrypted', // channel-viber/channels.service.ts
  'wechat_channels.app_secret': 'encrypted', // channel-wechat/channels.service.ts, wechat-token.service.ts
  'wechat_channels.verify_token': 'encrypted',
  'wechat_channels.encoding_aes_key': 'encrypted',
  'wechat_channels.cached_access_token': 'encrypted',
  'wa_merchant_gateways.credentials': 'encrypted', // checkout-orders-merchant-payments/gateways
  'payment_gateways.credentials': 'encrypted', // platform-payment-gateways/gateway.service.ts
  'translation_providers.credentials': 'encrypted', // localization-translation/provider-credentials.ts
  'webhooks.secret': 'encrypted', // outbound-webhooks/webhooks.service.ts
  'shopify_integrations.access_token': 'encrypted', // shopify-woocommerce/shopify.service.ts
  'woocommerce_integrations.consumer_key': 'encrypted', // shopify-woocommerce/woocommerce.service.ts
  'woocommerce_integrations.consumer_secret': 'encrypted',
  'shopify_cart_recoveries.checkout_token': 'encrypted', // shopify-woocommerce/cart.service.ts
  'woocommerce_cart_recoveries.checkout_token': 'encrypted',
  'webhook_forward_targets.auth_header_value': 'encrypted', // webhook-fanout/webhook-targets.service.ts
  'wa_provider_configs.credentials_json': 'encrypted', // whatsapp-cloud-api-waba/waba-connect.service.ts
  // Schema only so far (no service writes these yet; the schema comment says ciphertext). The writer must call CryptoService.encrypt.
  'devices.proxy_password': 'encrypted', // read side decrypts (node-bridge-runtime/device-runtime.service.ts)
  'tiktok_accounts.access_token': 'encrypted',
  'tiktok_accounts.refresh_token': 'encrypted',
  'tiktok_shops.access_token': 'encrypted',
  'tiktok_shops.refresh_token': 'encrypted',
  'hubspot_integrations.access_token': 'encrypted',
  'hubspot_integrations.refresh_token': 'encrypted',
  'slack_integrations.bot_token': 'encrypted',
  'slack_integrations.signing_secret': 'encrypted',
  'trello_integrations.api_key': 'encrypted',
  'trello_integrations.api_secret': 'encrypted',
  'trello_integrations.token': 'encrypted',
  'push_subscriptions.auth': 'encrypted', // notifications/push-subscriptions.service.ts seals it, web-push.sender.ts opens it (E7)
  'user_device_tokens.fcm_token': 'encrypted', // no writer yet (E7): the writer must seal it with CryptoService
  'outbound_webhooks.secret': 'encrypted', // an older twin of `webhooks`; only counted today, never written

  // --- public: an identifier, a public key or a name, not a credential ---
  'webauthn_credentials.public_key': 'public',
  'platform_webauthn_credentials.public_key': 'public',
  'web_forms.public_key': 'public', // printed in the form embed
  'marketplace_connections.public_key': 'public', // the path id of a portal address; its secret is secret_enc
  'chatbot_widgets.embed_token': 'public', // printed in the embed snippet on the customer's site
  'viber_broadcast_recipients.message_token': 'public', // Viber's id for a send, used to match a receipt
  'users.auth_subject': 'public', // the sign-in provider's subject id
  'platform_settings.key': 'public', // the setting's name
  'fields.key': 'public',
  'permission_defs.key': 'public',
  'personas.key': 'public',
  'activity_types.key': 'public',
  'activity_type_options.key': 'public',
  'whatsapp_providers.key': 'public',
  'frontend_content.ckey': 'public',
  'storage_objects.key': 'public', // an object path, not an access key
  'message_ledger.key': 'public', // a dedupe key
  'messages.media_key': 'public', // an object path
  'conversation_media_uploads.media_key': 'public',
  'sales_doc_events.signature': 'public', // the signer's typed or drawn signature on an accepted proposal

  // --- hash: lookup by sha256 + a sealed copy; the plaintext column is only the rollout mirror and is NULLed by the seal CLI --scrub ---
  'telegram_bots.webhook_token': 'hash', // E3: webhook_token_hash / webhook_token_enc are authoritative
  'line_channels.webhook_token': 'hash',
  'viber_channels.webhook_token': 'hash',
  'wechat_channels.webhook_token': 'hash',

  'orders.return_token': 'hash', // E8: return_token_hash is authoritative; the plaintext is the rollout mirror
  'wa_orders.recovery_token': 'hash', // E8: recovery_token_hash / recovery_token_enc

  // --- public: a correlation handle that is shown to the person it belongs to and opens nothing on its own ---
  'web_form_submissions.receipt_token': 'public', // form-key.ts: "a handle for the thank-you page, not a credential"; shows a payment status only
  'wa_form_submissions.flow_token': 'public', // 'form-<id>-<run uuid>', echoed back by WhatsApp to match a reply to a run
  'wa_link_clicks.token': 'public', // the short link printed in the message to its recipient; resolves to a URL they already hold

  // --- hash: a digest, not the secret ---
  'webhook_forward_failures.signature_header': 'hash', // the HMAC the sender computed over the body, kept to replay the forward

  // --- accepted risks, open findings (docs/security/encryption-audit/Sheet3-35-encryption-audit-REPORT.html) ---
  'shopify_integrations.webhook_secret': 'E2', // the URL path secret and the lookup key; needs the hash + encrypted split
  'woocommerce_integrations.webhook_secret': 'E2', // as above, and the HMAC key given to the store plugin
  'incoming_webhooks.token': 'E3', // no service writes it yet: the writer must use tokenColumns() (hash + sealed copy)
  'crm_briefs.public_token': 'E8', // no service writes it yet: the writer must use tokenColumns() (hash + sealed copy)
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

/** `table.column` for every column declared in the schema, read from the source (no database, no build). */
function schemaColumns(): string[] {
  const out: string[] = [];
  for (const file of walk(SCHEMA_DIR)) {
    let table = '?';
    let awaitingName = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const inline = line.match(/pgTable\(\s*'([a-z0-9_]+)'/);
      if (inline) table = inline[1]!;
      else if (/pgTable\(\s*$/.test(line)) awaitingName = true;
      else if (awaitingName) {
        const next = line.match(/^\s*'([a-z0-9_]+)'/);
        if (next) {
          table = next[1]!;
          awaitingName = false;
        }
      }
      const col = line.match(/^\s*[A-Za-z0-9_]+\s*:\s*[A-Za-z]+\(\s*'([a-z0-9_]+)'/);
      if (col) out.push(`${table}.${col[1]!}`);
    }
  }
  return out;
}

const all = schemaColumns();
const needsReason = all.filter((tc) => {
  const col = tc.split('.')[1]!;
  return SECRET_NAME.test(col) && !SAFE_SUFFIX.test(col) && !NOT_A_SECRET.test(col);
});

describe('plaintext-secret ratchet', () => {
  it('finds the schema (guards against the scan silently matching nothing)', () => {
    expect(all.length).toBeGreaterThan(2000);
    expect(all).toContain('users.password_hash');
    expect(all.filter((tc) => tc.startsWith('?.'))).toEqual([]);
  });

  it('every secret-looking column is encrypted by convention or in the commented allowlist', () => {
    // Fix: rename to *_enc and seal with CryptoService, or add the column to ALLOW with its reason.
    expect(needsReason.filter((tc) => !(tc in ALLOW))).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    expect(Object.keys(ALLOW).filter((tc) => !needsReason.includes(tc))).toEqual([]);
  });
});
