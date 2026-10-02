# Shims

Stand-ins for services other domains own and have not exported yet. Each is an interface plus a default implementation that
reads the tables the Reference schema migrations already created. When the owning domain exports the real service, bind it to
the same token in `catalog-products.module.ts` and delete the shim.

| Shim                                      | Real owner (TW domain)                            | Used by                        | Tracker row            |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------ | ---------------------- |
| `SenderDirectory` (devices, WABA configs) | whatsapp-devices-baileys, whatsapp-cloud-api-waba | TW-CAT-003, 008, 014, 015, 022 | blocked on WADEV, WABA |
| `AudienceDirectory` (contacts, groups)    | contacts-attributes-tags                          | TW-CAT-014, 015                | blocked on CON export  |
| `ShopDirectory` (`wa_storefronts`)        | storefront-builder (STORE)                        | TW-CAT-008, 009, 014, 022, 023 | blocked on STORE       |

Not behind a shim, listed because they are still open:

- The plan-first message billing (`OverflowBilling::consumeOne`) of each catalog message is blocked on wallet-message-billing.
- The inbound hooks that call `CatalogConciergeService` and `CatalogOrderAckService`: `WABA_INBOUND_SINK` is a single binding the inbox owns
  (still `LoggingInboundSink`), the chat ingest emits no per-message outbox event, and no module captures a WhatsApp cart order yet.
  Bind them in the inbox's sink (or a per-message event) when it lands.
- The inbox mirror is real (`inbox-conversation-mirror.ts`, through the chat-conversations facade); `ConversationMirror` stays a token
  here only because the send service and the tests inject it.
- The image upload control of the product form needs the storage domain (F5); products take `imageUrl` and `galleryUrls`.
